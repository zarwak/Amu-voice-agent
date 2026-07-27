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
