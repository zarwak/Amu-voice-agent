import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const SESSIONS_KEY = "amu-sessions";
const ACTIVE_SESSION_KEY = "amu-active-session";
const LEGACY_HISTORY_KEY = "amu-conversation-history";
const LEGACY_SESSIONS_KEY = "amu-past-sessions";
const ACCENT_STORAGE_KEY = "amu-accent-color";
const SENSITIVITY_STORAGE_KEY = "amu-mic-sensitivity";
const DEFAULT_ACCENT = "#f2a6c6";
const DEFAULT_SENSITIVITY = 5;

let turnCounter = 0;

function newId(prefix) {
  turnCounter += 1;
  return `${prefix}-${Date.now()}-${turnCounter}`;
}

function makeSession(turns = []) {
  return { id: newId("session"), title: "", turns, updatedAt: Date.now() };
}

function normalizeSession(s) {
  return {
    id: s.id || newId("session"),
    title: typeof s.title === "string" ? s.title : "",
    turns: Array.isArray(s.turns) ? s.turns.filter(Boolean) : [],
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
  };
}

// Sessions are the single source of truth. Older builds kept the active
// conversation in one key and archived ones in another; fold both in so an
// upgrade doesn't look like data loss.
function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(normalizeSession);
    }

    const migrated = [];
    const legacyPast = JSON.parse(localStorage.getItem(LEGACY_SESSIONS_KEY) || "[]");
    if (Array.isArray(legacyPast)) {
      legacyPast.filter(Boolean).forEach((s) => migrated.push(normalizeSession(s)));
    }
    const legacyHistory = JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY) || "[]");
    if (Array.isArray(legacyHistory) && legacyHistory.filter(Boolean).length > 0) {
      migrated.unshift(normalizeSession({ turns: legacyHistory.filter(Boolean) }));
    }
    return migrated;
  } catch {
    return [];
  }
}

function sessionTitle(session) {
  if (session.title) return session.title;
  const firstUserText = session.turns.find((t) => t?.userText)?.userText;
  return firstUserText ? firstUserText.slice(0, 60) : "New chat";
}

function loadStoredAccent() {
  return localStorage.getItem(ACCENT_STORAGE_KEY) || DEFAULT_ACCENT;
}

function loadStoredSensitivity() {
  const raw = Number(localStorage.getItem(SENSITIVITY_STORAGE_KEY));
  return raw >= 1 && raw <= 10 ? raw : DEFAULT_SENSITIVITY;
}

function initialState() {
  const loaded = loadSessions();
  const storedActive = localStorage.getItem(ACTIVE_SESSION_KEY);
  if (loaded.some((s) => s.id === storedActive)) {
    return { sessions: loaded, activeId: storedActive };
  }
  // Resume the most recent chat rather than dropping the user into a blank one.
  const mostRecent = [...loaded].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (mostRecent) return { sessions: loaded, activeId: mostRecent.id };
  const fresh = makeSession();
  return { sessions: [fresh], activeId: fresh.id };
}

const INITIAL = initialState();

