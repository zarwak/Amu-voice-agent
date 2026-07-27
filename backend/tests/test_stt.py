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
