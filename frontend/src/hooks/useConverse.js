import { useCallback } from "react";

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * One conversation turn over plain HTTP.
 *
 * The backend is stateless (it runs as a serverless function), so the client
 * owns the conversation and sends the relevant history with every request.
 */
export function useConverse(apiBase) {
  const sendTurn = useCallback(
    async (blob, history) => {
      const form = new FormData();
      form.append("audio", blob, "audio.webm");
      form.append(
        "history",
        JSON.stringify(
          (history || []).map((t) => ({
            userText: t.userText,
            assistantText: t.assistantText,
          }))
        )
      );

      const response = await fetch(`${apiBase}/api/converse`, {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = await response.json();
      return {
        ...data,
        audioBuffer: data.audio ? base64ToArrayBuffer(data.audio) : null,
      };
    },
    [apiBase]
  );

  return { sendTurn };
}
