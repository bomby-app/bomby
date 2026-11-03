import { useEffect, useRef, useState } from "react";
import "./App.css";

// A temporary page for roadmap step 3's first check: can the app's webview use the mic?
// It is replaced by the real UI (projects, call, Claude panel) once this passes.

type MicState =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "live"; device: string }
  | { kind: "error"; message: string };

function App() {
  const [mic, setMic] = useState<MicState>({ kind: "idle" });
  const [level, setLevel] = useState(0);
  const stop = useRef<() => void>(() => {});

  useEffect(() => () => stop.current(), []);

  async function start() {
    setMic({ kind: "asking" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);

      let frame = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const s of samples) peak = Math.max(peak, Math.abs(s - 128) / 128);
        setLevel(peak);
        frame = requestAnimationFrame(tick);
      };
      tick();

      stop.current = () => {
        cancelAnimationFrame(frame);
        for (const t of stream.getTracks()) t.stop();
        void audio.close();
        setLevel(0);
      };
      setMic({ kind: "live", device: track?.label || "unnamed input" });
    } catch (e) {
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setMic({ kind: "error", message });
    }
  }

  function end() {
    stop.current();
    stop.current = () => {};
    setMic({ kind: "idle" });
  }

  return (
    <main className="container">
      <h1>Claude LiveKit</h1>
      <p>Microphone check</p>

      {mic.kind === "live" ? (
        <button type="button" onClick={end}>
          Stop
        </button>
      ) : (
        <button type="button" onClick={start} disabled={mic.kind === "asking"}>
          {mic.kind === "asking" ? "Asking for the mic..." : "Test microphone"}
        </button>
      )}

      <div className="meter" aria-label="Input level">
        <div className="meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>

      {mic.kind === "live" && <p>Listening on: {mic.device}</p>}
      {mic.kind === "error" && <p className="error">{mic.message}</p>}
    </main>
  );
}

export default App;
