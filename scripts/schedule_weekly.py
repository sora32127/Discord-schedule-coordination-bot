import os
import asyncio
from app.main import send_poll_message, weekday_options_from_env, get_env


async def main():
    token = get_env("DISCORD_BOT_TOKEN", required=True)
    channel_id = get_env("DISCORD_CHANNEL_ID", required=True)

    message = os.getenv("WEEKLY_MESSAGE")
    options = weekday_options_from_env(None)
    try:
        duration_hours = int(os.getenv("POLL_DURATION_HOURS", "168"))
    except ValueError:
        duration_hours = 168

    await send_poll_message(
        channel_id=channel_id,
        message=message,
        options=options,
        token=token,
        allow_multiselect=True,
        duration_hours=duration_hours,
    )


if __name__ == "__main__":
    asyncio.run(main())


