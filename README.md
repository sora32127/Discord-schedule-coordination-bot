# Discord 日程調整 Bot

- 毎週月曜10:00（日本時間）に、指定チャンネルへ月〜金の投票を投稿します。
- ピン留めや週次投稿にある「日程調整を始める」を押すと、同じ月〜金の投票をその場で投稿できます。
- 投票は複数回答可で、締切は投稿の24時間後です。
- 5分ごとに締め切りを確認し、Discordの集計が確定したら、最多票の曜日を元の投票への返信で知らせます。同票なら最多票の候補からランダムに選びます。全候補が0票の場合も同様です。参加できる人は返信の 👍 を押してください。

Cloudflare WorkersのCron Triggerで定期投稿を実行します。ボタン操作はDiscordから署名付きのリクエストで受け付けます。集計と結果投稿の進捗はチャンネルごとにDurable Objectへ保存します。

## 初回の設定とデプロイ

1. Discordの既存Botを指定チャンネルで使える状態にします。Botに「チャンネルを見る」「メッセージを送信」「投票を送信」「メッセージ履歴を読む」「リアクションを追加」「メッセージをピン留め」の権限を付けます。
2. `.env.example` を `.env` にコピーして、Bot Token、チャンネルID、Discord Developer PortalのGeneral InformationにあるPublic Keyを設定します。`.env` はGitの管理対象外です。
3. Node.js 26.12以降の26系を用意し、以下を実行します。

```sh
npm ci
npx cf auth login
npm run deploy -- --secrets-file .env
```

デプロイに表示されたWorkerのURLを使って、Discordの操作先を登録し、開始ボタンを投稿・ピン留めします。

```sh
node --env-file=.env scripts/connect-discord.mjs https://<worker>.<subdomain>.workers.dev
```

普段の更新は `npm run deploy` で行います。ビルドと設定だけを検証するには `npm run deploy -- --dry-run` を使います。稼働確認用の `GET /healthz` はDiscordへ投稿しません。
