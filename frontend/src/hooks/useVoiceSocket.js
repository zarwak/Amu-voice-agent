import { useCallback, useEffect, useRef, useState } from "react";

export function useVoiceSocket(wsUrl, handlers) {
  const [status, setStatus] = useState("connecting");
  const socketRef = useRef(null);
  const handlersRef = useRef(handlers);
  const reconnectedRef = useRef(false);
  handlersRef.current = handlers;

  useEffect(() => {
    let cancelled = false;

    function connect() {
      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      setStatus("connecting");

      socket.onopen = () => {
        reconnectedRef.current = false;
        setStatus("open");
      };

      socket.onclose = () => {
        if (cancelled) return;
        if (!reconnectedRef.current) {
          reconnectedRef.current = true;
          setStatus("connecting");
          setTimeout(() => {
            if (!cancelled) connect();
          }, 1000);
        } else {
          setStatus("closed");
        }
      };

      socket.onerror = () => socket.close();

      socket.onmessage = (event) => {
        const h = handlersRef.current;
        if (typeof event.data === "string") {
          const msg = JSON.parse(event.data);
          if (msg.type === "user_transcript") h.onUserTranscript?.(msg.text);
          else if (msg.type === "assistant_text") h.onAssistantText?.(msg.text);
          else if (msg.type === "no_speech") h.onNoSpeech?.();
          else if (msg.type === "error") h.onError?.(msg.message);
          else if (msg.type === "turn_complete") h.onTurnComplete?.();
        } else {
          h.onAudioChunk?.(event.data);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, [wsUrl]);

  const sendAudio = useCallback((blob) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      blob.arrayBuffer().then((buf) => socket.send(buf));
    }
  }, []);

  const sendJson = useCallback((obj) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(obj));
    }
  }, []);

  return { status, sendAudio, sendJson };
}
