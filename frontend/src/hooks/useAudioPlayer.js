import { useCallback, useRef, useState } from "react";

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioElRef = useRef(null);
  const urlRef = useRef(null);

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

  return { playChunk, stop, isPlaying };
}
