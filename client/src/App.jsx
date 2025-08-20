import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "http://127.0.0.1:8000"; // e.g. "" if same origin, or "http://localhost:8000"
const WS_BASE = "ws://127.0.0.1:8000"; // e.g. "" if same origin, or "ws://localhost:8000"

const COLORS = {
  bg: "#000000",
  panel: "#0b0b0b",
  blue: "#0d3b66",
  blueHover: "#155a8a",
  text: "#f8fafc",
  subtle: "#94a3b8",
  border: "#1f2937",
};

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border p-6" style={{ background: COLORS.panel, borderColor: COLORS.border }}>
        {title ? <h2 className="text-xl font-semibold mb-4" style={{ color: COLORS.text }}>{title}</h2> : null}
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = "solid" }) {
  const base = "px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  if (variant === "outline") {
    return (
      <button onClick={onClick} disabled={disabled} className={`${base} border`} style={{ borderColor: COLORS.blue, color: COLORS.text }}>
        {children}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={base}
      style={{ background: disabled ? COLORS.blue : COLORS.blue, color: COLORS.text }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget.style.background = COLORS.blueHover); }}
      onMouseLeave={(e) => { if (!disabled) (e.currentTarget.style.background = COLORS.blue); }}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [modal, setModal] = useState("welcome");
  const [webcamReady, setWebcamReady] = useState(false);
  const [videoError, setVideoError] = useState(null);

  const [testMode, setTestMode] = useState(null);
  const [testId, setTestId] = useState("");
  const [goal, setGoal] = useState("Trigger presence detection");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(10); // seconds (BE is authoritative)
  const [countdown, setCountdown] = useState(null);

  const [presenceDetected, setPresenceDetected] = useState(null);
  const [logs, setLogs] = useState([]);
  const [stopTestModal, setStopTestModal] = useState(false);

  const wsRef = useRef(null);
  const timerRef = useRef(null);

  function pushLog(line) {
    setLogs(prev => [`${new Date().toLocaleTimeString()} ${line}`, ...prev]);
  }

  // --- API helpers ---
  async function apiPost(path, payload) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      const msg = data?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  // --- WS handling ---
  function openLogsSocket(id) {
    closeLogsSocket();
    const wsUrl = `${WS_BASE}/logs`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => pushLog("WS connected.");
    ws.onclose = () => pushLog("WS disconnected.");
    ws.onerror = () => pushLog("WS error.");
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        console.log(msg)
        if (msg.type === "log" && msg.message) {
          pushLog(msg.message);
        } else if (msg.type === "presence") {
          setPresenceDetected(true);
          pushLog(`Presence detected.`);
        } else if (msg.type === "absence") {
          setPresenceDetected(false);
          pushLog(`Presence not detected.`);
        } else if (msg.type === "finalize") {
          // BE can notify end-of-test (defined mode)
          pushLog("Test finalized.");
        }
      } catch {
        pushLog(String(evt.data));
      }
    };
  }

  function closeLogsSocket() {
    try { wsRef.current?.close(); } catch { }
    wsRef.current = null;
  }

  // --- UI flows ---
  async function onConnectClicked() {
    try {
      setVideoError(null);
      const res = await apiPost("/api/connect_webcam", {});
      if (res?.ok) {
        setWebcamReady(true);
        pushLog("Backend camera acquired.");
      }
    } catch (e) {
      setVideoError(e?.message || "Failed to acquire backend camera");
      pushLog(`Error: ${e?.message || "connect_webcam failed"}`);
    }
  }

  function chooseDefined() {
    setTestMode("defined");
    const id = uuidv4();
    setTestId(id);
    setModal("defineTest");
  }

  async function startDefinedTest() {
    try {
      setPresenceDetected(null);
      setLogs([]);
      setModal(null);
      setCountdown(duration);

      openLogsSocket(testId);

      // Optional local UX timer (BE is authoritative)
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev === null) return null;
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      await apiPost("/api/start_defined", {
        testId,
        goal,
        description,
        duration
      });

      pushLog("Defined test started.");
    } catch (e) {
      pushLog(`Error: ${e?.message || "start_defined failed"}`);
    }
  }

  function chooseInfinite() {
    setTestMode("infinite");
    const id = uuidv4();
    setTestId(id);
    setModal(null);
    setLogs([]);
    setPresenceDetected(null);
    openLogsSocket(id);
    apiPost("/api/start_infinite", { testId: id })
      .then(() => pushLog("Infinite test started."))
      .catch(e => pushLog(`Error: ${e?.message || "start_infinite failed"}`));
  }

  function restartFlow() {
    setModal("testType");
    setPresenceDetected(null);
    setCountdown(null);
    setDescription("");
    setGoal("Trigger presence detection");
    setDuration(10);
    closeLogsSocket();
  }

  function infiniteExit() {
    setPresenceDetected(null);
    setStopTestModal(true);
    apiPost("/api/stop_infinite", { testId })
      .then(() => pushLog("Infinite test stopped."))
      .catch(e => pushLog(`Error: ${e?.message || "stop_infinite failed"}`))
      .finally(closeLogsSocket);
  }

  // React to presence events
  useEffect(() => {
    if (testMode === "defined" && typeof presenceDetected == "boolean") {
      if (timerRef.current) clearInterval(timerRef.current);
      setModal("resultTriggered");
    }
    if (testMode === "infinite" && typeof presenceDetected == "boolean") {
      setModal("infinitePrompt");
    }
  }, [presenceDetected, testMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      closeLogsSocket();
    };
  }, []);

  return (
    <div className="min-h-screen" style={{ background: COLORS.bg }}>
      <header className="sticky top-0 border-b" style={{ borderColor: COLORS.border }}>
        <div className="mx-auto max-w-7xl px-4 py-3">
          <h1 className="text-lg font-semibold tracking-wide" style={{ color: COLORS.text }}>Presence Check</h1>
          {testId && (
            <div className="mt-2">
              <span className="px-3 py-1 rounded-full text-xs border" style={{ color: COLORS.text, borderColor: COLORS.border }}>{testId}</span>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 grid gap-4" style={{ gridTemplateColumns: "7fr 3fr" }}>
        {/* Left panel (no video now) */}
        <section className="rounded-2xl border p-6 h-full flex items-center justify-center" style={{ background: COLORS.panel, borderColor: COLORS.border }}>
          <div className="text-center space-y-2">
            <div className="text-sm" style={{ color: COLORS.subtle }}>
              Camera preview is handled by the backend (OpenCV).
            </div>
            {testMode === "defined" && countdown !== null && (
              <div className="text-5xl font-bold" style={{ color: COLORS.text }}>{countdown}s</div>
            )}
            {videoError && <div className="text-xs" style={{ color: "#fca5a5" }}>{videoError}</div>}
          </div>
        </section>

        {/* Right panel (logs) */}
        <aside className="rounded-2xl border p-4 flex flex-col" style={{ background: COLORS.panel, borderColor: COLORS.border }}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ color: COLORS.text }}>Logs</h2>
            {testMode === "infinite" && <Btn variant="outline" onClick={infiniteExit}>Stop test</Btn>}
          </div>
          <div className="flex-1 overflow-auto rounded-xl p-3 bg-black/40 border" style={{ borderColor: COLORS.border }}>
            <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed" style={{ color: COLORS.text }}>
              {logs.length === 0 ? "(No logs yet)" : logs.join("\n")}
            </pre>
          </div>
        </aside>
      </main>

      {/* Modals */}
      <Modal open={modal === "welcome"} title="Welcome">
        <p className="text-sm" style={{ color: COLORS.subtle }}>Connect the backend camera, then pick a test type.</p>
        <div className="flex items-center gap-2 pt-2">
          <Btn onClick={onConnectClicked}>Connect Backend Webcam</Btn>
          <Btn onClick={() => setModal("testType")} disabled={!webcamReady}>Next</Btn>
        </div>
      </Modal>

      <Modal open={modal === "testType"} title="Test Type">
        <div className="space-y-3">
          <div className="rounded-xl border p-3" style={{ borderColor: COLORS.border }}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: COLORS.text }}>Defined Test (10s)</h3>
            <Btn onClick={chooseDefined}>Defined Test</Btn>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: COLORS.border }}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: COLORS.text }}>Infinite Test</h3>
            <Btn onClick={chooseInfinite}>Start Infinite</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={modal === "defineTest"} title="Define Test Case">
        <div className="space-y-3">
          <input value={testId} readOnly className="w-full px-3 py-2 rounded-lg bg-black/50 border text-xs" style={{ borderColor: COLORS.border, color: COLORS.text }} />
          <select value={goal} onChange={e => setGoal(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-black/50 border text-xs" style={{ borderColor: COLORS.border, color: COLORS.text }}>
            <option>Trigger presence detection</option>
            <option>Evade presence detection</option>
          </select>
          <textarea placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-black/50 border text-xs min-h-[90px]" style={{ borderColor: COLORS.border, color: COLORS.text }} />
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: COLORS.subtle }}>Duration (s):</span>
            <input type="number" min={1} max={120} value={duration} onChange={e => setDuration(Math.max(1, Math.min(120, Number(e.target.value || 10))))}
              className="w-24 px-3 py-2 rounded-lg bg-black/50 border text-xs" style={{ borderColor: COLORS.border, color: COLORS.text }} />
          </div>
          <Btn onClick={startDefinedTest}>Start test</Btn>
        </div>
      </Modal>

      <Modal open={modal === "resultTriggered"} title={`Presence detection ${!presenceDetected ? 'not' : ''} triggered`}>
        <p className="text-sm" style={{ color: COLORS.subtle }}>Logs and test files saved to "{testId}_test_data".</p>
        <Btn onClick={restartFlow}>Start test again</Btn>
      </Modal>

      <Modal open={modal === "infinitePrompt"} title={`Presence ${!presenceDetected ? 'not' : ''} detected`}>
        <Btn onClick={() => {
          chooseInfinite()
        }}>Continue</Btn>
        <Btn variant="outline" onClick={infiniteExit}>Exit</Btn>
      </Modal>

      <Modal open={stopTestModal} title="Test stopped">
        <Btn onClick={() => { setStopTestModal(false); setModal("testType"); }}>Exit</Btn>
      </Modal>
    </div>
  );
}
