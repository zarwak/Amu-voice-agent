import { useState } from "react";

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SessionsSidebar({
  sessions,
  activeId,
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
    if (window.confirm("Delete this chat? This can't be undone.")) {
      onDeleteSession(sessionId);
    }
  }

  return (
    <div className="sessions-sidebar">
      <div className="sessions-header">
        <h2>Chats</h2>
        <button type="button" className="new-session-btn" onClick={onNewSession}>
          + New
        </button>
      </div>

      {sessions.length === 0 ? (
        <p className="sessions-empty">Your chats will appear here.</p>
      ) : (
        <div className="sessions-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={"session-item" + (s.id === activeId ? " is-active" : "")}
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
                <span className="session-meta">{relativeTime(s.updatedAt)}</span>
                <span className="session-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(e) => startEditing(e, s)}
                    aria-label="Rename chat"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(e) => handleDelete(e, s.id)}
                    aria-label="Delete chat"
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
