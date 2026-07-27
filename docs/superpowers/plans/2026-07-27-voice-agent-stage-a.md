# Voice Agent — Stage A (Core Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, deployed, full-turn (non-streaming) real-time voice conversation loop — mic → VAD → Groq Whisper (STT) → Groq LLM → ElevenLabs (TTS) → playback — with a reactive voice indicator, live captions, conversation history, and graceful error handling, deployed with the React/Vite frontend on Vercel and the FastAPI backend on Railway.

This plan implements **Stage A** from `docs/superpowers/specs/2026-07-27-voice-agent-design.md`. Sentence-chunked streaming (Stage B) and barge-in (Stage C) are intentionally **not** part of this plan — they become their own follow-up plans once Stage A is built and verified working end to end. Tool/function calling is out of scope for all of v1 per the spec.

**Architecture:** A FastAPI backend exposes a single `/ws` WebSocket endpoint that runs the STT → LLM → TTS pipeline once per user utterance and streams back JSON control messages plus one binary audio frame per turn. A React (Vite) frontend captures the mic using a simple energy-based voice-activity detector (VAD), sends each complete utterance as one audio blob over the socket, and renders a state-driven UI (voice indicator, live captions, history panel).

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, python-dotenv, `groq` SDK, `elevenlabs` SDK, pytest (backend). React 18 + Vite, native Web Audio API / MediaRecorder / WebSocket (no extra frontend libraries) (frontend).

## Global Constraints

- Tool/function calling is out of scope for this plan (spec: deferred to phase 2).
- WebSocket message protocol (server → client, JSON text frames unless noted): `{"type": "user_transcript", "text": str}`, `{"type": "assistant_text", "text": str}`, `{"type": "no_speech"}`, `{"type": "error", "message": str}`, `{"type": "turn_complete"}`, plus exactly one raw **binary** frame per turn carrying MP3 audio bytes (only sent if TTS succeeded).
- Client → server: raw **binary** frames only, one complete utterance audio blob (`audio/webm`) per frame.
- Backend env vars: `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (default `21m00Tcm4TlvDq8ikWAM`), `CORS_ORIGINS` (comma-separated, default `http://localhost:5173`).
- Frontend env var: `VITE_WS_URL` (default `ws://localhost:8000/ws`).
- VAD constants (client-side): silence threshold `0.02` (RMS, 0–1 scale), silence duration `700ms`, minimum speech duration `300ms` before a silence gap ends an utterance.
- Deployment targets: frontend → Vercel, backend → Railway (per spec).
- Every backend test run uses `python -m pytest tests/ -v` from inside `backend/` (not bare `pytest`) — this ensures `backend/` is on `sys.path` so `from main import app` etc. resolve correctly.
- Every frontend "does it compile" check uses `npm run build` from inside `frontend/`.

---

## File Structure

```
voice-agent/
├── .gitignore
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── Procfile
│   ├── main.py              # FastAPI app, /health, /ws
│   ├── session.py           # ConversationSession
│   ├── stt.py                # Groq Whisper wrapper
│   ├── llm.py                # Groq chat completion wrapper
│   ├── tts.py                # ElevenLabs wrapper
│   └── tests/
│       ├── test_main_health.py
│       ├── test_session.py
│       ├── test_stt.py
│       ├── test_llm.py
│       ├── test_tts.py
│       └── test_main_ws.py
└── frontend/
    ├── .env.example
    └── src/
        ├── App.jsx
        ├── App.css
        ├── hooks/
        │   ├── useAudioCapture.js
        │   ├── useVoiceSocket.js
        │   └── useAudioPlayer.js
        └── components/
            ├── VoiceIndicator.jsx
            ├── CaptionPanel.jsx
            └── HistoryPanel.jsx
```

---

### Task 1: Backend project setup + minimal FastAPI app

**Files:**
- Create: `.gitignore` (repo root)
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/main.py`
- Test: `backend/tests/test_main_health.py`

**Interfaces:**
- Produces: FastAPI app object `app` (in `backend/main.py`), with a `GET /health` route returning `{"status": "ok"}`.

- [ ] **Step 1: Create the repo-root `.gitignore`**

```gitignore
# Python
__pycache__/
*.pyc
.venv/
venv/
backend/.env

