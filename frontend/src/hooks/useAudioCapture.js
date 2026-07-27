import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_SILENCE_THRESHOLD = 0.02;
const SILENCE_DURATION_MS = 1000;
const MIN_SPEECH_MS = 300;

export function useAudioCapture({
  enabled,
  onUtteranceReady,
  onLevel,
  silenceThreshold = DEFAULT_SILENCE_THRESHOLD,
}) {
  const [micState, setMicState] = useState("idle");
  const [error, setError] = useState(null);

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const speechStartRef = useRef(null);
  const silenceStartRef = useRef(null);
  const rafRef = useRef(null);
  const thresholdRef = useRef(silenceThreshold);
  thresholdRef.current = silenceThreshold;

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        setMicState("listening");
        setError(null);

        const dataArray = new Uint8Array(analyser.fftSize);

        function startRecording() {
          chunksRef.current = [];
          const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
          };
          recorder.start();
          recorderRef.current = recorder;
        }

        function stopRecording() {
          const recorder = recorderRef.current;
          if (!recorder) return;
          recorder.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: "audio/webm" });
            chunksRef.current = [];
            onUtteranceReady(blob);
          };
          recorder.stop();
          recorderRef.current = null;
        }

        const tick = () => {
          analyser.getByteTimeDomainData(dataArray);
          let sumSquares = 0;
          for (let i = 0; i < dataArray.length; i += 1) {
            const normalized = (dataArray[i] - 128) / 128;
            sumSquares += normalized * normalized;
          }
          const rms = Math.sqrt(sumSquares / dataArray.length);
          onLevel?.(rms);
          const now = performance.now();
          const threshold = thresholdRef.current;

          if (rms > threshold) {
            silenceStartRef.current = null;
            if (!speechStartRef.current) {
              speechStartRef.current = now;
              startRecording();
              setMicState("speech_detected");
            }
          } else if (speechStartRef.current) {
            if (!silenceStartRef.current) silenceStartRef.current = now;
            const silenceElapsed = now - silenceStartRef.current;
            const speechElapsed = now - speechStartRef.current;
            if (silenceElapsed > SILENCE_DURATION_MS && speechElapsed > MIN_SPEECH_MS) {
              stopRecording();
              speechStartRef.current = null;
              silenceStartRef.current = null;
              setMicState("listening");
            }
          }

          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        setError(err.message || "Microphone access was denied.");
        setMicState("idle");
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
      setMicState("idle");
    };
  }, [enabled, onUtteranceReady, onLevel]);

  return { micState, error };
}
