from _session import DEFAULT_SYSTEM_PROMPT, MAX_HISTORY_TURNS, build_messages


def test_starts_with_system_prompt_and_new_message():
    messages = build_messages([], "hello")
    assert messages == [
        {"role": "system", "content": DEFAULT_SYSTEM_PROMPT},
        {"role": "user", "content": "hello"},
    ]


def test_history_is_replayed_in_order():
    history = [
        {"userText": "hi", "assistantText": "hello there"},
        {"userText": "who are you", "assistantText": "AMU"},
    ]
    messages = build_messages(history, "what next")
    assert [m["role"] for m in messages] == [
        "system", "user", "assistant", "user", "assistant", "user"
    ]
    assert messages[1] == {"role": "user", "content": "hi"}
    assert messages[2] == {"role": "assistant", "content": "hello there"}
    assert messages[-1] == {"role": "user", "content": "what next"}


def test_skips_blank_and_malformed_history_entries():
    history = [
        {"userText": "kept", "assistantText": ""},
        {"userText": "", "assistantText": ""},
        "not-a-dict",
        {"assistantText": "orphan reply"},
    ]
    messages = build_messages(history, "now")
    contents = [m["content"] for m in messages]
    assert "kept" in contents
    assert "orphan reply" in contents
    assert "" not in contents


def test_history_is_capped():
    history = [{"userText": f"q{i}", "assistantText": f"a{i}"} for i in range(50)]
    messages = build_messages(history, "final")
    # system + (capped turns * 2) + the new user message
    assert len(messages) == 1 + MAX_HISTORY_TURNS * 2 + 1
    assert messages[1] == {"role": "user", "content": "q30"}


def test_handles_none_history():
    messages = build_messages(None, "hello")
    assert messages[-1] == {"role": "user", "content": "hello"}
