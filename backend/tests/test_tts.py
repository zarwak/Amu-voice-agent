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
