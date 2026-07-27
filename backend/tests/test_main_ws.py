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


def test_websocket_stt_error_sends_error_message():
    with patch("main.transcribe_audio", side_effect=Exception("boom")):
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            ws.send_bytes(b"fake-audio")
            error_msg = ws.receive_json()
            assert error_msg["type"] == "error"


def test_websocket_survives_stt_error_and_accepts_next_message():
    with patch("main.transcribe_audio", side_effect=[Exception("boom"), "hello again"]), \
         patch("main.generate_reply", return_value="hi again"), \
         patch("main.synthesize_speech", return_value=b"AUDIO"):
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            ws.send_bytes(b"first-audio")
            error_msg = ws.receive_json()
            assert error_msg["type"] == "error"

            ws.send_bytes(b"second-audio")
            assert ws.receive_json() == {"type": "user_transcript", "text": "hello again"}
            assert ws.receive_json() == {"type": "assistant_text", "text": "hi again"}
            assert ws.receive_bytes() == b"AUDIO"
            assert ws.receive_json() == {"type": "turn_complete"}


def test_websocket_rehydrate_restores_history_for_llm_context():
    captured_messages = []

    def fake_generate_reply(client, messages):
        captured_messages.append(messages)
        return "ok"

    with patch("main.transcribe_audio", return_value="new question"), \
         patch("main.generate_reply", side_effect=fake_generate_reply), \
         patch("main.synthesize_speech", return_value=b"AUDIO"):
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            ws.send_json({
                "type": "rehydrate",
                "turns": [{"userText": "hi", "assistantText": "hello there"}],
            })
            ws.send_bytes(b"fake-audio")
            assert ws.receive_json() == {"type": "user_transcript", "text": "new question"}
            assert ws.receive_json() == {"type": "assistant_text", "text": "ok"}
            ws.receive_bytes()
            assert ws.receive_json() == {"type": "turn_complete"}

    assert len(captured_messages) == 1
    roles = [m["role"] for m in captured_messages[0]]
    assert roles == ["system", "user", "assistant", "user"]
    assert captured_messages[0][1] == {"role": "user", "content": "hi"}
    assert captured_messages[0][2] == {"role": "assistant", "content": "hello there"}
    assert captured_messages[0][3] == {"role": "user", "content": "new question"}


def test_websocket_new_session_clears_history():
    captured_messages = []

    def fake_generate_reply(client, messages):
        captured_messages.append(messages)
        return "ok"

    with patch("main.transcribe_audio", return_value="new question"), \
         patch("main.generate_reply", side_effect=fake_generate_reply), \
         patch("main.synthesize_speech", return_value=b"AUDIO"):
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            ws.send_json({
                "type": "rehydrate",
                "turns": [{"userText": "hi", "assistantText": "hello there"}],
            })
            ws.send_json({"type": "new_session"})
            ws.send_bytes(b"fake-audio")
            ws.receive_json()
            ws.receive_json()
            ws.receive_bytes()
            ws.receive_json()

    assert len(captured_messages) == 1
    roles = [m["role"] for m in captured_messages[0]]
    assert roles == ["system", "user"]
