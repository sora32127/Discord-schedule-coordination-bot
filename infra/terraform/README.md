# Terraform: Cloud Run + Scheduler + Artifact Registry + Secrets

This stack provisions the infrastructure to run the Discord weekly scheduler on Cloud Run, build via Cloud Build, and trigger weekly via Cloud Scheduler.

## What it creates
- Artifact Registry (Docker) repository for images
- Cloud Run service (v2) with a placeholder image
- Service Accounts: runtime (Run) and invoker (Scheduler)
- Secret Manager secret: `discord-bot-token`
- IAM so Cloud Build can push/deploy and read secrets
- Cloud Scheduler job to call `/schedule/weekly` every Monday 10:00 JST with OIDC

## Prerequisites
- gcloud auth and a GCP project
- Enable APIs (one-time):
  - `artifactregistry.googleapis.com`
  - `run.googleapis.com`
  - `cloudbuild.googleapis.com`
  - `cloudscheduler.googleapis.com`
  - `secretmanager.googleapis.com`

## Configure variables
Create `terraform.tfvars` (values are examples):

project_id           = "your-project-id"
region               = "asia-northeast1"
service_name         = "discord-scheduler"
ar_repo              = "discord-scheduler"
discord_channel_id   = "123456789012345678"
discord_guild_id     = "" # optional
weekday_options      = "月,火,水,木,金"
poll_duration_hours  = 168
discord_bot_token    = "<BOT_TOKEN>"

## Apply
terraform init
terraform apply

Outputs will include the Cloud Run URL.

## Deploy (non-interactive)
Use the provided script. It auto-generates `infra/terraform/terraform.tfvars` and `infra/terraform/secrets.tfvars` from your `gcloud` config and `.env` if they don’t exist (no prompts):

bash scripts/deploy.sh

Notes:
- No prompts; uses `-auto-approve` for Terraform and `--quiet` for `gcloud`.
- If missing, `terraform.tfvars` is created using `gcloud config get-value project`, defaults, and `.env` values like `DISCORD_CHANNEL_ID`.
- If missing, `secrets.tfvars` is created using `.env` `DISCORD_BOT_TOKEN` (file is gitignored by default).
- Secrets come from Secret Manager (`discord-bot-token`), created by Terraform.

## (Alternative) Build & Deploy via Cloud Build file
If you prefer an explicit pipeline, this repo includes `cloudbuild.yaml`. See the `gcloud builds submit` example below:

gcloud builds submit \
  --region=asia-northeast1 \
  --substitutions=_REGION=asia-northeast1,_SERVICE=discord-scheduler,_AR_REPO=discord-scheduler,_AR_HOST=asia-northeast1-docker.pkg.dev,_DISCORD_CHANNEL_ID=123456789012345678,_DISCORD_GUILD_ID=,_WEEKDAY_OPTIONS=月,火,水,木,金,_POLL_DURATION_HOURS=168,_DISCORD_BOT_TOKEN_SECRET_NAME=discord-bot-token \
  .
