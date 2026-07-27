import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useVoiceSocket } from "./hooks/useVoiceSocket";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { VoiceIndicator } from "./components/VoiceIndicator";
import { CaptionPanel } from "./components/CaptionPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws";

let turnIdCounter = 0;

export default function App() {
  const [uiState, setUiState] = useState("idle");
  const [micEnabled, setMicEnabled] = useState(true);
  const [userText, setUserText] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [history, setHistory] = useState([]);
  const [banner, setBanner] = useState(null);
  const levelRef = useRef(0);
  const pendingTurnRef = useRef(null);

  const { playChunk } = useAudioPlayer();

  const handleUserTranscript = useCallback((text) => {
    setUserText(text);
    setAssistantText("");
    pendingTurnRef.current = { id: turnIdCounter++, userText: text, assistantText: "" };
    setUiState("thinking");
  }, []);

  const handleAssistantText = useCallback((text) => {
    setAssistantText(text);
    if (pendingTurnRef.current) pendingTurnRef.current.assistantText = text;
  }, []);

  const handleAudioChunk = useCallback(
    (arrayBuffer) => {
      setUiState("speaking");
      playChunk(arrayBuffer);
    },
    [playChunk]
  );

  const handleNoSpeech = useCallback(() => {
    setUiState("listening");
  }, []);

  const handleTurnComplete = useCallback(() => {
    if (pendingTurnRef.current) {
      setHistory((prev) => [...prev, pendingTurnRef.current]);
      pendingTurnRef.current = null;
    }
    setUiState("listening");
  }, []);

  const handleError = useCallback((message) => {
    setBanner(message);
    setUiState("listening");
    setTimeout(() => setBanner(null), 4000);
  }, []);

  const { status, sendAudio } = useVoiceSocket(WS_URL, {
    onUserTranscript: handleUserTranscript,
    onAssistantText: handleAssistantText,
    onAudioChunk: handleAudioChunk,
    onNoSpeech: handleNoSpeech,
    onTurnComplete: handleTurnComplete,
    onError: handleError,
  });

  useEffect(() => {
    if (status !== "open") return;
    if (micEnabled && (uiState === "idle" || uiState === "off")) {
      setUiState("listening");
    } else if (!micEnabled && uiState === "listening") {
      setUiState("off");
    }
  }, [status, micEnabled, uiState]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setMicEnabled((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleUtteranceReady = useCallback(
    (blob) => {
      sendAudio(blob);
    },
    [sendAudio]
  );

  const handleLevel = useCallback((rms) => {
    levelRef.current = rms;
  }, []);

  const { error: micError } = useAudioCapture({
    enabled: status === "open" && micEnabled,
    onUtteranceReady: handleUtteranceReady,
    onLevel: handleLevel,
  });

  const stateLabel = {
    idle: "Getting ready…",
    off: "Paused — press Space to listen",
    listening: "Listening… (Space to pause)",
    thinking: "Thinking…",
    speaking: "Speaking…",
  }[uiState];

  return (
    <div className="app">
      <div className="card">
        <header className="app-header">
          <h1>Voice Agent</h1>
          <p className="subtitle">Talk, and I'll talk back.</p>
        </header>

        {status !== "open" && <p className="status-banner">Connection: {status}</p>}
        {micError && <p className="status-banner error">Microphone error: {micError}</p>}
        {banner && <p className="status-banner error">{banner}</p>}

        <VoiceIndicator state={uiState} levelRef={levelRef} />
        <p className="state-label">{stateLabel}</p>

        <CaptionPanel userText={userText} assistantText={assistantText} />
        <HistoryPanel turns={history} />
      </div>
    </div>
  );
}
