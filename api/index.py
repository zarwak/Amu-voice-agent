import base64
import json
import os
import sys

# This file's own directory isn't guaranteed to be on sys.path -- locally we run
# uvicorn with --app-dir api, but a serverless runtime imports the handler
# differently. Without this, the sibling `_*` imports below fail at import time
# and the whole function dies with an invocation error.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq

from _llm import generate_reply
from _session import build_messages
from _stt import transcribe_audio
from _tts import synthesize_speech

load_dotenv()

app = FastAPI()

# Comma-separated; tolerate spaces since this is typed into a hosting dashboard.
cors_origins = [
    o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()
]
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
VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/converse")
async def converse(audio: UploadFile = File(...), history: str = Form("[]")):
    """One conversation turn: audio in, transcript + reply + spoken audio out.

    Stateless by design so it can run as a serverless function -- the client
    owns the conversation and replays it via `history` on every request.
    """
    audio_bytes = await audio.read()

    try:
        parsed_history = json.loads(history)
        if not isinstance(parsed_history, list):
            parsed_history = []
    except (json.JSONDecodeError, TypeError):
        parsed_history = []

    try:
        transcript = transcribe_audio(groq_client, audio_bytes)
    except Exception:
        return {"error": "The assistant had trouble hearing that. Please try again."}

    if not transcript:
        return {"noSpeech": True}

    try:
        messages = build_messages(parsed_history, transcript)
        reply = generate_reply(groq_client, messages)
    except Exception:
        return {
            "transcript": transcript,
            "error": "The assistant had trouble responding. Please try again.",
        }

    # TTS failing shouldn't lose the reply -- fall back to text-only for this turn.
    audio_b64 = None
    try:
        audio_b64 = base64.b64encode(
            synthesize_speech(elevenlabs_client, reply, VOICE_ID)
        ).decode("ascii")
    except Exception:
        pass

    return {"transcript": transcript, "reply": reply, "audio": audio_b64}
