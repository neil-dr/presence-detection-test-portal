import React, { useEffect, useMemo, useRef, useState } from "react";

// Updated Presence Check component per new requirements
// - Timer displayed prominently (separate large text, not inside Test ID chip)
// - Test ID chip is placed under page title
// - Infinite testing: replace Clear Logs button with "Stop Test" → opens modal
// - Logs are purely display-only, no buttons for clearing

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

export default function PresenceCheck() {
  const [modal, setModal] = useState("welcome");
  const [webcamReady, setWebcamReady] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [testMode, setTestMode] = useState(null);
  const [testId, setTestId] = useState("");
  const [goal, setGoal] = useState("Trigger presence detection");
  const [description, setDescription] = useState("");
  const [countdown, setCountdown] = useState(null);
  const [presenceDetected, setPresenceDetected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stopTestModal, setStopTestModal] = useState(false);

  const videoRef = useRef(null);
  const timerRef = useRef(null);

  function pushLog(line) {
    setLogs(prev => [`${new Date().toLocaleTimeString()} ${line}`, ...prev]);
  }

  async function startLocalWebcam() {
    try {
      setVideoError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setWebcamReady(true);
      pushLog("Local webcam stream started.");
    } catch (err) {
      setVideoError(err?.message || "Failed to access webcam");
      pushLog("Error: Failed to access webcam.");
    }
  }

  function onConnectClicked() {
    startLocalWebcam();
  }

  function chooseDefined() {
    setTestMode("defined");
    setTestId(uuidv4());
    setModal("defineTest");
  }

  function chooseInfinite() {
    setTestMode("infinite");
    setTestId(uuidv4());
    setModal(null);
  }

  function startDefinedTest() {
    setPresenceDetected(false);
    setModal(null);
    setCountdown(10);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          if (!presenceDetected) setModal("resultTimeout");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    if (testMode === "defined" && presenceDetected) {
      if (timerRef.current) clearInterval(timerRef.current);
      setModal("resultTriggered");
    }
    if (testMode === "infinite" && presenceDetected) {
      setModal("infinitePrompt");
    }
  }, [presenceDetected, testMode]);

  function restartFlow() {
    setModal("testType");
    setPresenceDetected(false);
    setCountdown(null);
    setDescription("");
    setGoal("Trigger presence detection");
  }

  function infiniteExit() {
    setPresenceDetected(false);
    setStopTestModal(true);
  }

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
        <section className="rounded-2xl border p-4 h-full" style={{ background: COLORS.panel, borderColor: COLORS.border }}>
          <div className="w-full h-full relative">
            <video ref={videoRef} className="w-full h-[70vh] object-cover rounded-xl bg-black" playsInline muted />
            {!webcamReady && <div className="absolute inset-0 flex items-center justify-center"><p className="text-sm" style={{ color: COLORS.subtle }}>Webcam preview will appear here</p></div>}
          </div>
          {testMode === "defined" && countdown !== null && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 text-5xl font-bold" style={{ color: COLORS.text }}>{countdown}s</div>
          )}
        </section>

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
        <p className="text-sm" style={{ color: COLORS.subtle }}>Connect the webcam, then pick a test type.</p>
        <div className="flex items-center gap-2 pt-2">
          <Btn onClick={onConnectClicked}>Connect to Webcam</Btn>
          <Btn onClick={() => setModal("testType")} disabled={!webcamReady}>Next</Btn>
        </div>
      </Modal>

      <Modal open={modal === "testType"} title="Test Type">
        <div className="space-y-3">
          <div className="rounded-xl border p-3" style={{ borderColor: COLORS.border }}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: COLORS.text }}>Defined Test</h3>
            <Btn onClick={chooseDefined}>Defined Test</Btn>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: COLORS.border }}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: COLORS.text }}>Infinite Test</h3>
            <Btn onClick={chooseInfinite}>Infinite Test</Btn>
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
          <div className="text-xs" style={{ color: COLORS.subtle }}>Test duration is 10 seconds.</div>
          <Btn onClick={startDefinedTest}>Start test</Btn>
        </div>
      </Modal>

      <Modal open={modal === "resultTriggered"} title="Presence detection triggered">
        <p className="text-sm" style={{ color: COLORS.subtle }}>Logs and test files saved to "{testId}_test_data".</p>
        <Btn onClick={restartFlow}>Start test again</Btn>
      </Modal>

      <Modal open={modal === "resultTimeout"} title="Presence detection was not triggered">
        <p className="text-sm" style={{ color: COLORS.subtle }}>Logs and test files saved to "{testId}_test_data".</p>
        <Btn onClick={restartFlow}>Start test again</Btn>
      </Modal>

      <Modal open={modal === "infinitePrompt"} title="Presence detected">
        <Btn onClick={() => setPresenceDetected(false)}>Continue</Btn>
        <Btn variant="outline" onClick={infiniteExit}>Exit</Btn>
      </Modal>

      <Modal open={stopTestModal} title="Test stopped">
        <Btn onClick={() => { setStopTestModal(false); setModal("testType"); }}>Exit</Btn>
      </Modal>
    </div>
  );
}
