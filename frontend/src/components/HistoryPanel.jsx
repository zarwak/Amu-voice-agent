export function HistoryPanel({ turns }) {
  return (
    <div className="history-panel">
      {turns.map((turn) => (
        <div key={turn.id} className="history-turn">
          <p className="history-user">You: {turn.userText}</p>
          <p className="history-assistant">Agent: {turn.assistantText}</p>
        </div>
      ))}
    </div>
  );
}
