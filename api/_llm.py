DEFAULT_MODEL = "llama-3.3-70b-versatile"


def generate_reply(client, messages: list[dict], model: str = DEFAULT_MODEL) -> str:
    response = client.chat.completions.create(model=model, messages=messages)
    return response.choices[0].message.content
