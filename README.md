# AMU — Real-Time Voice AI Agent

Talk to it, it talks back. Browser captures your voice, the backend transcribes it
(Groq Whisper), generates a reply (Groq Llama), speaks it (ElevenLabs), and streams
the audio back — with live captions, a reactive waveform, and saved chat history.

## Stack

| Layer | Tech |
|-------|------|
| ASR | Groq (`whisper-large-v3-turbo`) |
| LLM | Groq (`llama-3.3-70b-versatile`) |
| TTS | ElevenLabs (`eleven_turbo_v2_5`) |
| Backend | Python, FastAPI, WebSocket |
| Frontend | React + Vite |

## Features

- Automatic turn-taking — voice activity detection, no push-to-talk
- Live transcript of both sides of the conversation
- Chat history in a sidebar: rename, delete, switch between past chats
- Conversations persist across reloads, and the assistant's memory is restored with them
- Spacebar to pause/resume listening
- Settings: accent colour, microphone sensitivity

## Running locally

You need a [Groq API key](https://console.groq.com) and an
[ElevenLabs API key](https://elevenlabs.io) (both have free tiers).

**Backend**

```bash
cd backend
python -m venv venv
source venv/Scripts/activate   # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env           # then fill in your keys
uvicorn main:app --reload --port 8000
```

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173 and allow microphone access.

> Note: ElevenLabs' free tier blocks API access to some "library" voices. The default
> voice (`pNInz6obpgDQGcFmaJgB`) is one that works on the free tier. If you get a
> `402 paid_plan_required`, pick a different voice ID for `ELEVENLABS_VOICE_ID`.

**Tests**

```bash
cd backend && python -m pytest tests/ -v
```

## Deployment

The frontend is a static build (Vercel). The backend holds a long-lived WebSocket
per conversation, so it needs a host that supports persistent connections —
Railway, Render, or Fly.io. Classic serverless platforms are not suitable.

### 1. Backend → Railway

1. New Project → Deploy from GitHub repo → select this repo.
2. In service Settings, set **Root Directory** to `backend`.
3. Add environment variables:
   | Variable | Value |
   |----------|-------|
   | `GROQ_API_KEY` | your Groq key |
   | `ELEVENLABS_API_KEY` | your ElevenLabs key |
   | `ELEVENLABS_VOICE_ID` | `pNInz6obpgDQGcFmaJgB` (optional) |
   | `CORS_ORIGINS` | `*` for now — tighten in step 3 |
4. Deploy, then confirm `https://<your-app>.up.railway.app/health` returns
   `{"status":"ok"}`.

### 2. Frontend → Vercel

1. New Project → import the same repo.
2. Set **Root Directory** to `frontend` (framework auto-detects as Vite).
3. Add environment variable:
   | Variable | Value |
   |----------|-------|
   | `VITE_WS_URL` | `wss://<your-app>.up.railway.app/ws` |

   Note `wss://` (not `ws://`) — production is HTTPS, and browsers block insecure
   WebSockets from a secure page.
4. Deploy.

### 3. Lock down CORS

Back in Railway, set `CORS_ORIGINS` to your actual Vercel URL
(e.g. `https://amu.vercel.app`) and redeploy.

Microphone access requires HTTPS, which both Vercel and Railway provide by default.

## Notes

- Conversation history is stored in the browser's `localStorage`, so it's per-device
  and not shared between browsers.
- The assistant's server-side memory lives for the life of the WebSocket connection;
  the frontend replays the active chat on reconnect so its memory matches the screen.
