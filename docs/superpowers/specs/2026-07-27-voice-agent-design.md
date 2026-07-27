# Real-Time Voice AI Agent — Design (v1)

## Summary

A web app that lets a user have a real-time spoken conversation with an AI agent: the browser captures the user's voice, the backend transcribes it (Groq Whisper), generates a reply (Groq LLM), synthesizes it as speech (ElevenLabs), and streams the audio back — with live captions, a reactive voice/waveform indicator, barge-in (interrupting the agent mid-reply), and a conversation history panel.

Tool calling (web search, calculator, etc.) is explicitly **out of scope for v1** and deferred to phase 2, to keep the first build focused on making the core voice loop feel good.

## Goals / Success Criteria

- User can hold a spoken back-and-forth conversation with the agent entirely by voice, no typing required.
- Turn-taking is automatic (voice activity detection), not push-to-talk.
- The agent's reply starts being *heard* well before the full reply has finished generating (perceived low latency via sentence-chunked streaming).
- User can interrupt the agent while it's speaking (barge-in) and it stops immediately and listens.
- Live captions show both what the user said and what the agent is saying, in real time.
- A scrollable panel shows the full conversation history for the session.
- Deployed and reachable at a public URL: React/Vite frontend on Vercel, FastAPI backend on Railway.

## Non-Goals (v1)

- Tool/function calling (web search, calculator, calendar, etc.) — phase 2.
- Multiple voices/personas, emotion-aware TTS — future polish.
- Persisting conversation history across sessions/restarts (in-memory only for v1).
- Wake-word activation.
- Mobile-responsive layout, theming (dark/light toggle) — future polish.
- Authentication / multi-user support — single local user only.

## Architecture

A React (Vite) frontend and a FastAPI backend, deployed separately and connected over a single persistent WebSocket per session.

```
Browser (Vercel)                     FastAPI Backend (Railway)
┌─────────────────────┐              ┌──────────────────────┐
│ mic capture (VAD)    │──audio blob→│  /ws  session handler │
│ waveform canvas      │   wss://    │   ├─ Groq Whisper (STT)│
│ caption/history panel│←─text/audio──│   ├─ Groq LLM (stream) │
│ audio playback queue │   chunks     │   └─ ElevenLabs (TTS)  │
└─────────────────────┘              └──────────────────────┘
```

### Frontend components (React + Vite)

- `hooks/useAudioCapture.js` — mic stream + client-side VAD (energy/silence threshold) that decides when an utterance starts/ends.
- `hooks/useVoiceSocket.js` — owns the WebSocket connection; sends audio blobs and barge-in signals; dispatches incoming messages by type into React state.
- `hooks/useAudioPlayer.js` — queues and plays incoming TTS audio chunks in `seq` order; can be stopped instantly for barge-in.
- `components/VoiceIndicator.jsx` — the state visual (`idle → listening → thinking → speaking`) with the reactive waveform.
- `components/CaptionPanel.jsx` — live captions for both the user's and agent's turns.
- `components/HistoryPanel.jsx` — scrollable full conversation log.
- `App.jsx` — wires the hooks together and holds top-level conversation state.

### Backend components

- `main.py` — FastAPI app; exposes the `/ws` WebSocket route (the frontend is a separately deployed static app, not served by FastAPI).
- `session.py` — per-connection conversation state: message history for the LLM, and a cancellation handle for the current in-flight turn.
- `stt.py` — thin wrapper around Groq's Whisper endpoint (send full audio blob, get transcript back — this is a batch/REST call, not a streaming socket).
- `llm.py` — wrapper around Groq's chat completion API with `stream=True`, yielding tokens as they arrive.
- `tts.py` — wrapper around ElevenLabs; takes one sentence, returns audio bytes.
- `sentence_chunker.py` — pure function that consumes the growing token stream and yields complete sentences as soon as they're ready, so TTS can start on sentence 1 while the LLM is still generating sentence 2.

### Config

- Backend `.env` (local) / Railway environment variables (deployed): `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `CORS_ORIGINS` (the Vercel frontend URL) — none of these exist yet; implementation plan must include steps to obtain the two API keys (both providers have free tiers).
- `requirements.txt`: `fastapi`, `uvicorn[standard]`, `python-dotenv`, `groq`, `elevenlabs`, plus test deps (`pytest`, `pytest-asyncio`).
- Frontend `.env` (local) / Vercel environment variable (deployed): `VITE_WS_URL` — the backend's WebSocket URL (`ws://localhost:8000/ws` locally, `wss://<railway-app>.up.railway.app/ws` in production).
- Local dev: backend via `uvicorn main:app --reload`, frontend via `vite dev`; browser mic access (`getUserMedia`) works without HTTPS on `localhost`. In production both Vercel and Railway serve over HTTPS/WSS by default, which `getUserMedia` also requires.

## Deployment

