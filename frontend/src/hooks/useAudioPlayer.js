import { useCallback, useRef, useState } from "react";

// A one-sample silent WAV. Playing this inside a real tap handler satisfies
// mobile autoplay policies, so later replies (which arrive asynchronously,
// long after the tap) are allowed to play.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioElRef = useRef(null);
  const urlRef = useRef(null);
  const unlockedRef = useRef(false);

  // Must be called from a user-gesture handler. No-op after the first call.
  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;
    const primer = new Audio(SILENT_WAV);
    primer.play().catch(() => {});
  }, []);

  const playChunk = useCallback((arrayBuffer, onEnded) => {
    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const audio = new Audio(url);
    audioElRef.current = audio;
    setIsPlaying(true);

    const finish = () => {
      setIsPlaying(false);
      URL.revokeObjectURL(url);
      onEnded?.();
    };
    audio.onended = finish;
    // Don't strand the UI in "speaking" if playback fails (autoplay blocked,
    // decode error) -- treat it the same as reaching the end.
    audio.onerror = finish;
    audio.play().catch(finish);
  }, []);

  const stop = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.currentTime = 0;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  return { playChunk, stop, unlock, isPlaying };
}
