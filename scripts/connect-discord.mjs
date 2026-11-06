import { startButton } from "../worker/index.mjs";

const API = "https://discord.com/api/v10";
const LAUNCHER = "ボタンを押して、いつでも日程調整を始められます。";
const SNOWFLAKE = /^\d{17,20}$/;

async function request(url, operation, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error(`${operation} failed to connect`);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const code = Number.isInteger(error?.code) ? `, Discord code ${error.code}` : "";
    throw new Error(`${operation} failed (HTTP ${response.status}${code})`);
  }
  return response;
}

async function main() {
  const worker = new URL(process.argv[2] ?? "https://invalid.invalid");
  if (process.argv.length !== 3 || worker.protocol !== "https:" || worker.pathname !== "/"
      || worker.username || worker.password || worker.search || worker.hash) {
    throw new Error("Usage: node --env-file=.env scripts/connect-discord.mjs https://your-worker.workers.dev");
  }
  const { DISCORD_BOT_TOKEN: token, DISCORD_CHANNEL_ID: channelId } = process.env;
  if (!token || !SNOWFLAKE.test(channelId ?? "")) {
    throw new Error("DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID are required");
  }

  const health = await request(new URL("/healthz", worker), "Worker health check");
  if (await health.text() !== "ok") throw new Error("Worker health check returned an unexpected response");

  async function discord(method, path, operation, body) {
    const response = await request(`${API}${path}`, operation, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://github.com/sora32127/Discord-schedule-coordination-bot, 1.0)",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return;
    try {
      return await response.json();
    } catch {
      throw new Error(`${operation} returned an unexpected response`);
    }
  }

  const endpoint = new URL("/interactions", worker).href;
  const application = await discord("GET", "/applications/@me", "Read Discord application");
  if (application.interactions_endpoint_url && application.interactions_endpoint_url !== endpoint) {
    throw new Error("Discord already has a different interactions endpoint configured");
  }

  const channel = `/channels/${channelId}`;
  const { guild_id: guildId } = await discord("GET", channel, "Read Discord channel");
  const { id: botId } = await discord("GET", "/users/@me", "Read Discord bot user");
  if (!SNOWFLAKE.test(guildId ?? "") || !SNOWFLAKE.test(botId ?? "")) {
    throw new Error("Expected a Discord server channel and bot user");
  }

  if (application.interactions_endpoint_url !== endpoint) {
    await discord("PATCH", "/applications/@me", "Connect Worker to Discord", { interactions_endpoint_url: endpoint });
    const updated = await discord("GET", "/applications/@me", "Verify Discord endpoint");
    if (updated.interactions_endpoint_url !== endpoint) throw new Error("Discord endpoint verification failed");
  }

  const buttonId = startButton[0].components[0].custom_id;
  function isLauncher(message) {
    return message.author?.id === botId && message.content === LAUNCHER
      && message.components?.some(row => row.components?.some(button => button.custom_id === buttonId));
  }

  async function findPinnedLauncher() {
    const seenCursors = new Set();
    let cursor;
    do {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("before", cursor);
      const page = await discord("GET", `${channel}/messages/pins?${params}`, "Read channel pins");
      const match = page.items.find(item => isLauncher(item.message));
      if (match) return match.message;
      if (!page.has_more) return;
      cursor = page.items.at(-1)?.pinned_at;
      if (!cursor || seenCursors.has(cursor)) throw new Error("Discord channel pins could not be fully checked");
      seenCursors.add(cursor);
    } while (true);
  }

  let launcher = await findPinnedLauncher();
  if (!launcher) {
    const messages = await discord("GET", `${channel}/messages?limit=100`, "Read recent Discord messages");
    launcher = messages.find(isLauncher) ?? await discord("POST", `${channel}/messages`, "Publish Discord launcher", {
      content: LAUNCHER,
      components: startButton,
      allowed_mentions: { parse: [] },
      nonce: `s-${channelId}`,
      enforce_nonce: true,
    });
    if (!SNOWFLAKE.test(launcher.id ?? "") || !isLauncher(launcher)) {
      throw new Error("Discord did not return the expected launcher message");
    }
    await discord("PUT", `${channel}/messages/pins/${launcher.id}`, "Pin Discord launcher");
    const pinned = await discord("GET", `${channel}/messages/${launcher.id}`, "Verify Discord launcher pin");
    if (!pinned.pinned || !isLauncher(pinned)) throw new Error("Discord launcher pin verification failed");
  }
  if (!SNOWFLAKE.test(launcher.id ?? "")) throw new Error("Discord launcher ID is invalid");
  console.log(`https://discord.com/channels/${guildId}/${channelId}/${launcher.id}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
