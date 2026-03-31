# Discord 日程調整 Bot

毎週月曜日 10:00 に Discord の指定チャンネルへ日程調整 Poll を自動送信する Bot です。  
Gateway（常時接続）は使わず、**Cloud Scheduler → Cloud Run → Discord REST API** の構成で動作します。

## アーキテクチャ

```
Cloud Scheduler (毎週月曜 10:00)
        │  HTTP POST
        ▼
   Cloud Run
  (app/schedule_weekly.py)
        │  Discord REST API
        ▼
  Discord チャンネル
  （Poll 送信・複数選択可）
```

## 動作概要

- 指定チャンネルに「こんにちは、今週の日程調整です。イケる日を回答してください！」を投稿します。
- メッセージと同時に Discord Poll を作成し、曜日の選択肢（デフォルト: 月〜金）を提示します。
- メンバーは投票（複数選択可）で参加可能な日を回答します。

## Bot に必要な権限

| 権限 | 用途 |
|------|------|
| Send Messages | メッセージ送信 |
| Create Polls | Poll 作成 |
| Read Message History | メッセージ履歴の参照 |

## 環境変数

| 変数名 | 必須 | デフォルト | 説明 |
|--------|------|-----------|------|
| `DISCORD_BOT_TOKEN` | ✅ | — | Discord Bot Token |
| `DISCORD_CHANNEL_ID` | ✅ | — | 送信先チャンネル ID |
| `WEEKDAY_OPTIONS` | — | `月,火,水,木,金` | Poll の選択肢（カンマ区切り、2〜10 個） |
| `POLL_DURATION_HOURS` | — | `24` | Poll の有効時間（時間単位） |
| `DISCORD_GUILD_ID` | — | — | 旧仕様互換のため残置（現在は未使用） |

`.env.example` をコピーして `.env` を作成し、値を設定してください。

```bash
cp .env.example .env
# .env を編集して DISCORD_BOT_TOKEN と DISCORD_CHANNEL_ID を設定する
```

## ローカル実行

```bash
# 1. 依存関係のインストール
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. スクリプトを直接実行（要: 環境変数の設定）
python -m app.schedule_weekly
```

> **注意**: Poll の選択肢は 2〜10 個に収めてください（Discord API の制限）。

## Cloud Run へのデプロイ

### 推奨: デプロイスクリプトを使う

```bash
bash scripts/deploy.sh
```

スクリプトは以下を自動で行います:
1. `infra/terraform/terraform.tfvars` または `.env` から設定値を読み込む
2. Terraform でインフラ（サービスアカウント・Secret Manager など）を構築する
3. `gcloud run deploy --source .` でソースからイメージをビルドして Cloud Run へデプロイする

### 手動デプロイ

```bash
gcloud run deploy discord-scheduler \
  --source . \
  --region asia-northeast1 \
  --no-allow-unauthenticated \
  --service-account discord-scheduler-sa@<PROJECT_ID>.iam.gserviceaccount.com \
  --set-env-vars "^~^DISCORD_CHANNEL_ID=<CHANNEL_ID>~WEEKDAY_OPTIONS=月,火,水,木,金~POLL_DURATION_HOURS=24" \
  --set-secrets DISCORD_BOT_TOKEN=discord-bot-token:latest
```

### Cloud Scheduler の設定

Cloud Scheduler から Cloud Run を毎週月曜 10:00 に呼び出すよう設定します。  
OIDC トークンを使って認証します（共有シークレット不要）。

| 項目 | 値 |
|------|----|
| Cron | `0 10 * * 1` |
| ターゲット | HTTP |
| メソッド | POST |
| URL | Cloud Run サービス URL |
| ヘッダ | `Content-Type: application/json` |
| ボディ | `{}` |

## ディレクトリ構成

```
.
├── app/
│   ├── main.py              # Discord REST API 呼び出し関数（Poll 送信など）
│   └── schedule_weekly.py   # エントリーポイント（環境変数を読み込み Poll を送信）
├── scripts/
│   └── deploy.sh            # 自動デプロイスクリプト（Terraform + gcloud）
├── specs/
│   └── spec.md              # 仕様書
├── Dockerfile               # Cloud Run 用コンテナ定義
├── requirements.txt         # Python 依存パッケージ
└── .env.example             # 環境変数のサンプル
```
