import { bindings, defineConfig, exports, triggers } from "cf/config";

const workerName = "discord-schedule-coordination-bot";

export default defineConfig({
  worker: {
    name: workerName,
    entrypoint: "./worker/index.mjs",
    compatibilityDate: "2026-11-06",
    workersDev: true,
    previewUrls: false,
    observability: {
      enabled: true,
      traces: { enabled: true },
    },
    env: {
      DISCORD_BOT_TOKEN: bindings.secret(),
      DISCORD_CHANNEL_ID: bindings.secret(),
      DISCORD_PUBLIC_KEY: bindings.secret(),
      POLL_RESULTS: bindings.durableObject({ worker: workerName, exportName: "PollResults" }),
    },
    exports: {
      PollResults: exports.durableObject({ storage: "sqlite" }),
    },
    triggers: [
      triggers.scheduled({ schedule: "0 1 * * MON" }),
      triggers.scheduled({ schedule: "*/5 * * * *" }),
    ],
  },
});
