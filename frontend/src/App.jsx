import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useVoiceSocket } from "./hooks/useVoiceSocket";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { VoiceIndicator } from "./components/VoiceIndicator";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { SessionsSidebar } from "./components/SessionsSidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { darken, withAlpha, sensitivityToThreshold } from "./utils/color";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws";
const STORAGE_KEY = "amu-conversation-history";
const SESSIONS_STORAGE_KEY = "amu-past-sessions";
const ACCENT_STORAGE_KEY = "amu-accent-color";
const SENSITIVITY_STORAGE_KEY = "amu-mic-sensitivity";
const DEFAULT_ACCENT = "#f2a6c6";
const DEFAULT_SENSITIVITY = 5;

let turnIdCounter = 0;

function loadStoredHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const clean = parsed.filter(Boolean);
    const maxId = clean.reduce(
      (max, t) => (typeof t?.id === "number" && t.id > max ? t.id : max),
      -1
    );
    turnIdCounter = maxId + 1;
    return clean;
  } catch {
    return [];
  }
}

function loadStoredSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(Boolean)
      .map((s) => ({ ...s, turns: Array.isArray(s.turns) ? s.turns.filter(Boolean) : [] }));
  } catch {
    return [];
  }
}

function makeSessionFromTurns(turns) {
  const clean = turns.filter(Boolean);
  return {
    id: `session-${Date.now()}`,
    title: clean[0]?.userText?.slice(0, 50) || "Conversation",
    turns: clean,
    updatedAt: Date.now(),
  };
}

function loadStoredAccent() {
  return localStorage.getItem(ACCENT_STORAGE_KEY) || DEFAULT_ACCENT;
}

function loadStoredSensitivity() {
  const raw = Number(localStorage.getItem(SENSITIVITY_STORAGE_KEY));
  return raw >= 1 && raw <= 10 ? raw : DEFAULT_SENSITIVITY;
}

export default function App() {
  const [uiState, setUiState] = useState("idle");
  const [micEnabled, setMicEnabled] = useState(true);
  const [history, setHistory] = useState(loadStoredHistory);
  const [pastSessions, setPastSessions] = useState(loadStoredSessions);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [banner, setBanner] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accentColor, setAccentColor] = useState(loadStoredAccent);
  const [sensitivity, setSensitivity] = useState(loadStoredSensitivity);
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
    if (!pendingTurnRef.current) return;
    // Replace rather than mutate: the ref and currentTurn state point at the
    // same object, and mutating state-referenced data in place is how you get
    // stale renders. Keeping their identity in sync also guarantees the turn
    // that lands in history is exactly what was shown on screen.
    const updated = { ...pendingTurnRef.current, assistantText: text };
    pendingTurnRef.current = updated;
    setCurrentTurn(updated);
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
    // Capture the turn into a local BEFORE clearing the ref. State updaters
    // are lazy -- React runs them during the next render, and StrictMode runs
    // them twice -- so an updater that read pendingTurnRef.current directly
    // would see the already-nulled ref and append null instead of the turn.
    const completedTurn = pendingTurnRef.current;
    pendingTurnRef.current = null;
    if (completedTurn) {
      setHistory((prev) => [...prev, completedTurn]);
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
    const toSave = currentTurn ? [...history, currentTurn] : history;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave.filter(Boolean)));
  }, [history, currentTurn]);

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(pastSessions));
  }, [pastSessions]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent-pink", accentColor);
    document.documentElement.style.setProperty("--accent-pink-deep", darken(accentColor, 0.18));
    document.documentElement.style.setProperty("--accent-glow", withAlpha(accentColor, 0.55));
    localStorage.setItem(ACCENT_STORAGE_KEY, accentColor);
  }, [accentColor]);

  useEffect(() => {
    localStorage.setItem(SENSITIVITY_STORAGE_KEY, String(sensitivity));
  }, [sensitivity]);

  useEffect(() => {
    if (status === "open" && !rehydratedRef.current) {
      rehydratedRef.current = true;
      const cleanHistory = history.filter(Boolean);
      if (cleanHistory.length > 0) {
        sendJson({
          type: "rehydrate",
          turns: cleanHistory.map((t) => ({ userText: t.userText, assistantText: t.assistantText })),
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

      const cleanTarget = target.turns.filter(Boolean);
      pendingTurnRef.current = null;
      setCurrentTurn(null);
      setHistory(cleanTarget);

      sendJson({ type: "new_session" });
      sendJson({
        type: "rehydrate",
        turns: cleanTarget.map((t) => ({
          userText: t.userText,
          assistantText: t.assistantText,
        })),
      });
    },
    [history, pastSessions, sendJson]
  );

  const handleRenameSession = useCallback((sessionId, newTitle) => {
    setPastSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
    );
  }, []);

  const handleDeleteSession = useCallback((sessionId) => {
    setPastSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }, []);

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

  const uiStateRef = useRef(uiState);
  uiStateRef.current = uiState;

  const handleUtteranceReady = useCallback(
    (blob) => {
      // Ignore speech captured while a turn is already in flight (thinking/
      // speaking), so one utterance can't trigger multiple overlapping
      // replies. Read via ref rather than a dependency so this callback's
      // identity stays stable -- useAudioCapture's effect depends on it, and
      // an unstable reference would tear down/recreate the mic every turn.
      if (uiStateRef.current !== "listening") return;
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
    silenceThreshold: sensitivityToThreshold(sensitivity),
  });

  const stateLabel = {
    idle: "Getting ready…",
    off: "Paused — press Space to listen",
    listening: "Listening… (Space to pause)",
    thinking: "Thinking",
    speaking: "Speaking…",
  }[uiState];

  const transcriptTurns = [...history, ...(currentTurn ? [currentTurn] : [])].filter(Boolean);

  const currentSession =
    transcriptTurns.length > 0
      ? {
          id: "current",
          title: transcriptTurns[0]?.userText?.slice(0, 50) || "Current conversation",
          turns: transcriptTurns,
        }
      : null;

  return (
    <div className="app">
      <div className="shell">
        <SessionsSidebar
          currentSession={currentSession}
          sessions={pastSessions}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
        />

        <div className="voice-card">
          <header className="app-header">
            <button
              type="button"
              className="icon-btn settings-toggle"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
            >
              ⚙
            </button>
            <h1>AMU</h1>
            <p className="subtitle">Your voice assistant</p>
          </header>

          {status !== "open" && <p className="status-banner">Connection: {status}</p>}
          {micError && <p className="status-banner error">Microphone error: {micError}</p>}
          {banner && <p className="status-banner error">{banner}</p>}

          <VoiceIndicator state={uiState} levelRef={levelRef} accentColor={accentColor} />
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

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        accentColor={accentColor}
        onAccentColorChange={setAccentColor}
        sensitivity={sensitivity}
        onSensitivityChange={setSensitivity}
      />
    </div>
  );
}
