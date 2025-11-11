import os
from typing import List, Optional
import requests
from dotenv import load_dotenv


DISCORD_API_BASE = "https://discord.com/api/v10"


load_dotenv()  # Load variables from .env if present (local dev)


def get_env(
    name: str, default: Optional[str] = None, required: bool = False
) -> Optional[str]:
    val = os.getenv(name, default)
    if required and not val:
        raise RuntimeError(f"Missing required env var: {name}")
    return val


def weekday_options_from_env(override: Optional[List[str]] = None) -> List[str]:
    if override:
        return override
    # Prefer WEEKDAY_OPTIONS if provided, fall back to legacy WEEKDAY_EMOJI_NAMES, else sensible JP defaults
    raw = ("月,火,水,木,金")
    return [x.strip() for x in raw.split(",") if x.strip()]


def build_auth_headers(token: str) -> dict:
    return {
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json",
        "User-Agent": "WeeklySchedulerBot (https://example.com, 1.0)",
    }


def send_poll_message(
    channel_id: str,
    message: str,
    options: List[str],
    token: str,
    allow_multiselect: bool = True,
    duration_hours: int = 168,
):
    headers = build_auth_headers(token)
    # Build Discord poll payload
    answers = [
        {"answer_id": i + 1, "poll_media": {"text": opt}}
        for i, opt in enumerate(options)
    ]
    poll = {
        "question": {"text": message},
        "answers": answers,
        "allow_multiselect": allow_multiselect,
        "duration": duration_hours,
        "layout_type": 1,
    }

    post_url = f"{DISCORD_API_BASE}/channels/{channel_id}/messages"
    payload = {"content": message, "poll": poll}
    print(payload)
    resp = requests.post(post_url, headers=headers, json=payload, timeout=15)
    resp.raise_for_status()