# Node
node_modules/
frontend/dist/
frontend/.env

# OS
.DS_Store
```

- [ ] **Step 2: Create `backend/requirements.txt`**

```
fastapi
uvicorn[standard]
python-dotenv
groq
elevenlabs
pytest
pytest-asyncio
httpx
```

- [ ] **Step 3: Create `backend/.env.example`**

```
GROQ_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
CORS_ORIGINS=http://localhost:5173
```

- [ ] **Step 4: Set up the virtual environment and install dependencies**

```bash
cd backend
python -m venv venv
source venv/Scripts/activate   # Windows Git Bash. macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
```

- [ ] **Step 5: Write the failing test**

`backend/tests/test_main_health.py`:

```python
from fastapi.testclient import TestClient

from main import app


def test_health_endpoint():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 6: Run the test to verify it fails**

Run (from `backend/`): `python -m pytest tests/ -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'main'`

- [ ] **Step 7: Write the minimal implementation**

`backend/main.py`:

```python
from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `python -m pytest tests/ -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add .gitignore backend/requirements.txt backend/.env.example backend/main.py backend/tests/test_main_health.py
git commit -m "feat(backend): scaffold FastAPI app with health endpoint"
```

---

### Task 2: `session.py` — conversation history

**Files:**
- Create: `backend/session.py`
- Test: `backend/tests/test_session.py`

**Interfaces:**
- Produces: `ConversationSession` class — `__init__(system_prompt: str = DEFAULT_SYSTEM_PROMPT)`, `.add_user_message(text: str) -> None`, `.add_assistant_message(text: str) -> None`, `.get_messages() -> list[dict]` (returns a copy; each dict is `{"role": ..., "content": ...}`). Also exports `DEFAULT_SYSTEM_PROMPT: str`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_session.py`:

```python
from session import ConversationSession, DEFAULT_SYSTEM_PROMPT


def test_starts_with_system_prompt():
    session = ConversationSession()
    assert session.get_messages() == [{"role": "system", "content": DEFAULT_SYSTEM_PROMPT}]


def test_add_user_and_assistant_messages():
    session = ConversationSession()
    session.add_user_message("hi")
    session.add_assistant_message("hello!")
    messages = session.get_messages()
    assert messages[1] == {"role": "user", "content": "hi"}
    assert messages[2] == {"role": "assistant", "content": "hello!"}


def test_get_messages_returns_a_copy():
    session = ConversationSession()
    messages = session.get_messages()
    messages.append({"role": "user", "content": "leaked"})
    assert len(session.get_messages()) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_session.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'session'`

- [ ] **Step 3: Write the minimal implementation**

`backend/session.py`:

```python
DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful, friendly voice assistant. Keep replies concise and "
    "conversational, since they will be read aloud."
)


class ConversationSession:
    def __init__(self, system_prompt: str = DEFAULT_SYSTEM_PROMPT):
        self._messages = [{"role": "system", "content": system_prompt}]

    def add_user_message(self, text: str) -> None:
        self._messages.append({"role": "user", "content": text})

    def add_assistant_message(self, text: str) -> None:
        self._messages.append({"role": "assistant", "content": text})

    def get_messages(self) -> list[dict]:
        return list(self._messages)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_session.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/session.py backend/tests/test_session.py
git commit -m "feat(backend): add ConversationSession for LLM message history"
```

---

### Task 3: `stt.py` — Groq Whisper transcription wrapper

**Files:**
- Create: `backend/stt.py`
- Test: `backend/tests/test_stt.py`

**Interfaces:**
- Consumes: any object shaped like a `groq.Groq` client (mocked in tests).
- Produces: `transcribe_audio(client, audio_bytes: bytes, filename: str = "audio.webm") -> str` — returns the trimmed transcript text, or `""` if nothing was transcribed.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_stt.py`:

```python
from unittest.mock import MagicMock

from stt import transcribe_audio


def test_transcribe_audio_returns_text():
    client = MagicMock()
    client.audio.transcriptions.create.return_value = MagicMock(text="hello world")

    result = transcribe_audio(client, b"fake-bytes")

    assert result == "hello world"
    client.audio.transcriptions.create.assert_called_once_with(
        file=("audio.webm", b"fake-bytes"),
        model="whisper-large-v3-turbo",
    )


