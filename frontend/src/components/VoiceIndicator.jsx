import { useEffect, useRef } from "react";

const FIXED_COLORS = {
  idle: "#e8d5c4",
  off: "#d9c7b8",
  thinking: "#d98cae",
  speaking: "#f4b79a",
};

const BAR_COUNT = 7;
const BAR_WIDTH = 14;
const BAR_GAP = 10;
const VARIATION = [0.55, 0.85, 1, 0.7, 1, 0.8, 0.6];

export function VoiceIndicator({ state, levelRef, accentColor = "#f2a6c6" }) {
  const canvasRef = useRef(null);
  const accentRef = useRef(accentColor);
  accentRef.current = accentColor;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let rafId;
    let phase = 0;

    function draw() {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const midY = height / 2;
      const baseline = 10;
      const maxExtra = height / 2 - baseline;
      const totalWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
      const startX = (width - totalWidth) / 2;
      const fillColor = state === "listening" ? accentRef.current : FIXED_COLORS[state] || FIXED_COLORS.idle;

      if (state === "thinking") phase += 0.12;
      if (state === "speaking") phase += 0.25;

      for (let i = 0; i < BAR_COUNT; i += 1) {
        let extra = 0;
        if (state === "listening") {
          extra = (levelRef.current || 0) * maxExtra * 4 * VARIATION[i];
        } else if (state === "thinking") {
          extra = (Math.sin(phase + i * 0.7) * 0.5 + 0.5) * maxExtra * 0.35;
        } else if (state === "speaking") {
          extra = (Math.sin(phase + i * 0.9) * 0.5 + 0.5) * maxExtra * 0.85;
        }
        const barHeight = Math.min(baseline + extra, maxExtra * 2);
        const x = startX + i * (BAR_WIDTH + BAR_GAP);
        const y = midY - barHeight / 2;
        const radius = BAR_WIDTH / 2;

        ctx.fillStyle = fillColor;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, BAR_WIDTH, barHeight, radius);
        } else {
          ctx.rect(x, y, BAR_WIDTH, barHeight);
        }
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafId);
  }, [state, levelRef]);

  return <canvas ref={canvasRef} width={220} height={140} className="voice-indicator" />;
}
