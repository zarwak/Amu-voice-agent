def transcribe_audio(client, audio_bytes: bytes, filename: str = "audio.webm") -> str:
    response = client.audio.transcriptions.create(
        file=(filename, audio_bytes),
        model="whisper-large-v3-turbo",
    )
    return (response.text or "").strip()