def test_transcribe_audio_strips_whitespace_only_to_empty():
    client = MagicMock()
    client.audio.transcriptions.create.return_value = MagicMock(text="   ")

    result = transcribe_audio(client, b"fake-bytes")

    assert result == ""
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_stt.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stt'`

- [ ] **Step 3: Write the minimal implementation**

`backend/stt.py`:

```python
def transcribe_audio(client, audio_bytes: bytes, filename: str = "audio.webm") -> str:
    response = client.audio.transcriptions.create(
        file=(filename, audio_bytes),
        model="whisper-large-v3-turbo",
    )
    return (response.text or "").strip()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_stt.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/stt.py backend/tests/test_stt.py
git commit -m "feat(backend): add Groq Whisper transcription wrapper"
```

---

### Task 4: `llm.py` — Groq chat completion wrapper

**Files:**
- Create: `backend/llm.py`
- Test: `backend/tests/test_llm.py`

**Interfaces:**
- Consumes: any object shaped like a `groq.Groq` client (mocked in tests); `messages: list[dict]` shaped like `ConversationSession.get_messages()`'s output from Task 2.
- Produces: `generate_reply(client, messages: list[dict], model: str = DEFAULT_MODEL) -> str` — returns the assistant's reply text. Also exports `DEFAULT_MODEL: str`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_llm.py`:

```python
from unittest.mock import MagicMock

from llm import DEFAULT_MODEL, generate_reply


def test_generate_reply_returns_message_content():
    client = MagicMock()
    client.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content="Hi there!"))]
    )

    result = generate_reply(client, [{"role": "user", "content": "hello"}])

    assert result == "Hi there!"
    client.chat.completions.create.assert_called_once_with(
        model=DEFAULT_MODEL,
        messages=[{"role": "user", "content": "hello"}],
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_llm.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'llm'`

- [ ] **Step 3: Write the minimal implementation**

`backend/llm.py`:

```python
DEFAULT_MODEL = "llama-3.3-70b-versatile"


def generate_reply(client, messages: list[dict], model: str = DEFAULT_MODEL) -> str:
    response = client.chat.completions.create(model=model, messages=messages)
    return response.choices[0].message.content
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_llm.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/llm.py backend/tests/test_llm.py
git commit -m "feat(backend): add Groq chat completion wrapper"
```

---

### Task 5: `tts.py` — ElevenLabs speech synthesis wrapper

**Files:**
- Create: `backend/tts.py`
- Test: `backend/tests/test_tts.py`

