# Discord 日程調整 Bot (Cloud Run)

このリポジトリは、毎週月曜日 10:00 に指定チャンネルへ日程調整メッセージを送信し、「Poll（投票）」で選択肢を提示する Discord Bot です（複数選択可）。Cloud Run での実行を想定し、HTTP 経由で外部スケジューラ（Cloud Scheduler）から起動します。

## 仕様（specs/spec.md に基づく）
- 月曜 10:00 にメッセージ送信。
- 内容: 「こんにちは、今週の日程調整です。イケる日を回答してください！」
- Poll の選択肢（デフォルト）: 「月, 火, 水, 木, 金」
- メンバーは投票（複数選択可）で都合を表明します。

## アーキテクチャ概要
- Bot の常時接続（Gateway）は行いません。Cloud Scheduler → Cloud Run(HTTP) → Discord REST API の呼び出しで実現します。
- メッセージ送信と同時に Poll を作成します（Discord Poll API）。

## 必要権限（Bot 招待時）
- Send Messages（メッセージ送信）
- Create Polls（投票の作成）
- Read Message History（メッセージ履歴の参照）

## 環境変数
- `DISCORD_BOT_TOKEN`（必須）: Discord Bot Token。
- `DISCORD_CHANNEL_ID`（必須）: 送信先チャンネル ID。
- `DISCORD_GUILD_ID`（任意）: 旧仕様互換のため残置（Poll では未使用）。
- `WEEKDAY_OPTIONS`（任意）: Poll の選択肢（カンマ区切り）。デフォルトは `月,火,水,木,金`。
- `WEEKDAY_EMOJI_NAMES`（任意）: 旧仕様の互換用（指定がある場合は選択肢として扱います）。
- `POLL_DURATION_HOURS`（任意）: Poll の有効時間（時間）。デフォルト 168（7日）。
  

## ローカル実行
1) 依存関係のインストール:

```
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2) サーバ起動:

```
uvicorn app.main:app --reload --port 8080
```

3) 疎通確認:

```
curl http://localhost:8080/healthz
```

4) 手動トリガー（要: 環境変数設定）:

```
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"message": "こんにちは、今週の日程調整です。イケる日を回答してください！", "options": null}' \
  http://localhost:8080/schedule/weekly
```

## Cloud Run デプロイ例
1) ソースから直接デプロイ（gcloud run deploy --source 推奨）:

```
gcloud run deploy discord-scheduler \
  --source=Disorder \
  --region asia-northeast1 \
  --allow-unauthenticated=false \
  --service-account=discord-scheduler-sa@<PROJECT_ID>.iam.gserviceaccount.com \
  --set-env-vars DISCORD_CHANNEL_ID=***,DISCORD_GUILD_ID=,WEEKDAY_OPTIONS=月,火,水,木,金,POLL_DURATION_HOURS=168 \
  --set-secrets DISCORD_BOT_TOKEN=discord-bot-token:latest
```

2) 画像ビルドしてからデプロイ（オプション）:

```
gcloud builds submit --tag gcr.io/<PROJECT_ID>/discord-scheduler

gcloud run deploy discord-scheduler \
  --image gcr.io/<PROJECT_ID>/discord-scheduler \
  --platform managed \
  --region asia-northeast1 \
  --allow-unauthenticated=false \
  --set-env-vars DISCORD_BOT_TOKEN=***,DISCORD_CHANNEL_ID=***,DISCORD_GUILD_ID=***,WEEKDAY_EMOJI_NAMES=getsuyoubi,kayoubi,suiyoubi,mokuyoubi,kinyoubi
```

3) Cloud Scheduler の設定（毎週月曜 10:00）:
- Cron: `0 10 * * 1`
- ターゲット: HTTP
- メソッド: POST
- URL: Cloud Run サービス URL + `/schedule/weekly`
- ヘッダ: `Content-Type: application/json`
- ボディ: `{}`（空オブジェクトで可）

OIDC を使った認証で保護します（共有シークレットは不要）。

## 注意点（Poll）
- Poll の選択肢は 2〜10 個にしてください。
- `POLL_DURATION_HOURS` で期限を指定できます（既定は 7 日）。

## API エンドポイント
- `GET /healthz`: ヘルスチェック
- `POST /schedule/weekly`: 手動トリガー。リクエストボディでメッセージや選択肢を上書き可能。
  - 例: `{ "message": "...", "options": ["月", "火", ...], "duration_hours": 168 }`

## ディレクトリ構成
- `app/main.py`: FastAPI アプリ本体（Discord REST 呼び出し：Poll 作成）。
- `requirements.txt`: 依存定義。
- `Dockerfile`: Cloud Run 用コンテナ。
- `specs/spec.md`: 仕様書（本件の要件）。
