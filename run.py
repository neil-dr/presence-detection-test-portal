import asyncio
import uvicorn
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from threading import Event, Thread

# --- your modules ---
# must be non-blocking init/teardown
from camera_manager import open_camera, close_camera, capture_frames
# blocking; exits on presence OR when stop_event is set
from index import detection_loop
import test_manager
from test_manager import save_test_result

app = FastAPI(title="Presence Test Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

# ---- In-memory runtime state ----
# testId -> {"mode": str, "thread": Thread, "stop": Event}
tests: Dict[str, Dict] = {}
ws_clients: Set[WebSocket] = set()
loop: asyncio.AbstractEventLoop | None = None
infinite_stop_event: Event | None = None


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.on_event("startup")
async def _capture_loop():
    """Capture the *actual* running event loop from uvicorn/starlette."""
    global loop
    loop = asyncio.get_running_loop()


def broadcast(msg: dict):
    """Send message to all sockets for test_id from worker threads safely."""
    msg_text = json.dumps(msg)
    print(msg_text)
    for ws in list(ws_clients):
        try:
            asyncio.run_coroutine_threadsafe(ws.send_text(msg_text), loop)
        except Exception:
            print(f"Exception: {Exception}")


def log(message: str):
    broadcast({"type": "log", "message": message, "ts": utcnow()})

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
    capture_frames()
    return True


def release_camera():
    close_camera()

# ---- Workers ----


def _set_after(stop: Event, seconds: float):
    """Set the stop event after `seconds` unless it was set earlier."""
    # Event.wait(timeout) returns True if the event was set before timeout.
    # If it returns False, we hit the timeout → set the event.
    if not stop.wait(max(0.0, float(seconds))):
        stop.set()


def run_defined_test(duration: int):
    stop = Event()
    # Arm a timer that sets `stop` after `duration` seconds unless already set
    timer = Thread(target=_set_after, args=(stop, duration), daemon=True)
    timer.start()

    start_ts = utcnow()
    t0 = time.monotonic()
    detected_at = None
    outcome = False

    try:
        outcome = detection_loop(stop)  # returns on presence or stop set
        type = "absence"
        if (outcome):
            type = "presence"
            broadcast({"type": type, "ts": utcnow()})
            detected_at = utcnow()
        else:
            broadcast({"type": type, "ts": utcnow()})
    except Exception as e:
        log(f"Detection error: {e}")
    finally:
        end_time = utcnow()
        run_time = round(time.monotonic() - t0, 3)
        save_test_result(
            test_id=test_manager.test_id,
            start_time=start_ts,
            end_time=end_time,
            test_type="defined",
            face_detected=outcome,
            detected_at=detected_at,
            run_time=run_time,
        )
    return


def run_infinite_test():
    log("Infinite test started.")
    start_ts = utcnow()
    t0 = time.monotonic()
    detected_at = None
    outcome = False

    outcome = detection_loop(infinite_stop_event)
    if (outcome):
        type = "presence"
        broadcast({"type": type, "ts": utcnow()})
        detected_at = utcnow()
    else:
        broadcast({"type": type, "ts": utcnow()})
    end_time = utcnow()
    run_time = round(time.monotonic() - t0, 3)
    save_test_result(
        test_id=test_manager.test_id,
        start_time=start_ts,
        end_time=end_time,
        test_type="infinite",
        face_detected=outcome,
        detected_at=detected_at,
        run_time=run_time,
    )
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
    test_manager.test_id = req.testId
    duration = req.duration
    t = Thread(target=run_defined_test, args=(duration,), daemon=True)
    tests[req.testId] = {"mode": "defined", "thread": t}
    t.start()
    return {"ok": True, "started": True}


@app.post("/api/start_infinite")
def start_infinite(req: StartInfiniteReq):
    global infinite_stop_event
    if req.testId in tests and tests[req.testId].get("thread") and tests[req.testId]["thread"].is_alive():
        raise HTTPException(status_code=409, detail={
                            "ok": False, "error": "test_already_running"})
    test_manager.test_id = req.testId
    infinite_stop_event = Event()
    t = Thread(target=run_infinite_test, daemon=True)
    tests[req.testId] = {"mode": "infinite", "thread": t}
    t.start()
    return {"ok": True, "started": True}


@app.post("/api/stop_infinite")
def stop_infinite(req: StopInfiniteReq):
    global infinite_stop_event
    if not infinite_stop_event:
        infinite_stop_event.set()
    return {"ok": True, "stopped": True}


@app.post("/api/release_webcam")
def release_webcam():
    release_camera()
    return {"ok": True}

# ---- WebSocket for logs/events ----


@app.websocket("/logs")
async def logs_ws(ws: WebSocket, testId: str = Query(...)):
    await ws.accept()
    await ws.send_text(json.dumps({"type": "log", "message": f"Socket Connected", "ts": utcnow()}))
    ws_clients.add(ws)
    test_manager.test_id = testId
    try:
        # We don't expect client messages; just keep it open
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    # finally:
    #     ws_clients.get(testId, set()).discard(ws)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