**Interfaces:**
- Consumes: any object shaped like an `elevenlabs.client.ElevenLabs` client (mocked in tests).
- Produces: `synthesize_speech(client, text: str, voice_id: str) -> bytes` — returns the full MP3 audio bytes (joins the SDK's chunked generator output).

- [ ] **Step 1: Write the failing test**

`backend/tests/test_tts.py`:

```python
from unittest.mock import MagicMock

from tts import synthesize_speech


def test_synthesize_speech_joins_chunks():
    client = MagicMock()
    client.text_to_speech.convert.return_value = [b"abc", b"def"]

    result = synthesize_speech(client, "hello", "voice123")

    assert result == b"abcdef"
    client.text_to_speech.convert.assert_called_once_with(
        voice_id="voice123",
        text="hello",
        model_id="eleven_turbo_v2_5",
        output_format="mp3_44100_128",
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_tts.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tts'`

- [ ] **Step 3: Write the minimal implementation**

`backend/tts.py`:

```python
def synthesize_speech(client, text: str, voice_id: str) -> bytes:
    chunks = client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id="eleven_turbo_v2_5",
        output_format="mp3_44100_128",
    )
    return b"".join(chunks)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_tts.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tts.py backend/tests/test_tts.py
git commit -m "feat(backend): add ElevenLabs speech synthesis wrapper"
```

---

### Task 6: `main.py` — wire up the `/ws` endpoint (Stage A full-turn pipeline)

**Files:**
- Modify: `backend/main.py`
- Test: `backend/tests/test_main_ws.py`

**Interfaces:**
- Consumes: `ConversationSession` (Task 2), `transcribe_audio` (Task 3), `generate_reply` (Task 4), `synthesize_speech` (Task 5).
- Produces: `WebSocket /ws` route implementing the message protocol defined in Global Constraints. Env-driven config: `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `CORS_ORIGINS`.

Note: the Groq/ElevenLabs SDK clients raise if constructed with an empty API key. Tests never make a real network call (the pipeline functions are patched), so a placeholder string is used as a fallback when no real key is configured yet — this lets the test suite run before you've obtained real API keys.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_main_ws.py`:

```python
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app


def test_websocket_full_turn():
    with patch("main.transcribe_audio", return_value="hello there"), \
         patch("main.generate_reply", return_value="Hi! How can I help?"), \
         patch("main.synthesize_speech", return_value=b"FAKEAUDIOBYTES"):
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            ws.send_bytes(b"fake-audio-blob")

            assert ws.receive_json() == {"type": "user_transcript", "text": "hello there"}
            assert ws.receive_json() == {"type": "assistant_text", "text": "Hi! How can I help?"}
            assert ws.receive_bytes() == b"FAKEAUDIOBYTES"
            assert ws.receive_json() == {"type": "turn_complete"}


def test_websocket_no_speech_detected():
    with patch("main.transcribe_audio", return_value=""):
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            ws.send_bytes(b"silence")
            assert ws.receive_json() == {"type": "no_speech"}


def test_websocket_llm_error_sends_error_message():
    with patch("main.transcribe_audio", return_value="hello"), \
         patch("main.generate_reply", side_effect=Exception("boom")):
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            ws.send_bytes(b"fake-audio")
            assert ws.receive_json() == {"type": "user_transcript", "text": "hello"}
            error_msg = ws.receive_json()
            assert error_msg["type"] == "error"


def test_websocket_tts_error_degrades_to_text_only():
    with patch("main.transcribe_audio", return_value="hello"), \
         patch("main.generate_reply", return_value="hi"), \
         patch("main.synthesize_speech", side_effect=Exception("boom")):
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            ws.send_bytes(b"fake-audio")
            assert ws.receive_json() == {"type": "user_transcript", "text": "hello"}
            assert ws.receive_json() == {"type": "assistant_text", "text": "hi"}
            assert ws.receive_json() == {"type": "turn_complete"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_main_ws.py -v`
Expected: FAIL — no `/ws` route exists yet (404/connection rejected)

- [ ] **Step 3: Write the implementation**

Replace the contents of `backend/main.py` with:

```python
import os

from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq

from llm import generate_reply
from session import ConversationSession
from stt import transcribe_audio
from tts import synthesize_speech

load_dotenv()

app = FastAPI()

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SDK clients reject an empty api_key; fall back to a placeholder so the app
# (and its mocked tests) can run before real keys are configured.
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY") or "placeholder-key-for-local-dev")
elevenlabs_client = ElevenLabs(
    api_key=os.getenv("ELEVENLABS_API_KEY") or "placeholder-key-for-local-dev"
)
VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session = ConversationSession()
    try:
        while True:
            audio_bytes = await websocket.receive_bytes()

            transcript = transcribe_audio(groq_client, audio_bytes)
            if not transcript:
                await websocket.send_json({"type": "no_speech"})
                continue

            await websocket.send_json({"type": "user_transcript", "text": transcript})
            session.add_user_message(transcript)

            try:
                reply_text = generate_reply(groq_client, session.get_messages())
            except Exception:
                await websocket.send_json({
                    "type": "error",
                    "message": "The assistant had trouble responding. Please try again.",
                })
                continue

            session.add_assistant_message(reply_text)
            await websocket.send_json({"type": "assistant_text", "text": reply_text})

            try:
                audio = synthesize_speech(elevenlabs_client, reply_text, VOICE_ID)
                await websocket.send_bytes(audio)
            except Exception:
                pass  # degrade to text-only for this turn

            await websocket.send_json({"type": "turn_complete"})
    except WebSocketDisconnect:
        pass
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: PASS (all tests across all files, including Tasks 1–5's suites)

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_main_ws.py
git commit -m "feat(backend): wire up /ws endpoint for the full-turn voice pipeline"
```

---

### Task 7: Frontend scaffolding (Vite + React)

**Files:**
- Create: `frontend/` (via Vite scaffold command — creates `package.json`, `vite.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/App.css`, `src/index.css`, `public/`)

**Interfaces:**
- Produces: a runnable Vite React app at `frontend/`, buildable with `npm run build`.

- [ ] **Step 1: Scaffold the app**

```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install
```

- [ ] **Step 2: Verify the production build works**

Run (from `frontend/`): `npm run build`
Expected: builds successfully, creates `frontend/dist/`

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "chore(frontend): scaffold Vite + React app"
```

---

### Task 8: Frontend environment configuration

**Files:**
- Create: `frontend/.env.example`

**Interfaces:**
- Produces: `VITE_WS_URL` env var convention used by Task 13's `App.jsx`.

- [ ] **Step 1: Create `frontend/.env.example`**

```
VITE_WS_URL=ws://localhost:8000/ws
```

- [ ] **Step 2: Create your local `frontend/.env`** (gitignored, not committed)

```
VITE_WS_URL=ws://localhost:8000/ws
```

- [ ] **Step 3: Commit the example file**

```bash
git add frontend/.env.example
git commit -m "chore(frontend): document VITE_WS_URL env var"
```

---

### Task 9: `useAudioCapture` hook — mic capture + VAD

**Files:**
- Create: `frontend/src/hooks/useAudioCapture.js`

**Interfaces:**
- Produces: `useAudioCapture({ enabled: boolean, onUtteranceReady: (blob: Blob) => void, onLevel: (rms: number) => void }) -> { micState: "idle"|"listening"|"speech_detected", error: string|null }`. Calls `onUtteranceReady` with an `audio/webm` `Blob` once VAD detects an utterance has ended. Calls `onLevel` every animation frame with the current mic RMS amplitude (0–1) — used later by `VoiceIndicator` (Task 12) via a ref, not React state, to avoid re-render churn.

- [ ] **Step 1: Create the hook**

`frontend/src/hooks/useAudioCapture.js`:

```javascript
import { useCallback, useEffect, useRef, useState } from "react";

const SILENCE_THRESHOLD = 0.02;
const SILENCE_DURATION_MS = 700;
const MIN_SPEECH_MS = 300;

export function useAudioCapture({ enabled, onUtteranceReady, onLevel }) {
  const [micState, setMicState] = useState("idle");
  const [error, setError] = useState(null);

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const speechStartRef = useRef(null);
  const silenceStartRef = useRef(null);
  const rafRef = useRef(null);

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

          if (rms > SILENCE_THRESHOLD) {
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
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      setMicState("idle");
    };
  }, [enabled, onUtteranceReady, onLevel]);

  return { micState, error };
}
```

- [ ] **Step 2: Verify the build still compiles**

Run (from `frontend/`): `npm run build`
Expected: builds successfully with no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAudioCapture.js
git commit -m "feat(frontend): add useAudioCapture hook with energy-based VAD"
```

