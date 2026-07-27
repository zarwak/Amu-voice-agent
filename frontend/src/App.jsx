import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useVoiceSocket } from "./hooks/useVoiceSocket";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { VoiceIndicator } from "./components/VoiceIndicator";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { SessionsSidebar } from "./components/SessionsSidebar";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws";
const STORAGE_KEY = "amu-conversation-history";
const SESSIONS_STORAGE_KEY = "amu-past-sessions";

let turnIdCounter = 0;

function loadStoredHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const maxId = parsed.reduce(
      (max, t) => (typeof t?.id === "number" && t.id > max ? t.id : max),
      -1
    );
    turnIdCounter = maxId + 1;
    return parsed;
  } catch {
    return [];
  }
}

function loadStoredSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function makeSessionFromTurns(turns) {
  return {
    id: `session-${Date.now()}`,
    title: turns[0]?.userText?.slice(0, 50) || "Conversation",
    turns,
    updatedAt: Date.now(),
  };
}

export default function App() {
  const [uiState, setUiState] = useState("idle");
  const [micEnabled, setMicEnabled] = useState(true);
  const [history, setHistory] = useState(loadStoredHistory);
  const [pastSessions, setPastSessions] = useState(loadStoredSessions);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [banner, setBanner] = useState(null);
  const levelRef = useRef(0);
  const pendingTurnRef = useRef(null);
  const rehydratedRef = useRef(false);

  const { playChunk } = useAudioPlayer();

  const handleUserTranscript = useCallback((text) => {
    const turn = { id: turnIdCounter++, userText: text, assistantText: "" };
    pendingTurnRef.current = turn;
    setCurrentTurn(turn);
    setUiState("thinking");
  }, []);

  const handleAssistantText = useCallback((text) => {
    if (pendingTurnRef.current) pendingTurnRef.current.assistantText = text;
    setCurrentTurn((prev) => (prev ? { ...prev, assistantText: text } : prev));
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
    setCurrentTurn(null);
    setUiState("listening");
  }, []);

  const handleError = useCallback((message) => {
    setBanner(message);
    setUiState("listening");
    setTimeout(() => setBanner(null), 4000);
  }, []);

  const { status, sendAudio, sendJson } = useVoiceSocket(WS_URL, {
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(pastSessions));
  }, [pastSessions]);

  useEffect(() => {
    if (status === "open" && !rehydratedRef.current) {
      rehydratedRef.current = true;
      if (history.length > 0) {
        sendJson({
          type: "rehydrate",
          turns: history.map((t) => ({ userText: t.userText, assistantText: t.assistantText })),
        });
      }
    } else if (status !== "open") {
      rehydratedRef.current = false;
    }
  }, [status, history, sendJson]);

  const handleNewSession = useCallback(() => {
    if (history.length > 0) {
      setPastSessions((prev) => [makeSessionFromTurns(history), ...prev]);
    }
    pendingTurnRef.current = null;
    setCurrentTurn(null);
    setHistory([]);
    sendJson({ type: "new_session" });
  }, [history, sendJson]);

  const handleSelectSession = useCallback(
    (sessionId) => {
      const target = pastSessions.find((s) => s.id === sessionId);
      if (!target) return;

      setPastSessions((prev) => {
        const withoutTarget = prev.filter((s) => s.id !== sessionId);
        return history.length > 0
          ? [makeSessionFromTurns(history), ...withoutTarget]
          : withoutTarget;
      });

      pendingTurnRef.current = null;
      setCurrentTurn(null);
      setHistory(target.turns);

      sendJson({ type: "new_session" });
      sendJson({
        type: "rehydrate",
        turns: target.turns.map((t) => ({
          userText: t.userText,
          assistantText: t.assistantText,
        })),
      });
    },
    [history, pastSessions, sendJson]
  );

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
    thinking: "Thinking",
    speaking: "Speaking…",
  }[uiState];

  const transcriptTurns = [...history, ...(currentTurn ? [currentTurn] : [])];

  return (
    <div className="app">
      <div className="shell">
        <SessionsSidebar
          sessions={pastSessions}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
        />

        <div className="voice-card">
          <header className="app-header">
            <h1>AMU</h1>
            <p className="subtitle">Your voice assistant</p>
          </header>

          {status !== "open" && <p className="status-banner">Connection: {status}</p>}
          {micError && <p className="status-banner error">Microphone error: {micError}</p>}
          {banner && <p className="status-banner error">{banner}</p>}

          <VoiceIndicator state={uiState} levelRef={levelRef} />
          <p className="state-label">
            {stateLabel}
            {uiState === "thinking" && (
              <span className="thinking-dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            )}
          </p>
        </div>

        <div className="transcript-card">
          <h2>Transcript</h2>
          <TranscriptPanel turns={transcriptTurns} />
        </div>
      </div>
    </div>
  );
}
