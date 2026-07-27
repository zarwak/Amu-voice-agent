export function SessionsSidebar({ sessions, onNewSession, onSelectSession }) {
  return (
    <div className="sessions-sidebar">
      <div className="sessions-header">
        <h2>Sessions</h2>
        <button type="button" className="new-session-btn" onClick={onNewSession}>
          + New
        </button>
      </div>

      {sessions.length === 0 ? (
        <p className="sessions-empty">Past conversations will appear here.</p>
      ) : (
        <div className="sessions-list">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="session-item"
              onClick={() => onSelectSession(s.id)}
            >
              <span className="session-title">{s.title}</span>
              <span className="session-meta">
                {s.turns.length} exchange{s.turns.length !== 1 ? "s" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