---

### Task 10: `useVoiceSocket` hook — WebSocket client

**Files:**
- Create: `frontend/src/hooks/useVoiceSocket.js`

**Interfaces:**
- Produces: `useVoiceSocket(wsUrl: string, handlers: { onUserTranscript, onAssistantText, onAudioChunk, onNoSpeech, onError, onTurnComplete }) -> { status: "connecting"|"open"|"closed", sendAudio: (blob: Blob) => void }`. Dispatches server messages per the Global Constraints protocol: JSON text frames by `type`, and `onAudioChunk(arrayBuffer)` for the binary frame.

- [ ] **Step 1: Create the hook**

`frontend/src/hooks/useVoiceSocket.js`:

```javascript
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

  return { status, sendAudio };
}
```

- [ ] **Step 2: Verify the build still compiles**

Run (from `frontend/`): `npm run build`
Expected: builds successfully with no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useVoiceSocket.js
git commit -m "feat(frontend): add useVoiceSocket hook with one-shot reconnect"
```

---

### Task 11: `useAudioPlayer` hook — TTS audio playback

**Files:**
- Create: `frontend/src/hooks/useAudioPlayer.js`

**Interfaces:**
- Produces: `useAudioPlayer() -> { playChunk: (arrayBuffer: ArrayBuffer) => void, stop: () => void, isPlaying: boolean }`.

- [ ] **Step 1: Create the hook**

`frontend/src/hooks/useAudioPlayer.js`:

```javascript
import { useCallback, useRef, useState } from "react";

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioElRef = useRef(null);
  const urlRef = useRef(null);

  const playChunk = useCallback((arrayBuffer) => {
    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const audio = new Audio(url);
    audioElRef.current = audio;
    setIsPlaying(true);
    audio.onended = () => {
      setIsPlaying(false);
      URL.revokeObjectURL(url);
    };
    audio.play();
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
```

- [ ] **Step 2: Verify the build still compiles**

Run (from `frontend/`): `npm run build`
Expected: builds successfully with no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAudioPlayer.js
git commit -m "feat(frontend): add useAudioPlayer hook"
```

---

### Task 12: UI components — `VoiceIndicator`, `CaptionPanel`, `HistoryPanel`

**Files:**
- Create: `frontend/src/components/VoiceIndicator.jsx`
- Create: `frontend/src/components/CaptionPanel.jsx`
- Create: `frontend/src/components/HistoryPanel.jsx`

**Interfaces:**
- Produces: `<VoiceIndicator state={"idle"|"listening"|"thinking"|"speaking"} levelRef={React.RefObject<number>} />` — canvas that reacts to `levelRef.current` while `state === "listening"`, and animates a canned pulse for `"thinking"`/`"speaking"`.
- Produces: `<CaptionPanel userText={string} assistantText={string} />`.
- Produces: `<HistoryPanel turns={Array<{id: number, userText: string, assistantText: string}>} />` — matches the turn shape built in Task 13's `App.jsx`.

- [ ] **Step 1: Create `VoiceIndicator.jsx`**

`frontend/src/components/VoiceIndicator.jsx`:

```jsx
import { useEffect, useRef } from "react";

const COLORS = {
  idle: "#9ca3af",
  listening: "#38bdf8",
  thinking: "#a78bfa",
  speaking: "#34d399",
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
```

- [ ] **Step 2: Create `CaptionPanel.jsx`**

`frontend/src/components/CaptionPanel.jsx`:

```jsx
export function CaptionPanel({ userText, assistantText }) {
  return (
    <div className="caption-panel">
      {userText && <p className="caption-user">You: {userText}</p>}
      {assistantText && <p className="caption-assistant">Agent: {assistantText}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Create `HistoryPanel.jsx`**

`frontend/src/components/HistoryPanel.jsx`:

```jsx
export function HistoryPanel({ turns }) {
  return (
    <div className="history-panel">
      {turns.map((turn) => (
        <div key={turn.id} className="history-turn">
          <p className="history-user">You: {turn.userText}</p>
          <p className="history-assistant">Agent: {turn.assistantText}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify the build still compiles**

Run (from `frontend/`): `npm run build`
Expected: builds successfully with no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/
git commit -m "feat(frontend): add VoiceIndicator, CaptionPanel, HistoryPanel components"
```

---

### Task 13: `App.jsx` — wire everything together (Stage A integration)

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `useAudioCapture` (Task 9), `useVoiceSocket` (Task 10), `useAudioPlayer` (Task 11), `VoiceIndicator`/`CaptionPanel`/`HistoryPanel` (Task 12).
- Produces: the top-level `App` component; drives the `uiState` machine (`idle → listening → thinking → speaking → listening`) described in the spec's data-flow section.

- [ ] **Step 1: Replace `frontend/src/App.jsx`**

```jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useVoiceSocket } from "./hooks/useVoiceSocket";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { VoiceIndicator } from "./components/VoiceIndicator";
import { CaptionPanel } from "./components/CaptionPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws";

let turnIdCounter = 0;

export default function App() {
  const [uiState, setUiState] = useState("idle");
  const [userText, setUserText] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [history, setHistory] = useState([]);
  const [banner, setBanner] = useState(null);
  const levelRef = useRef(0);
  const pendingTurnRef = useRef(null);

  const { playChunk } = useAudioPlayer();

  const handleUserTranscript = useCallback((text) => {
    setUserText(text);
    setAssistantText("");
    pendingTurnRef.current = { id: turnIdCounter++, userText: text, assistantText: "" };
    setUiState("thinking");
  }, []);

  const handleAssistantText = useCallback((text) => {
    setAssistantText(text);
    if (pendingTurnRef.current) pendingTurnRef.current.assistantText = text;
  }, []);

  const handleAudioChunk = useCallback(
    (arrayBuffer) => {
      setUiState("speaking");
      playChunk(arrayBuffer);
    },
    [playChunk]
  );

  const handleNoSpeech = useCallback(() => {
    setUiState("listening");
  }, []);

  const handleTurnComplete = useCallback(() => {
    if (pendingTurnRef.current) {
      setHistory((prev) => [...prev, pendingTurnRef.current]);
      pendingTurnRef.current = null;
    }
    setUiState("listening");
  }, []);

  const handleError = useCallback((message) => {
    setBanner(message);
    setUiState("listening");
    setTimeout(() => setBanner(null), 4000);
  }, []);

  const { status, sendAudio } = useVoiceSocket(WS_URL, {
    onUserTranscript: handleUserTranscript,
    onAssistantText: handleAssistantText,
    onAudioChunk: handleAudioChunk,
    onNoSpeech: handleNoSpeech,
    onTurnComplete: handleTurnComplete,
    onError: handleError,
  });

  useEffect(() => {
    if (status === "open" && uiState === "idle") {
      setUiState("listening");
    }
  }, [status, uiState]);

  const handleUtteranceReady = useCallback(
    (blob) => {
      sendAudio(blob);
    },
    [sendAudio]
  );

  const { error: micError } = useAudioCapture({
    enabled: status === "open",
    onUtteranceReady: handleUtteranceReady,
    onLevel: (rms) => {
      levelRef.current = rms;
    },
  });

  return (
    <div className="app">
      <h1>Voice Agent</h1>
      {status !== "open" && <p className="status-banner">Connection: {status}</p>}
      {micError && <p className="status-banner error">Microphone error: {micError}</p>}
      {banner && <p className="status-banner error">{banner}</p>}
      <VoiceIndicator state={uiState} levelRef={levelRef} />
      <CaptionPanel userText={userText} assistantText={assistantText} />
      <HistoryPanel turns={history} />
    </div>
  );
}
```

- [ ] **Step 2: Replace `frontend/src/App.css`**

```css
.app {
  max-width: 640px;
  margin: 0 auto;
  padding: 2rem 1rem;
  text-align: center;
  font-family: system-ui, sans-serif;
}

.voice-indicator {
  display: block;
  margin: 1.5rem auto;
}

.status-banner {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  background: #f3f4f6;
  color: #374151;
  display: inline-block;
  margin-bottom: 0.5rem;
}

.status-banner.error {
  background: #fee2e2;
  color: #991b1b;
}

.caption-panel {
  min-height: 3rem;
  margin-bottom: 1.5rem;
}

.caption-user {
  color: #374151;
}

.caption-assistant {
  color: #047857;
  font-weight: 600;
}

.history-panel {
  text-align: left;
  border-top: 1px solid #e5e7eb;
  padding-top: 1rem;
  max-height: 300px;
  overflow-y: auto;
}

.history-turn {
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
  color: #6b7280;
}
```

- [ ] **Step 3: Verify the build compiles**

Run (from `frontend/`): `npm run build`
Expected: builds successfully with no errors

- [ ] **Step 4: Start the dev server and visually verify**

Start the frontend dev server (use the project's dev-server preview tooling) and open it in the browser preview. With no backend running yet, confirm: the page renders "Voice Agent", a status banner shows `Connection: connecting` (backend isn't up), the voice indicator circle renders, and there are no red errors in the browser console.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/App.css
git commit -m "feat(frontend): wire hooks and components together in App"
```

---

### Task 14: Local end-to-end verification (requires you — real mic + real API keys)

This task can't be fully completed by an automated coding agent: it needs a physical microphone and your own Groq/ElevenLabs API keys. The agent should prepare everything up to this point and then hand off to you for this step.

**Files:** none (verification only)

- [ ] **Step 1: Get a Groq API key**

Sign up / log in at https://console.groq.com, create an API key, and put it in `backend/.env` as `GROQ_API_KEY=...` (copy `backend/.env.example` to `backend/.env` first if you haven't).

- [ ] **Step 2: Get an ElevenLabs API key and voice ID**

Sign up / log in at https://elevenlabs.io, create an API key (Profile → API Keys) and add it to `backend/.env` as `ELEVENLABS_API_KEY=...`. Optionally pick a voice from their Voice Library and set its ID as `ELEVENLABS_VOICE_ID=...` (otherwise the default pre-made voice is used).

- [ ] **Step 2b: Note on SDK drift**

The `stt.py`/`llm.py`/`tts.py` wrappers were written against the Groq and ElevenLabs Python SDK method signatures current as of this plan. If this step raises an `AttributeError` calling a real API, check the installed package version's docs (`pip show groq`, `pip show elevenlabs`) — SDKs occasionally rename methods across major versions — and adjust the wrapper accordingly; the tests from Tasks 3–6 will still pass since they mock the client.

- [ ] **Step 3: Start the backend**

```bash
cd backend
source venv/Scripts/activate   # if not already active
uvicorn main:app --reload --port 8000
```

- [ ] **Step 4: Start the frontend dev server**

Start the frontend dev server pointing at `VITE_WS_URL=ws://localhost:8000/ws` (already the default in `frontend/.env` from Task 8).

- [ ] **Step 5: Test in a real browser with a real microphone**

Open the app in your own Chrome/Edge (not a sandboxed preview without mic access), grant microphone permission, and speak a short phrase. Confirm:
- the indicator circle reacts to your voice while you talk
- after you pause, the state shows "thinking" and then the caption/reply audio plays
- the turn appears in the history panel
- the state returns to "listening" afterward and you can speak again

- [ ] **Step 6: Test the error paths**

Deny microphone permission on a fresh page load and confirm the inline error message appears. Then stop the backend process while the frontend is connected and confirm the UI shows a "connecting" state briefly, then a disconnected state after the one reconnect attempt fails.

---

### Task 15: Deploy backend to Railway

**Files:**
- Create: `backend/Procfile`

This task requires your Railway and GitHub accounts — the agent prepares the config file and gives you exact values, but creating the Railway project and clicking through its dashboard needs to be done by you.

- [ ] **Step 1: Create `backend/Procfile`**

```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

- [ ] **Step 2: Commit**

```bash
git add backend/Procfile
git commit -m "chore(backend): add Railway Procfile"
```

- [ ] **Step 3: Push the repo to GitHub**

If you haven't already, create a GitHub repository and push:

```bash
git remote add origin <your-github-repo-url>
git push -u origin master
```

- [ ] **Step 4: Create the Railway service (you do this in the Railway dashboard)**

At https://railway.app: New Project → Deploy from GitHub repo → select this repo → in the service settings, set the **Root Directory** to `backend`. Add these environment variables in the Railway dashboard: `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (optional), and `CORS_ORIGINS` (set temporarily to `*`, you'll narrow it in Task 16 once the Vercel URL is known). Deploy.

- [ ] **Step 5: Verify**

Once deployed, visit `https://<your-railway-app>.up.railway.app/health` and confirm it returns `{"status":"ok"}`.

---

### Task 16: Deploy frontend to Vercel

This task requires your Vercel account — the agent gives you the exact configuration, but creating the Vercel project needs to be done by you in the dashboard.

- [ ] **Step 1: Create the Vercel project (you do this in the Vercel dashboard)**

At https://vercel.com: New Project → import the same GitHub repo → set **Root Directory** to `frontend` (framework preset should auto-detect as Vite). Add environment variable `VITE_WS_URL` = `wss://<your-railway-app>.up.railway.app/ws` (note `wss://`, not `ws://`, since it's HTTPS in production). Deploy.

- [ ] **Step 2: Lock down CORS**

Back in Railway, update `CORS_ORIGINS` to your actual Vercel URL (e.g. `https://voice-agent.vercel.app`), replacing the temporary `*`, and redeploy the backend service.

- [ ] **Step 3: Verify end to end**

Visit your Vercel URL in a real browser with a microphone. Confirm the connection status becomes "open", and run through the same conversation + error-path checks from Task 14, now against the deployed backend.

---

## Follow-up plans (not part of this plan)

- **Stage B:** sentence-chunked streaming — add `sentence_chunker.py`, switch `llm.py` to a streaming variant, update `/ws` to emit `assistant_text_delta` + multiple `audio_chunk` messages per turn, update the frontend to queue/play multiple ordered chunks.
- **Stage C:** barge-in — detect speech during `"speaking"` state client-side, send a `barge_in` message, cancel in-flight backend work for the interrupted turn.
