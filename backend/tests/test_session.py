from session import ConversationSession, DEFAULT_SYSTEM_PROMPT


def test_starts_with_system_prompt():
    session = ConversationSession()
    assert session.get_messages() == [{"role": "system", "content": DEFAULT_SYSTEM_PROMPT}]


def test_add_user_and_assistant_messages():
    session = ConversationSession()
    session.add_user_message("hi")
    session.add_assistant_message("hello!")
    messages = session.get_messages()
    assert messages[1] == {"role": "user", "content": "hi"}
    assert messages[2] == {"role": "assistant", "content": "hello!"}


def test_get_messages_returns_a_copy():
    session = ConversationSession()
    messages = session.get_messages()
    messages.append({"role": "user", "content": "leaked"})
    assert len(session.get_messages()) == 1