- **Frontend → Vercel:** standard Vite/React static build, deployed via Vercel's GitHub integration (push to `main` → auto-deploy). `VITE_WS_URL` set as a Vercel project environment variable.
- **Backend → Railway:** deployed via Railway's GitHub integration, which detects the Python app and runs it (`uvicorn main:app --host 0.0.0.0 --port $PORT`). `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, and `CORS_ORIGINS` set as Railway environment variables.
- **Cross-origin:** since the frontend and backend live on different domains, the FastAPI app needs CORS configured (allow the Vercel origin) and the frontend connects to the backend's `wss://` WebSocket URL directly rather than a relative path.
- Local development continues to run both pieces on `localhost` (frontend on Vite's dev server, e.g. port 5173; backend on port 8000) — deployment doesn't change the day-to-day dev loop, only where the built app ends up.

## Data Flow — One Conversation Turn

1. **Idle/listening** — on page load, browser requests mic permission and starts streaming audio into the client-side VAD. UI shows a calm "listening" state.
2. **Speech detected** — VAD flags voice energy above threshold → UI switches to an active "listening" waveform reacting to mic input.
3. **Speech ends** — VAD sees ~600–800ms of silence → browser packages the recorded utterance as one audio blob and sends it over the WebSocket. UI switches to "thinking".
4. **Transcription** — backend sends the blob to Groq Whisper, gets text back, sends `{type: "user_transcript", text}` to the browser immediately so the user's own words appear in captions/history right away.
5. **Response generation** — backend calls the Groq LLM with streaming enabled, passing conversation history + the new message. As tokens arrive, they're fed through `sentence_chunker`. Each time a full sentence is ready:
   - it's sent to the browser as `{type: "assistant_text_delta"}` (captions update before audio exists)
   - it's sent to ElevenLabs for synthesis; resulting audio bytes are streamed to the browser as `{type: "audio_chunk", seq}`
6. **Playback** — on the first audio chunk, UI flips to "speaking"; `useAudioPlayer` plays chunks back-to-back in `seq` order, so playback starts well before the full reply has finished generating.
7. **Turn complete** — backend sends `{type: "turn_complete"}` once the LLM stream ends and the last audio chunk is flushed; UI returns to "listening" and VAD re-arms.
8. **Barge-in** (can happen any time during step 6) — if VAD detects the user talking while state is "speaking", the browser immediately stops audio playback, clears its playback queue, sends `{type: "barge_in"}`, and starts recording the new utterance. The backend cancels any in-flight LLM/TTS work for the interrupted turn.

Conversation history (for LLM context) lives server-side in `session.py`, in memory, for the lifetime of the WebSocket connection. No persistence to disk in v1.

## Build Staging

To keep a working version at every step:

- **Stage A:** WebSocket loop with full-turn (non-streamed) responses — record utterance → transcribe → full LLM reply → full TTS audio → play. Proves the end-to-end plumbing.
- **Stage B:** Add sentence-chunked streaming (the `sentence_chunker` + per-sentence TTS + progressive audio chunk delivery) on top of Stage A.
- **Stage C:** Add barge-in handling.

## Error Handling

- **Mic permission denied** → inline message explaining it's required; no crash. VAD/WebSocket simply never start.
- **No speech detected** in a recorded blob (Whisper returns empty/near-empty transcript) → skip the turn silently, return to "listening" (no error noise for background sound).
- **Groq LLM API error** (rate limit, timeout, etc.) → send `{type: "error", message}`; UI shows a small inline "something went wrong, try again" banner; state resets to "listening".
- **ElevenLabs TTS error** on a given sentence → skip audio for just that sentence but still deliver its caption text; continue with the next sentence (degrades to text-only for that one sentence rather than aborting the whole turn).
- **WebSocket drops** → client attempts one reconnect after a short delay; on failure, shows a clear "disconnected, refresh to reconnect" state rather than hanging silently.

## Testing Approach

Most of the interesting behavior here is I/O-bound (mic, live third-party APIs, audio playback) and impractical to unit test. Automated tests focus on the pure-logic pieces; the live voice loop is verified by running the app in-browser.

- `sentence_chunker` — unit tests: feed token fragments, assert complete sentences are yielded at the right boundaries, including edge cases (abbreviations/decimals not falsely triggering a split) and a max-length fallback if a "sentence" never ends.
- `session.py` history management — unit tests: adding messages, trimming, building the payload sent to the LLM.
- WebSocket message handling — tests against a mocked socket, asserting the right message types are emitted for a given sequence of inputs.
- End-to-end voice loop (mic → VAD → transcript → reply → audio → barge-in) — manually verified in the browser preview once built; not automated.

## Open Items for Phase 2 (explicitly deferred, not part of this spec)

- Tool/function calling.
- Multiple voices, emotion-aware TTS, adjustable rate/pitch.
- Dark/light theme, mobile-responsive layout.
- Persistent history across sessions.
- Wake-word activation.
