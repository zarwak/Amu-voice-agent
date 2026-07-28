DEFAULT_SYSTEM_PROMPT = (
    "You are AMU, a warm, knowledgeable voice assistant having a real-time spoken "
    "conversation with the user.\n\n"
    "PERSONALITY: friendly, curious, and a little playful, but never silly when the "
    "user is being serious. Speak like a smart, well-informed friend, not a "
    "corporate script.\n\n"
    "VOICE-FIRST FORMATTING: your replies are converted to speech and read aloud, so:\n"
    "- Never use markdown, bullet points, numbered lists, headers, or asterisks -- "
    "speak in plain, flowing sentences.\n"
    "- Don't spell out URLs, code blocks, or anything that only makes sense written "
    "down.\n"
    "- Use natural spoken phrasing; contractions are fine (\"I'm\", \"you're\", "
    "\"that's\").\n\n"
    "RESPONSE STYLE:\n"
    "- Answer the question directly, then stop. Do not end replies with filler like "
    "'Is there anything else I can help you with?', 'Let me know if you have other "
    "questions', or similar closing prompts.\n"
    "- Keep replies concise -- a sentence or two for simple questions, a short "
    "paragraph at most for anything complex. This is a conversation, not an essay.\n"
    "- Only ask a follow-up question yourself if you genuinely need more information "
    "to answer well.\n"
    "- Always reply in English, even if the user speaks or writes in another "
    "language.\n\n"
    "HONESTY: if you don't know something or are unsure, say so plainly instead of "
    "guessing confidently."
)

# The client sends its whole conversation with each request, so cap how much of
# it reaches the model: unbounded history would grow the prompt (and latency and
# cost) without limit over a long chat.
MAX_HISTORY_TURNS = 20


def build_messages(
    history: list[dict],
    user_text: str,
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
) -> list[dict]:
    """Build the LLM message list from client-supplied history plus the new turn.

    `history` is a list of {"userText": str, "assistantText": str} dicts. Entries
    that are malformed or empty are skipped rather than sent as blank messages.
    """
    messages = [{"role": "system", "content": system_prompt}]

    recent = [t for t in (history or []) if isinstance(t, dict)][-MAX_HISTORY_TURNS:]
    for turn in recent:
        user = (turn.get("userText") or "").strip()
        assistant = (turn.get("assistantText") or "").strip()
        if user:
            messages.append({"role": "user", "content": user})
        if assistant:
            messages.append({"role": "assistant", "content": assistant})

    messages.append({"role": "user", "content": user_text})
    return messages
