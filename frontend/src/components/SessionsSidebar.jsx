import { useState } from "react";

export function SessionsSidebar({
  currentSession,
  sessions,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}) {
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");

  function startEditing(e, session) {
    e.stopPropagation();
    setEditingId(session.id);
    setDraftTitle(session.title);
  }

  function commitEdit(e, sessionId) {
    e.stopPropagation();
    const trimmed = draftTitle.trim();
    if (trimmed) onRenameSession(sessionId, trimmed);
    setEditingId(null);
  }

  function handleDelete(e, sessionId) {
    e.stopPropagation();
    if (window.confirm("Delete this session? This can't be undone.")) {
      onDeleteSession(sessionId);
    }
  }

  const hasAnySessions = currentSession || sessions.length > 0;

  return (
    <div className="sessions-sidebar">
      <div className="sessions-header">
        <h2>Sessions</h2>
        <button type="button" className="new-session-btn" onClick={onNewSession}>
          + New
        </button>
      </div>

      {!hasAnySessions ? (
        <p className="sessions-empty">Past conversations will appear here.</p>
      ) : (
        <div className="sessions-list">
          {currentSession && (
            <div className="session-item is-current-session">
              <span className="session-title">{currentSession.title}</span>
              <div className="session-item-footer">
                <span className="session-badge">Current</span>
                <span className="session-meta">
                  {currentSession.turns.length} exchange
                  {currentSession.turns.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          )}

          {sessions.map((s) => (
            <div
              key={s.id}
              className="session-item"
              onClick={() => editingId !== s.id && onSelectSession(s.id)}
            >
              {editingId === s.id ? (
                <input
                  className="session-title-input"
                  value={draftTitle}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit(e, s.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={(e) => commitEdit(e, s.id)}
                />
              ) : (
                <span className="session-title">{s.title}</span>
              )}
              <div className="session-item-footer">
                <span className="session-meta">
                  {s.turns.length} exchange{s.turns.length !== 1 ? "s" : ""}
                </span>
                <span className="session-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(e) => startEditing(e, s)}
                    aria-label="Rename session"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(e) => handleDelete(e, s.id)}
                    aria-label="Delete session"
                  >
                    🗑
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
