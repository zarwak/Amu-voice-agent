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
