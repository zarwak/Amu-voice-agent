from unittest.mock import MagicMock

from _llm import DEFAULT_MODEL, generate_reply


def test_generate_reply_returns_message_content():
    client = MagicMock()
    client.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content="Hi there!"))]
    )

    result = generate_reply(client, [{"role": "user", "content": "hello"}])

    assert result == "Hi there!"
    client.chat.completions.create.assert_called_once_with(
        model=DEFAULT_MODEL,
        messages=[{"role": "user", "content": "hello"}],
    )
