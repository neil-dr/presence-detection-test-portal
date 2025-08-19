# Presence Check API

## Auth & Transport

* **Protocol:** HTTPS + WebSocket
* **Auth:** (optional) Bearer token via `Authorization: Bearer <token>` header
* **Content-Type:** `application/json` for HTTP requests/responses
* **CORS:** allow your frontend origin

---

## 1) Connect Webcam (optional handshake)

### `POST /api/connect_webcam`

Frontend uses this to ask the Python BE to acquire the camera (if the BE owns the capture pipeline). If you rely solely on the browser for preview, you can just return `ok: true`.

**Request Body**

```json
{}
```

**Response 200**

```json
{ "ok": true }
```

**Errors**

* `503 Service Unavailable` `{ "ok": false, "error": "camera_busy" }`
* `500 Internal Server Error` `{ "ok": false, "error": "internal_error" }`

**Side effects**

* Optional: Initialize capture pipeline, warm up detector.

---

## 2) Start Defined Test (10s fixed)

### `POST /api/start_defined`

Kick off a 10-second test. The BE should:

* Create `"{testId}_test_data"` directory
* Persist metadata (`test.json`) and stream logs (via WS)
* Emit a `{ "type": "presence" }` message on trigger (if any)
* Stop automatically at 10s and finalize artifacts

**Request Body**

```json
{
  "testId": "a3f2...-uuid",
  "goal": "Trigger presence detection",   // or "Evade presence detection"
  "description": "people with caps, light/dark, 2 people walking by etc..",
  "duration": 10
}
```

**Response 202**

```json
{ "ok": true, "started": true }
```

**Errors**

* `400` `{ "ok": false, "error": "invalid_payload" }`
* `409` `{ "ok": false, "error": "test_already_running" }`
* `500` `{ "ok": false, "error": "internal_error" }`

**Filesystem layout (recommended)**

```
{testId}_test_data/
  test.json            // request payload + timestamps + outcome
  logs.txt             // line-by-line logs (same content as WS)
  frames/              // optional captured frames/snippets
  artifacts/           // model diagnostics, heatmaps, etc.
```

**`test.json` example**

```json
{
  "testId": "a3f2...-uuid",
  "mode": "defined",
  "goal": "Trigger presence detection",
  "description": "people with caps...",
  "duration": 10,
  "startedAt": "2025-08-19T02:05:00Z",
  "endedAt": "2025-08-19T02:05:10Z",
  "outcome": "triggered"  // or "timeout"
}
```

---

## 3) Start Infinite Test

### `POST /api/start_infinite`

Begin continuous processing until explicitly stopped. Presence events only trigger a modal; test keeps running unless user exits or stops.

**Request Body**

```json
{ "testId": "d91c...-uuid" }
```

**Response 202**

```json
{ "ok": true, "started": true }
```

**Errors**

* `409` `{ "ok": false, "error": "test_already_running" }`
* `500` `{ "ok": false, "error": "internal_error" }`

**Side effects**

* Create `"{testId}_test_data"` at start and append within it.
* Keep sending logs over WS; emit presence events as they occur.

---

## 4) Stop Infinite Test

### `POST /api/stop_infinite`

Stop the current infinite test and finalize artifacts.

**Request Body**

```json
{ "testId": "d91c...-uuid" }
```

**Response 200**

```json
{ "ok": true, "stopped": true }
```

**Errors**

* `404` `{ "ok": false, "error": "test_not_found" }`
* `409` `{ "ok": false, "error": "wrong_mode" }`
* `500` `{ "ok": false, "error": "internal_error" }`

**Side effects**

* Finalize `test.json` (set `"mode": "infinite"`, `"endedAt"`, optional counters).

---

## 5) Live Logs & Events (WebSocket)

### `WS /logs?testId=<uuid>`

Bi-directional not required; server → client is sufficient.

**Message Types (server → client)**

* Log line:

  ```json
  { "type": "log", "message": "Analyzer warmup...", "ts": "2025-08-19T02:05:01Z" }
  ```
* Presence detected:

  ```json
  { "type": "presence", "confidence": 0.94, "ts": "2025-08-19T02:05:05Z" }
  ```

  * `confidence` optional; include if available.

**Recommended cadence**

* Logs: push as they occur (INFO/WARN/ERROR).
* Presence: push once per trigger event (throttle if needed).

**Socket lifecycle**

* Open at test start; close on finalize/stop.
* If a client reconnects mid-test, replay last N lines (optional) or send a “resume” banner log.

---

## 6) (Optional) Health Check

### `GET /api/health`

Basic readiness/liveness probe.

**Response 200**

```json
{ "ok": true, "camera": "available", "uptimeSec": 12345 }
```

---

## cURL Examples

**Start a defined test**

```bash
curl -X POST https://your-host/api/start_defined \
  -H 'Content-Type: application/json' \
  -d '{
    "testId":"'"$(uuidgen)"'",
    "goal":"Trigger presence detection",
    "description":"caps, low light",
    "duration":10
  }'
```

**Start infinite**

```bash
curl -X POST https://your-host/api/start_infinite \
  -H 'Content-Type: application/json' \
  -d '{ "testId":"'"$(uuidgen)"'" }'
```

**Stop infinite**

```bash
curl -X POST https://your-host/api/stop_infinite \
  -H 'Content-Type: application/json' \
  -d '{ "testId":"d91c...-uuid" }'
```

---

## Contract Notes (important)

* **Single source of truth for logs:**
  The Python process **streams logs via WS** and also **persists them** to `"{testId}_test_data/logs.txt"`. The frontend does **not** write logs.

* **Frontend behavior matches this spec:**

  * Defined Test (10s): frontend starts timer; if WS sends `presence`, UI immediately shows “triggered.” If no presence by 10s, UI shows “not triggered.”
  * Infinite Test: frontend shows “Presence detected” modal on `presence`, but test continues unless the user chooses **Exit** (which navigates back) or presses **Stop test** (which calls `/api/stop_infinite` and shows “Test stopped”).

* **Idempotency:**

  * Repeated `start_*` with the same `testId` should return `409` if already active.
  * `stop_infinite` on a finished/missing `testId` → `404`.

* **Storage convention:**
  Always use the folder name `"{testId}_test_data"` so the UI instructions remain accurate.

* **Timestamps:**
  Use ISO-8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`) in `test.json` and WS messages.

* **Extensibility:**

  * You can add fields like `modelVersion`, `thresholds`, `fps`, etc., to `test.json` for auditability.
  * Consider a `"reason": "motion|face|person"` field in presence events if you support multiple triggers.

If you want, I can append a tiny FastAPI stub that implements these routes and the WS contract so you can drop it in and go.
