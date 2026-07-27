export function CaptionPanel({ userText, assistantText }) {
  return (
    <div className="caption-panel">
      {userText && <p className="caption-user">You: {userText}</p>}
      {assistantText && <p className="caption-assistant">Agent: {assistantText}</p>}
    </div>
  );
}
