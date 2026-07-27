def synthesize_speech(client, text: str, voice_id: str) -> bytes:
    chunks = client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id="eleven_turbo_v2_5",
        output_format="mp3_44100_128",
    )
    return b"".join(chunks)
