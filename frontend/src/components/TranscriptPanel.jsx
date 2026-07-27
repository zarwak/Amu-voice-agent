import { useEffect, useRef } from "react";

export function TranscriptPanel({ turns }) {
  const visibleTurns = turns.filter(Boolean);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleTurns.length, visibleTurns[visibleTurns.length - 1]?.assistantText]);

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
          {turn.userText && (
            <p className="transcript-user">
              <span className="msg-label">You</span>
              {turn.userText}
            </p>
          )}
          {turn.assistantText && (
            <p className="transcript-assistant">
              <span className="msg-label">AMU</span>
              {turn.assistantText}
            </p>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
