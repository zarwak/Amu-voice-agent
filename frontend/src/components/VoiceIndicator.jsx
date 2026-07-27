import { useEffect, useRef } from "react";

const COLORS = {
  idle: "#e8d5c4",
  listening: "#f2a6c6",
  thinking: "#d98cae",
  speaking: "#f4b79a",
};

export function VoiceIndicator({ state, levelRef }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let rafId;
    let phase = 0;

    function draw() {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const baseRadius = 40;

      let radius = baseRadius;
      if (state === "listening") {
        radius = baseRadius + (levelRef.current || 0) * 120;
      } else if (state === "thinking") {
        phase += 0.15;
        radius = baseRadius + Math.sin(phase) * 6;
      } else if (state === "speaking") {
        phase += 0.3;
        radius = baseRadius + Math.abs(Math.sin(phase)) * 25;
      }

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[state] || COLORS.idle;
      ctx.fill();

      rafId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafId);
  }, [state, levelRef]);

  return <canvas ref={canvasRef} width={200} height={200} className="voice-indicator" />;
}
