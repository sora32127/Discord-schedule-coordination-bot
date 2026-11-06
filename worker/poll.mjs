export const START = "schedule:start";
export const WEEKLY_QUESTION = "こんにちは、今週の日程調整です。イケる日を回答してください！";
const WEEKDAYS = ["月", "火", "水", "木", "金"];

export const startButton = [{
  type: 1,
  components: [{ type: 2, style: 1, label: "日程調整を始める", custom_id: START }],
}];

export function weeklyPollMessage() {
  return {
    content: WEEKLY_QUESTION,
    poll: {
      question: { text: WEEKLY_QUESTION },
      answers: WEEKDAYS.map(text => ({ poll_media: { text } })),
      duration: 24,
      allow_multiselect: true,
    },
    components: startButton,
    allowed_mentions: { parse: [] },
  };
}
