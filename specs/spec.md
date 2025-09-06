#Primary User Story
- 私はフルリモート企業に勤めるエンジニアです
- 会社の同僚達とオンラインゲームのコミュニティを組織しました
- 毎週の日程調整を行うため、日程調整を行うDiscordのbotを作りたいです

# 仕様
- DiscordのBotは毎週月曜日のAM10:00にメッセージを送信する
- 送信するメッセージは「今週の日程調整です！以下の日程の中から、都合の良い日程を教えてください」である
- メッセージに以下のemojiが付与されている
  - :getsuyoubi:
  - :kayoubi:
  - :suiyoubi:
  - :mokuyoubi:
  - :kinyoubi:
- Discordサーバー内のメンバーはemojiを押し、都合の良い日程を教える

# 詳細
- 実行はCloud Runで行う

