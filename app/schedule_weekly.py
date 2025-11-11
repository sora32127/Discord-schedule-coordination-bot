from main import send_poll_message, weekday_options_from_env, get_env

def main():
    token = get_env("DISCORD_BOT_TOKEN", required=True)
    channel_id = get_env("DISCORD_CHANNEL_ID", required=True)
    message = "こんにちは、今週の日程調整です。イケる日を回答してください！"
    options = weekday_options_from_env(None)
    duration_hours = 24
    print("Settings: ", {
        "channel_id": channel_id,
        "message": message,
        "options": options,
        "token": token,
        "allow_multiselect": True,
        "duration_hours": duration_hours,
    })

    send_poll_message(channel_id, message, options, token, True, duration_hours)


if __name__ == "__main__":
    main()


