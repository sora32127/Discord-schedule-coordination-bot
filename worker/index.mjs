const DISCORD_API = "https://discord.com/api/v10";
const START = "schedule:start";
const CREATE = "schedule:create";
const POLL_HOURS = 24;
const MAX_INTERACTION_BYTES = 64 * 1024;
const WEEKLY_QUESTION = "こんにちは、今週の日程調整です。イケる日を回答してください！";
const WEEKDAYS = ["月", "火", "水", "木", "金"];
const NO_MENTIONS = { parse: [] };

export const startButton = [{
  type: 1,
  components: [{ type: 2, style: 1, label: "日程調整を始める", custom_id: START }],
}];

function poll(question, options) {
  return {
    question: { text: question },
    answers: options.map(text => ({ poll_media: { text } })),
    duration: POLL_HOURS,
    allow_multiselect: true,
  };
}

function ephemeral(content) {
  return Response.json({ type: 4, data: { content, flags: 64 } });
}

function openScheduleModal() {
  return Response.json({
    type: 9,
    data: {
      custom_id: CREATE,
      title: "日程調整を始める",
      components: [
        {
          type: 18,
          label: "何の日程を調整しますか？",
          component: { type: 4, style: 1, custom_id: "title", required: true, max_length: 300 },
        },
        {
          type: 18,
          label: "候補日（1行に1つ、2〜10件）",
          component: {
            type: 4,
            style: 2,
            custom_id: "options",
            required: true,
            max_length: 560,
            placeholder: "例  11/13 20:00",
          },
        },
      ],
    },
  });
}

function publishSchedule(components) {
  const fields = new Map(components.map(({ component }) => [component?.custom_id, component?.value]));
  const question = (fields.get("title") ?? "").trim();
  const options = (fields.get("options") ?? "").split("\n").map(line => line.trim()).filter(Boolean);

  if (!question || question.length > 300) {
    return ephemeral("調整する予定の名前を300文字以内で入力してください。");
  }
  if (options.length < 2 || options.length > 10 || options.some(option => option.length > 55)) {
    return ephemeral("候補を2〜10件、1行に1つ入力してください。各候補は55文字以内です。");
  }
  if (new Set(options).size !== options.length) {
    return ephemeral("候補が重複しています。異なる候補を入力してください。");
  }

  return Response.json({
    type: 4,
    data: {
      poll: poll(question, options),
      allowed_mentions: NO_MENTIONS,
    },
  });
}

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
      return ephemeral("日程調整は指定チャンネルで利用できます。");
    }

    if (interaction.type === 3 && interaction.data?.custom_id === START) return openScheduleModal();
    if (interaction.type === 5 && interaction.data?.custom_id === CREATE) {
      return publishSchedule(interaction.data.components ?? []);
    }
    return new Response("Unsupported interaction", { status: 400 });
  },

  async scheduled(controller, env) {
    const response = await fetch(`${DISCORD_API}/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://github.com/sora32127/Discord-schedule-coordination-bot, 1.0)",
      },
      body: JSON.stringify({
        content: WEEKLY_QUESTION,
        poll: poll(WEEKLY_QUESTION, WEEKDAYS),
        components: startButton,
        allowed_mentions: NO_MENTIONS,
        nonce: `weekly-${controller.scheduledTime}`,
        enforce_nonce: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Weekly Discord poll failed (HTTP ${response.status})`);
  },
};
