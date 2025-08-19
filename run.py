# server.py
import uvicorn
import json
import time
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Set

import anyio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from threading import Event, Thread

# --- your modules ---
# must be non-blocking init/teardown
from camera_manager import open_camera, close_camera
# blocking; exits on presence OR when stop_event is set
from index import detection_loop

app = FastAPI(title="Presence Test Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

# ---- In-memory runtime state ----
# testId -> {"mode": str, "thread": Thread, "stop": Event}
tests: Dict[str, Dict] = {}
ws_clients: Dict[str, Set[WebSocket]] = {}  # testId -> set(WebSocket)


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def broadcast(test_id: str, msg: dict):
    """Send message to all sockets for test_id from worker threads safely."""
    if not ws_clients.get(test_id):
        return
    msg_text = json.dumps(msg)

    async def _send(ws: WebSocket, text: str):
        try:
            await ws.send_text(text)
        except Exception:
            # drop silently
            pass
    for ws in list(ws_clients.get(test_id, set())):
        try:
            anyio.from_thread.run(_send, ws, msg_text)
        except Exception:
            pass


def log(test_id: str, message: str):
    broadcast(test_id, {"type": "log", "message": message, "ts": utcnow()})

# ---- Models ----


class ConnectReq(BaseModel):
    pass


class StartDefinedReq(BaseModel):
    testId: str
    goal: str
    description: Optional[str] = None
    duration: int = 10


class StartInfiniteReq(BaseModel):
    testId: str


class StopInfiniteReq(BaseModel):
    testId: str

# ---- Camera control ----


def acquire_camera() -> bool:
    # open_camera should initialize cv2.VideoCapture and return quickly (non-blocking)
    open_camera()
    return True


def release_camera():
    close_camera()

# ---- Workers ----


def run_defined_test(test_id: str, payload: StartDefinedReq, stop: Event):
    test_dir = Path(f"{payload.testId}_test_data")
    (test_dir / "frames").mkdir(parents=True, exist_ok=True)
    (test_dir / "artifacts").mkdir(parents=True, exist_ok=True)

    meta = {
        "testId": payload.testId,
        "mode": "defined",
        "goal": payload.goal,
        "description": payload.description,
        "duration": payload.duration,
        "startedAt": utcnow(),
    }
    (test_dir / "test.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    log(test_id, "Analyzer warmup...")
    time.sleep(0.3)

    # Run your blocking detection_loop in a thread so we can time out
    outcome = None

    def _runner():
        try:
            global outcome
            outcome = detection_loop(stop)  # returns on presence or stop set
            print(f"outcome {outcome}")
        except Exception as e:
            log(test_id, f"Detection error: {e}")

    worker = Thread(target=_runner, daemon=True)
    worker.start()

    # Wait up to duration seconds
    worker.join(timeout=payload.duration)

    if worker.is_alive():
        # Timed out waiting for presence → stop and finalize as timeout
        log(test_id, "Defined test timed out. Stopping detection...")
        stop.set()
        worker.join(timeout=2.0)
        outcome = "timeout"
    else:
        # detection_loop returned before timeout → presence triggered
        broadcast(test_id, {"type": "presence",
                  "confidence": 0.94, "ts": utcnow()})
        log(test_id, "Presence triggered.")
        outcome = "triggered"

    # Finalize metadata
    meta.update({"endedAt": utcnow(), "outcome": outcome})
    (test_dir / "test.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    broadcast(test_id, {"type": "finalize",
              "outcome": outcome, "ts": utcnow()})
    log(test_id, f"Test finished: {outcome}")


def run_infinite_test(test_id: str, stop: Event):
    test_dir = Path(f"{test_id}_test_data")
    (test_dir / "frames").mkdir(parents=True, exist_ok=True)
    (test_dir / "artifacts").mkdir(parents=True, exist_ok=True)

    meta_path = test_dir / "test.json"
    meta = {"testId": test_id, "mode": "infinite", "startedAt": utcnow()}
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    log(test_id, "Infinite test started.")

    # Loop forever until stop: every time detection_loop returns → presence event
    while not stop.is_set():
        try:
            detection_loop(stop)  # returns on presence or when stop was set
        except Exception as e:
            log(test_id, f"Detection error: {e}")
            time.sleep(0.2)
            continue

        if stop.is_set():
            break

        # Presence occurred
        broadcast(test_id, {"type": "presence",
                  "confidence": 0.88, "ts": utcnow()})
        log(test_id, "Presence event.")
        # Immediately continue to wait for next presence

    # finalize
    meta["endedAt"] = utcnow()
    meta["stopped"] = True
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    log(test_id, "Infinite test stopped.")

# ---- API ----


@app.post("/api/connect_webcam")
def connect_webcam(_: ConnectReq):
    try:
        if acquire_camera():
            return {"ok": True}
        raise RuntimeError("internal_error")
    except Exception:
        raise HTTPException(status_code=500, detail={
                            "ok": False, "error": "internal_error"})


@app.post("/api/start_defined")
def start_defined(req: StartDefinedReq):
    if req.testId in tests and tests[req.testId].get("thread") and tests[req.testId]["thread"].is_alive():
        raise HTTPException(status_code=409, detail={
                            "ok": False, "error": "test_already_running"})
    stop = Event()
    t = Thread(target=run_defined_test, args=(
        req.testId, req, stop), daemon=True)
    tests[req.testId] = {"mode": "defined", "thread": t, "stop": stop}
    t.start()
    return {"ok": True, "started": True}


@app.post("/api/start_infinite")
def start_infinite(req: StartInfiniteReq):
    if req.testId in tests and tests[req.testId].get("thread") and tests[req.testId]["thread"].is_alive():
        raise HTTPException(status_code=409, detail={
                            "ok": False, "error": "test_already_running"})
    stop = Event()
    t = Thread(target=run_infinite_test, args=(req.testId, stop), daemon=True)
    tests[req.testId] = {"mode": "infinite", "thread": t, "stop": stop}
    t.start()
    return {"ok": True, "started": True}


@app.post("/api/stop_infinite")
def stop_infinite(req: StopInfiniteReq):
    test = tests.get(req.testId)
    if not test:
        raise HTTPException(status_code=404, detail={
                            "ok": False, "error": "test_not_found"})
    if test.get("mode") != "infinite":
        raise HTTPException(status_code=409, detail={
                            "ok": False, "error": "wrong_mode"})
    test["stop"].set()
    return {"ok": True, "stopped": True}


@app.post("/api/release_webcam")
def release_webcam():
    release_camera()
    return {"ok": True}

# ---- WebSocket for logs/events ----


@app.websocket("/logs")
async def logs_ws(ws: WebSocket, testId: str = Query(...)):
    await ws.accept()
    ws_clients.setdefault(testId, set()).add(ws)
    await ws.send_text(json.dumps({"type": "log", "message": f"Resumed: {testId}", "ts": utcnow()}))
    try:
        # We don't expect client messages; just keep it open
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.get(testId, set()).discard(ws)

if __name__ == "__main__":
    # If this file is named server.py, the app import should be "server:app"
    uvicorn.run("run:app", host="127.0.0.1", port=8000, reload=True)
