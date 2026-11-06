import { START, WEEKLY_QUESTION, weeklyPollMessage } from "./poll.mjs";

export { PollResults } from "./tally.mjs";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_INTERACTION_BYTES = 64 * 1024;

function decodeHex(hex) {
  return Uint8Array.from(hex.match(/../g), pair => Number.parseInt(pair, 16));
}

async function verifiedBody(request, publicKey) {
  const signature = request.headers.get("X-Signature-Ed25519") ?? "";
  const timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
  if (!/^[a-f0-9]{128}$/i.test(signature) || !/^\d{10}$/.test(timestamp)) return null;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;

  const reader = request.body?.getReader();
  if (!reader) return null;
  const prefix = new TextEncoder().encode(timestamp);
  const buffer = new Uint8Array(prefix.length + MAX_INTERACTION_BYTES);
  buffer.set(prefix);
  let size = prefix.length;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > buffer.length) {
      await reader.cancel();
      return null;
    }
    buffer.set(value, size);
    size += value.length;
  }

  const key = await crypto.subtle.importKey("raw", decodeHex(publicKey), "Ed25519", false, ["verify"]);
  const signed = buffer.subarray(0, size);
  const valid = await crypto.subtle.verify("Ed25519", key, decodeHex(signature), signed);
  return valid ? new TextDecoder().decode(signed.subarray(prefix.length)) : null;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz" && request.method === "GET") return new Response("ok");
    if (pathname !== "/interactions") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!/^[a-f0-9]{64}$/i.test(env.DISCORD_PUBLIC_KEY ?? "")) {
      return new Response("Interaction verification is unavailable", { status: 503 });
    }

    const body = await verifiedBody(request, env.DISCORD_PUBLIC_KEY);
    if (body === null) return new Response("Invalid signature", { status: 401 });

    let interaction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (interaction?.type === 1) return Response.json({ type: 1 });
    if (interaction?.channel_id !== env.DISCORD_CHANNEL_ID || !interaction?.member) {
      return Response.json({
        type: 4,
        data: { content: "日程調整は指定チャンネルで利用できます。", flags: 64 },
      });
    }

    if (interaction.type === 3 && interaction.data?.custom_id === START) {
      return Response.json({ type: 4, data: weeklyPollMessage() });
    }
    return new Response("Unsupported interaction", { status: 400 });
  },

  async scheduled(controller, env) {
    if (controller.cron === "*/5 * * * *") {
      await env.POLL_RESULTS.getByName(env.DISCORD_CHANNEL_ID).check(env.DISCORD_CHANNEL_ID, WEEKLY_QUESTION);
      return;
    }

    const response = await fetch(`${DISCORD_API}/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://github.com/sora32127/Discord-schedule-coordination-bot, 1.0)",
      },
      body: JSON.stringify({
        ...weeklyPollMessage(),
        nonce: `weekly-${controller.scheduledTime}`,
        enforce_nonce: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Weekly Discord poll failed (HTTP ${response.status})`);
  },
};