export default function App() {
  const [uiState, setUiState] = useState("idle");
  const [micEnabled, setMicEnabled] = useState(true);
  const [sessions, setSessions] = useState(INITIAL.sessions);
  const [activeId, setActiveId] = useState(INITIAL.activeId);
  const [banner, setBanner] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accentColor, setAccentColor] = useState(loadStoredAccent);
  const [sensitivity, setSensitivity] = useState(loadStoredSensitivity);
  const levelRef = useRef(0);
  const pendingTurnRef = useRef(null);
  const rehydratedRef = useRef(false);

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const { playChunk } = useAudioPlayer();

  const activeTurns = useMemo(
    () => sessions.find((s) => s.id === activeId)?.turns ?? [],
    [sessions, activeId]
  );

  // Insert or update a turn in the active session. Turns are written as they
  // happen (not only once complete), so an in-progress exchange survives a
  // reload and the sidebar reflects it immediately.
  const upsertTurn = useCallback((turn) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeIdRef.current) return s;
        const exists = s.turns.some((t) => t.id === turn.id);
        return {
          ...s,
          turns: exists ? s.turns.map((t) => (t.id === turn.id ? turn : t)) : [...s.turns, turn],
          updatedAt: Date.now(),
        };
      })
    );
  }, []);

  const handleUserTranscript = useCallback(
    (text) => {
      const turn = { id: newId("turn"), userText: text, assistantText: "" };
      pendingTurnRef.current = turn;
      upsertTurn(turn);
      setUiState("thinking");
    },
    [upsertTurn]
  );

  const handleAssistantText = useCallback(
    (text) => {
      if (!pendingTurnRef.current) return;
      // Replace rather than mutate: this object is also referenced by session
      // state, and mutating state-referenced data in place risks stale renders.
      const updated = { ...pendingTurnRef.current, assistantText: text };
      pendingTurnRef.current = updated;
      upsertTurn(updated);
    },
    [upsertTurn]
  );

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
    pendingTurnRef.current = null;
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
    // Only persist chats that actually contain something. An untouched "+ New"
    // chat exists in memory but shouldn't survive a reload -- otherwise you
    // come back to a blank transcript with nothing selected in the sidebar,
    // which reads as lost data. On reload the most recent real chat resumes.
    localStorage.setItem(
      SESSIONS_KEY,
      JSON.stringify(sessions.filter((s) => s.turns.length > 0))
    );
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_SESSION_KEY, activeId);
  }, [activeId]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent-pink", accentColor);
    document.documentElement.style.setProperty("--accent-pink-deep", darken(accentColor, 0.18));
    document.documentElement.style.setProperty("--accent-glow", withAlpha(accentColor, 0.55));
    localStorage.setItem(ACCENT_STORAGE_KEY, accentColor);
  }, [accentColor]);

  useEffect(() => {
    localStorage.setItem(SENSITIVITY_STORAGE_KEY, String(sensitivity));
  }, [sensitivity]);

  // Give the backend the active chat's context on (re)connect, so the LLM's
  // memory matches what's on screen rather than starting blank.
  useEffect(() => {
    if (status !== "open") {
      rehydratedRef.current = false;
      return;
    }
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    const turns = activeTurns.filter(Boolean);
    if (turns.length > 0) {
      sendJson({
        type: "rehydrate",
        turns: turns.map((t) => ({ userText: t.userText, assistantText: t.assistantText })),
      });
    }
  }, [status, activeTurns, sendJson]);

  const handleNewSession = useCallback(() => {
    pendingTurnRef.current = null;
    const fresh = makeSession();
    setSessions((prev) => [fresh, ...prev.filter((s) => s.turns.length > 0)]);
    setActiveId(fresh.id);
    sendJson({ type: "new_session" });
  }, [sendJson]);

  const handleSelectSession = useCallback(
    (sessionId) => {
      const target = sessions.find((s) => s.id === sessionId);
      if (!target || sessionId === activeId) return;

      pendingTurnRef.current = null;
      // Drop the chat we're leaving if nothing was ever said in it.
      setSessions((prev) => prev.filter((s) => s.turns.length > 0 || s.id === sessionId));
      setActiveId(sessionId);

      const turns = target.turns.filter(Boolean);
      sendJson({ type: "new_session" });
      if (turns.length > 0) {
        sendJson({
          type: "rehydrate",
          turns: turns.map((t) => ({ userText: t.userText, assistantText: t.assistantText })),
        });
      }
    },
    [sessions, activeId, sendJson]
  );

  const handleRenameSession = useCallback((sessionId, newTitle) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
    );
  }, []);

  const handleDeleteSession = useCallback(
    (sessionId) => {
      const remaining = sessions.filter((s) => s.id !== sessionId);

      if (sessionId !== activeId) {
        setSessions(remaining);
        return;
      }

      // Deleting the open chat: fall back to the most recent one, or start
      // fresh if that was the last chat. Reset backend context either way.
      pendingTurnRef.current = null;
      sendJson({ type: "new_session" });

      const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (next) {
        setSessions(remaining);
        setActiveId(next.id);
        const turns = next.turns.filter(Boolean);
        if (turns.length > 0) {
          sendJson({
            type: "rehydrate",
            turns: turns.map((t) => ({
              userText: t.userText,
              assistantText: t.assistantText,
            })),
          });
        }
        return;
      }

      const fresh = makeSession();
      setSessions([fresh]);
      setActiveId(fresh.id);
    },
    [sessions, activeId, sendJson]
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

  const transcriptTurns = activeTurns.filter(Boolean);

  // An untouched chat isn't worth a row in the list until something is said.
  const listedSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.turns.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((s) => ({ id: s.id, title: sessionTitle(s), updatedAt: s.updatedAt })),
    [sessions]
  );

  return (
    <div className="app">
      <div className="shell">
        <SessionsSidebar
          sessions={listedSessions}
          activeId={activeId}
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
