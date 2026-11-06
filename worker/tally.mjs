import { DurableObject } from "cloudflare:workers";

const DISCORD_API = "https://discord.com/api/v10";
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const PAGE_BUDGET = 3;
const STATE_KEY = "poll-results";

export class PollResults extends DurableObject {
  #checking;
  #botId;

  async check(channelId, question) {
    this.#checking ??= this.#checkChannel(channelId, question).finally(() => {
      this.#checking = undefined;
    });
    return this.#checking;
  }

  async #request(path, method = "GET", body) {
    const response = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://github.com/sora32127/Discord-schedule-coordination-bot, 1.0)",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) await response.body?.cancel();
    return response;
  }

  async #checkChannel(channelId, question) {
    if (!this.#botId) {
      const bot = await this.#request("/users/@me");
      if (!bot.ok) throw new Error(`Discord bot lookup failed (HTTP ${bot.status})`);
      this.#botId = (await bot.json()).id;
    }

    const state = await this.ctx.storage.get(STATE_KEY) ?? { pending: {} };
    const now = Date.now();
    const path = `/channels/${channelId}/messages`;
    for (const [id, poll] of Object.entries(state.pending)) {
      if (poll.expiresAt <= now - DAY_MS) delete state.pending[id];
    }
    if (!await this.#scanHistory(path, question, state, now)) return;

    let failed = false;
    for (const [id, poll] of Object.entries(state.pending)) {
      if (poll.expiresAt > now) continue;
      try {
        await this.#finishPoll(path, state, id, poll);
      } catch (error) {
        failed = true;
        console.error("Discord poll result check failed", error);
      }
    }
    if (failed) throw new Error("One or more Discord polls could not be processed");
  }

  async #scanHistory(path, question, state, now) {
    let { newest, before } = state.scan ?? {};
    let finished = false;
    for (let page = 0; page < PAGE_BUDGET && !finished; page++) {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) query.set("before", before);
      const response = await this.#request(`${path}?${query}`);
      if (!response.ok) throw new Error(`Discord history lookup failed (HTTP ${response.status})`);
      const messages = await response.json();
      newest ??= messages[0]?.id;

      for (const message of messages) {
        // Discord returns newest first. Keep the previous cursor until all pages in this scan have been read.
        if (state.cursor ? BigInt(message.id) <= BigInt(state.cursor) : Date.parse(message.timestamp) <= now - 2 * DAY_MS) {
          finished = true;
          break;
        }
        if (message.author?.id !== this.#botId) continue;

        const sourceId = message.message_reference?.message_id;
        const pending = state.pending[sourceId];
        if (message.type === 19 && pending?.resultContent && pending.resultContent === message.content) {
          pending.resultMessageId ??= message.id;
        }

        const expiresAt = Date.parse(message.poll?.expiry);
        if (message.poll?.question?.text === question && expiresAt > now - DAY_MS) {
          state.pending[message.id] ??= { expiresAt };
        }
      }

      if (messages.length < PAGE_SIZE) finished = true;
      before = messages.at(-1)?.id;
    }

    if (finished) {
      if (newest && (!state.cursor || BigInt(newest) > BigInt(state.cursor))) state.cursor = newest;
      delete state.scan;
    } else {
      state.scan = { newest, before };
    }
    await this.ctx.storage.put(STATE_KEY, state);
    return finished;
  }

  async #finishPoll(path, state, id, poll) {
    if (!poll.resultMessageId) {
      const response = await this.#request(`${path}/${id}`);
      if (response.status === 404) return this.#forgetPoll(state, id);
      if (!response.ok) throw new Error(`Discord poll lookup failed (HTTP ${response.status})`);

      if (!poll.resultContent) {
        const { poll: source } = await response.json();
        if (source?.results?.is_finalized !== true) return;

        const counts = new Map(source.results.answer_counts.map(({ id, count }) => [id, count]));
        const max = Math.max(...source.answers.map(answer => counts.get(answer.answer_id) ?? 0));
        const winners = source.answers.filter(answer => (counts.get(answer.answer_id) ?? 0) === max);
        const winner = winners[Math.floor(Math.random() * winners.length)];
        poll.resultContent = `次は${winner.poll_media.text}曜日です。行ける方は 👍 を押してください`;
        await this.ctx.storage.put(STATE_KEY, state);
      } else {
        await response.body?.cancel();
      }

      const reply = await this.#request(path, "POST", {
        content: poll.resultContent,
        message_reference: { message_id: id },
        allowed_mentions: { parse: [], replied_user: false },
        nonce: `r-${id}`,
        enforce_nonce: true,
      });
      if (!reply.ok) throw new Error(`Discord poll result post failed (HTTP ${reply.status})`);
      poll.resultMessageId = (await reply.json()).id;
      await this.ctx.storage.put(STATE_KEY, state);
    }

    const reaction = await this.#request(`${path}/${poll.resultMessageId}/reactions/${encodeURIComponent("👍")}/@me`, "PUT");
    if (reaction.ok || reaction.status === 404) return this.#forgetPoll(state, id);
    throw new Error(`Discord poll reaction failed (HTTP ${reaction.status})`);
  }

  #forgetPoll(state, id) {
    delete state.pending[id];
    return this.ctx.storage.put(STATE_KEY, state);
  }
}
