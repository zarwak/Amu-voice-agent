import base64
import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from index import app

client = TestClient(app)


def post_turn(history="[]", filename="audio.webm"):
    return client.post(
        "/api/converse",
        files={"audio": (filename, b"fake-audio-bytes", "audio/webm")},
        data={"history": history},
    )


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_full_turn_returns_transcript_reply_and_audio():
    with patch("index.transcribe_audio", return_value="hello there"), \
         patch("index.generate_reply", return_value="Hi!"), \
         patch("index.synthesize_speech", return_value=b"AUDIOBYTES"):
        body = post_turn().json()

    assert body["transcript"] == "hello there"
    assert body["reply"] == "Hi!"
    assert base64.b64decode(body["audio"]) == b"AUDIOBYTES"


def test_history_is_forwarded_to_the_model():
    captured = {}

    def fake_generate_reply(_client, messages):
        captured["messages"] = messages
        return "ok"

    history = json.dumps([{"userText": "remember 42", "assistantText": "got it"}])
    with patch("index.transcribe_audio", return_value="what number"), \
         patch("index.generate_reply", side_effect=fake_generate_reply), \
         patch("index.synthesize_speech", return_value=b"A"):
        post_turn(history=history)

    roles = [m["role"] for m in captured["messages"]]
    assert roles == ["system", "user", "assistant", "user"]
    assert captured["messages"][1]["content"] == "remember 42"
    assert captured["messages"][-1]["content"] == "what number"


def test_no_speech_is_reported_without_calling_the_model():
    with patch("index.transcribe_audio", return_value=""), \
         patch("index.generate_reply") as llm:
        body = post_turn().json()

    assert body == {"noSpeech": True}
    llm.assert_not_called()


def test_stt_failure_returns_error():
    with patch("index.transcribe_audio", side_effect=Exception("boom")):
        body = post_turn().json()
    assert "error" in body


def test_llm_failure_returns_error_but_keeps_transcript():
    with patch("index.transcribe_audio", return_value="hello"), \
         patch("index.generate_reply", side_effect=Exception("boom")):
        body = post_turn().json()
    assert body["transcript"] == "hello"
    assert "error" in body


def test_tts_failure_degrades_to_text_only():
    with patch("index.transcribe_audio", return_value="hello"), \
         patch("index.generate_reply", return_value="hi"), \
         patch("index.synthesize_speech", side_effect=Exception("boom")):
        body = post_turn().json()

    assert body["reply"] == "hi"
    assert body["audio"] is None
    assert "error" not in body


def test_malformed_history_does_not_break_the_turn():
    with patch("index.transcribe_audio", return_value="hello"), \
         patch("index.generate_reply", return_value="hi"), \
         patch("index.synthesize_speech", return_value=b"A"):
        body = post_turn(history="not-json-at-all").json()

    assert body["reply"] == "hi"
