# AMU — Real-Time Voice AI Agent

Talk to it, it talks back. The browser captures your voice, the API transcribes it
(Groq Whisper), generates a reply (Groq Llama), speaks it (ElevenLabs), and sends the
audio back — with a live transcript, a reactive waveform, and saved chat history.

Deploys to **Vercel** as a single project: static React frontend + a Python
serverless function.

## Stack

| Layer | Tech |
|-------|------|
| ASR | Groq (`whisper-large-v3-turbo`) |
| LLM | Groq (`llama-3.3-70b-versatile`) |
| TTS | ElevenLabs (`eleven_turbo_v2_5`) |
| API | Python, FastAPI (serverless function) |
| Frontend | React + Vite |

## Features

- Automatic turn-taking — voice activity detection, no push-to-talk
- Live transcript of both sides of the conversation
- Chat history sidebar: rename, delete, switch between past chats
- Conversations persist across reloads
- Spacebar to pause/resume listening
- Settings: accent colour, microphone sensitivity

## Layout

```
api/              Python serverless function
  index.py        FastAPI app: /api/health, /api/converse
  _*.py           shared modules (underscore = not a route)
frontend/         React + Vite app
tests/            pytest suite
requirements.txt  runtime deps (what Vercel installs)
vercel.json       build + routing config
```

## Architecture

The API is **stateless** — required for serverless, since each request may hit a
fresh instance with no memory of the last one. The browser owns the conversation
and sends the relevant history with every request; the server rebuilds the model's
context from it per call. History is capped (`MAX_HISTORY_TURNS`) so a long chat
can't grow the prompt without bound.

One turn = one `POST /api/converse` carrying the audio blob and the history,
returning the transcript, the reply text, and the spoken audio.

> **Trade-off:** this rules out streaming audio sentence-by-sentence and barge-in
> (interrupting mid-reply), both of which need a persistent WebSocket connection and
> therefore an always-on server (Railway/Render/Fly). If you want those later, the
> API has to move off serverless.

## Running locally

You need a [Groq API key](https://console.groq.com) and an
[ElevenLabs API key](https://elevenlabs.io) — both have free tiers.

**API**

```bash
python -m venv venv
source venv/Scripts/activate      # macOS/Linux: source venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env              # then fill in your keys
uvicorn index:app --app-dir api --reload --port 8000
```

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173 and allow microphone access.

> ElevenLabs' free tier blocks API access to some "library" voices. The default
> (`pNInz6obpgDQGcFmaJgB`) works on the free tier. A `402 paid_plan_required` means
> you need a different `ELEVENLABS_VOICE_ID`.

**Tests**

```bash
python -m pytest tests/ -v
```

## Deploying to Vercel

1. Push the repo to GitHub.
2. Vercel → **New Project** → import the repo. Leave the root directory as the repo
   root — `vercel.json` handles building the frontend and routing `/api/*` to the
   Python function.
3. Add environment variables (Project Settings → Environment Variables):

   | Variable | Value |
   |----------|-------|
   | `GROQ_API_KEY` | your Groq key |
   | `ELEVENLABS_API_KEY` | your ElevenLabs key |
   | `ELEVENLABS_VOICE_ID` | `pNInz6obpgDQGcFmaJgB` (optional) |

   `VITE_API_URL` is **not** needed in production — the frontend calls `/api/...` on
   its own origin. `CORS_ORIGINS` isn't needed either, for the same reason.
4. Deploy, then check `https://<your-app>.vercel.app/api/health` returns
   `{"status":"ok"}`.

Microphone access requires HTTPS, which Vercel provides by default.

### Things to watch

- **Turn latency is ~4–6s** (STT + LLM + TTS in one request). `vercel.json` sets
  `maxDuration: 60` so a slow turn isn't cut off by the default timeout.
- **Cold starts** add a second or two to the first turn after a period of idleness.
- Conversation history lives in the browser's `localStorage`, so it's per-device and
  not shared between browsers.
