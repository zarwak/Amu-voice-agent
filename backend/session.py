DEFAULT_SYSTEM_PROMPT = (
    "You are AMU, a helpful, friendly voice assistant. Always reply in English, "
    "even if the user speaks or writes in another language. Keep replies concise "
    "and conversational, since they will be read aloud. Answer the question and "
    "stop -- do not end your replies with filler like 'Is there anything else I "
    "can help you with?', 'Let me know if you have other questions', or similar "
    "closing prompts. Only ask a follow-up question if you genuinely need more "
    "information to answer."
)


class ConversationSession:
    def __init__(self, system_prompt: str = DEFAULT_SYSTEM_PROMPT):
        self._messages = [{"role": "system", "content": system_prompt}]

    def add_user_message(self, text: str) -> None:
        self._messages.append({"role": "user", "content": text})

    def add_assistant_message(self, text: str) -> None:
        self._messages.append({"role": "assistant", "content": text})

    def get_messages(self) -> list[dict]:
        return list(self._messages)
