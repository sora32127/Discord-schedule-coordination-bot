import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "discord-schedule-coordination-bot",
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
    },
    triggers: [triggers.scheduled({ schedule: "0 1 * * MON" })],
  },
});
