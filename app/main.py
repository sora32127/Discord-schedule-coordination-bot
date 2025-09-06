import os
import asyncio
from typing import List, Optional

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv


DISCORD_API_BASE = "https://discord.com/api/v10"


class ScheduleRequest(BaseModel):
    # Backward-compat: `emojis` can still be used as option labels
    emojis: Optional[List[str]] = None
    # Preferred override list for poll options
    options: Optional[List[str]] = None
    # Optional message/question text
    message: Optional[str] = None
    # Optional poll duration in hours (default via env)
    duration_hours: Optional[int] = None


load_dotenv()  # Load variables from .env if present (local dev)

app = FastAPI(title="Discord Weekly Scheduler Bot")


def get_env(name: str, default: Optional[str] = None, required: bool = False) -> Optional[str]:
    val = os.getenv(name, default)
    if required and not val:
        raise RuntimeError(f"Missing required env var: {name}")
    return val


def weekday_options_from_env(override: Optional[List[str]] = None) -> List[str]:
    if override:
        return override
    # Prefer WEEKDAY_OPTIONS if provided, fall back to legacy WEEKDAY_EMOJI_NAMES, else sensible JP defaults
    raw = (
        os.getenv("WEEKDAY_OPTIONS")
        or os.getenv("WEEKDAY_EMOJI_NAMES")
        or "月,火,水,木,金"
    )
    return [x.strip() for x in raw.split(",") if x.strip()]


def build_auth_headers(token: str) -> dict:
    return {
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json",
        "User-Agent": "WeeklySchedulerBot (https://example.com, 1.0)",
    }


async def fetch_guild_emojis(client: httpx.AsyncClient, guild_id: str, headers: dict) -> dict:
    # Deprecated: kept for compatibility, not used for polls
    url = f"{DISCORD_API_BASE}/guilds/{guild_id}/emojis"
    r = await client.get(url, headers=headers, timeout=15)
    r.raise_for_status()
    data = r.json()
    return {e["name"]: e["id"] for e in data}


async def send_poll_message(
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

    async with httpx.AsyncClient() as client:
        post_url = f"{DISCORD_API_BASE}/channels/{channel_id}/messages"
        payload = {"content": message, "poll": poll}
        resp = await client.post(post_url, headers=headers, json=payload, timeout=15)
        resp.raise_for_status()


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.post("/schedule/weekly")
async def trigger_weekly(
    req: ScheduleRequest,
    x_cron_secret: Optional[str] = Header(default=None, convert_underscores=False),
):
    # Validate shared secret if configured
    secret = os.getenv("CRON_SECRET")
    if secret:
        if not x_cron_secret or x_cron_secret != secret:
            raise HTTPException(status_code=401, detail="Unauthorized")

    token = get_env("DISCORD_BOT_TOKEN", required=True)
    channel_id = get_env("DISCORD_CHANNEL_ID", required=True)
    guild_id = get_env("DISCORD_GUILD_ID")  # deprecated for polls, ignored

    message = req.message or "こんにちは、今週の日程調整です。イケる日を回答してください！"
    # Prefer request.options, then legacy request.emojis, then env defaults
    options = weekday_options_from_env(req.options or req.emojis)
    # Discord polls require 2-10 options
    if len(options) < 2 or len(options) > 10:
        raise HTTPException(status_code=400, detail="Poll options must be between 2 and 10 items")

    # Determine duration (hours) from request or env (default 168 = 7 days)
    try:
        duration_hours = int(
            req.duration_hours
            or os.getenv("POLL_DURATION_HOURS", "168")
        )
    except ValueError:
        duration_hours = 168

    try:
        await send_poll_message(
            channel_id,
            message,
            options,
            token,
            allow_multiselect=True,
            duration_hours=duration_hours,
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=str(e))

    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
