export function TranscriptPanel({ turns }) {
  const visibleTurns = turns.filter(Boolean);

  if (visibleTurns.length === 0) {
    return <p className="transcript-empty">Your conversation will appear here.</p>;
  }

  return (
    <div className="transcript-panel">
      {visibleTurns.map((turn, i) => (
        <div
          key={turn.id}
          className={
            "transcript-turn" + (i === visibleTurns.length - 1 ? " is-current" : "")
          }
        >
          {turn.userText && <p className="transcript-user">You: {turn.userText}</p>}
          {turn.assistantText && (
            <p className="transcript-assistant">AMU: {turn.assistantText}</p>
          )}
        </div>
      ))}
    </div>
  );
}
