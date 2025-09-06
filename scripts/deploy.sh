#!/usr/bin/env bash
set -euo pipefail

# Non-interactive deploy script
# - Reads values from infra/terraform/terraform.tfvars and secrets.tfvars if present
# - Falls back to gcloud config project, .env values, and Terraform defaults
# - Provisions infra with Terraform, then deploys to Cloud Run via gcloud run deploy --source

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TF_DIR="$ROOT_DIR/infra/terraform"
ENV_FILE="$ROOT_DIR/.env"

have_file() { [ -f "$1" ]; }

# Remove leading/trailing whitespace and quotes; strip CR
clean() {
  awk 'BEGIN{ORS=""} {print}' <<<"$1" | tr -d '\r' | sed -E 's/^[[:space:]]*"?//; s/"?[[:space:]]*$//'
}

read_tfvar() {
  # Usage: read_tfvar KEY [FILE]
  local key="$1"; shift || true
  local file="${1:-}"
  [ -n "$file" ] || return 1
  [ -f "$file" ] || return 1
  awk -v k="$key" -F'=' '
    $0 !~ /^\s*#/ {
      split($1, lhs, /[[:space:]]+/)
      if (lhs[1] == k) {
        v=$2
        sub(/^\s+/, "", v)
        sub(/\s+$/, "", v)
        # trim quotes
        gsub(/^"|"$/, "", v)
        print v
        exit 0
      }
    }
  ' "$file"
}

read_envfile() {
  # Usage: read_envfile KEY [FILE]
  local key="$1"; shift || true
  local file="${1:-$ENV_FILE}"
  [ -f "$file" ] || return 1
  awk -v k="$key" -F'=' '
    $0 !~ /^\s*#/ {
      split($1, lhs, /[[:space:]]+/)
      if (lhs[1] == k) {
        v=$2
        sub(/^\s+/, "", v)
        sub(/\s+$/, "", v)
        print v
        exit 0
      }
    }
  ' "$file"
}

ensure_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Error: required command '$1' not found in PATH" >&2; exit 1; }
}

ensure_cmd terraform
ensure_cmd gcloud

TFVARS_FILE="$TF_DIR/terraform.tfvars"
SECRETS_FILE="$TF_DIR/secrets.tfvars"

# Collect values from tfvars, falling back to defaults or .env
project_id="$(read_tfvar project_id "$TFVARS_FILE" || true)"
if [ -z "${project_id:-}" ]; then
  project_id="$(gcloud config get-value project 2>/dev/null || true)"
fi
[ -n "${project_id:-}" ] && project_id="$(clean "$project_id")"
[ -n "${project_id:-}" ] || { echo "Error: project_id not set in terraform.tfvars and gcloud config has no project" >&2; exit 1; }

region="$(read_tfvar region "$TFVARS_FILE" || true)"
region="$(clean "${region:-}")"
region="${region:-asia-northeast1}"

service_name="$(read_tfvar service_name "$TFVARS_FILE" || true)"
service_name="$(clean "${service_name:-}")"
service_name="${service_name:-discord-scheduler}"

discord_channel_id="$(read_tfvar discord_channel_id "$TFVARS_FILE" || true)"
if [ -z "${discord_channel_id:-}" ]; then
  discord_channel_id="$(read_envfile DISCORD_CHANNEL_ID || true)"
fi
discord_channel_id="$(clean "${discord_channel_id:-}")"
[ -n "${discord_channel_id:-}" ] || { echo "Error: discord_channel_id not set in terraform.tfvars or .env" >&2; exit 1; }

discord_guild_id="$(read_tfvar discord_guild_id "$TFVARS_FILE" || true)"
if [ -z "${discord_guild_id:-}" ]; then
  discord_guild_id="$(read_envfile DISCORD_GUILD_ID || true)"
fi
discord_guild_id="$(clean "${discord_guild_id:-}")"
discord_guild_id="${discord_guild_id:-}"

weekday_options="$(read_tfvar weekday_options "$TFVARS_FILE" || true)"
weekday_options="$(clean "${weekday_options:-}")"
weekday_options="${weekday_options:-月,火,水,木,金}"

poll_duration_hours="$(read_tfvar poll_duration_hours "$TFVARS_FILE" || true)"
poll_duration_hours="$(clean "${poll_duration_hours:-}")"
poll_duration_hours="${poll_duration_hours:-24}"

# Secrets
discord_bot_token_var="$(read_tfvar discord_bot_token "$SECRETS_FILE" || true)"
if [ -z "${discord_bot_token_var:-}" ]; then
  discord_bot_token_var="$(read_envfile DISCORD_BOT_TOKEN || true)"
fi
discord_bot_token_var="$(clean "${discord_bot_token_var:-}")"
[ -n "${discord_bot_token_var:-}" ] || { echo "Error: discord_bot_token not set in secrets.tfvars or .env (DISCORD_BOT_TOKEN)" >&2; exit 1; }

# Auto-generate tfvars files if missing (non-interactive)
if ! have_file "$TFVARS_FILE"; then
  echo "==> Writing $TFVARS_FILE (auto-generated)"
  cat > "$TFVARS_FILE" <<EOF
project_id          = "$project_id"
region              = "$region"
service_name        = "$service_name"
ar_repo             = "${service_name}"
schedule_cron       = "0 10 * * 1"
discord_channel_id  = "$discord_channel_id"
discord_guild_id    = "${discord_guild_id}"
weekday_options     = "$weekday_options"
poll_duration_hours = $poll_duration_hours
EOF
fi

if ! have_file "$SECRETS_FILE"; then
  echo "==> Writing $SECRETS_FILE (auto-generated, gitignored)"
  cat > "$SECRETS_FILE" <<EOF
discord_bot_token = "$discord_bot_token_var"
EOF
fi

echo "==> Using configuration"
echo "project_id=$project_id"
echo "region=$region"
echo "service_name=$service_name"
echo "discord_channel_id=$discord_channel_id"
echo "discord_guild_id=${discord_guild_id:-}"
echo "weekday_options=$weekday_options"
echo "poll_duration_hours=$poll_duration_hours"

pushd "$TF_DIR" >/dev/null

echo "==> Terraform init"
terraform init -upgrade

echo "==> Terraform apply (non-interactive)"
TF_APPLY_ARGS=(apply -auto-approve)
have_file "$TFVARS_FILE" && TF_APPLY_ARGS+=("-var-file=$TFVARS_FILE")
have_file "$SECRETS_FILE" && TF_APPLY_ARGS+=("-var-file=$SECRETS_FILE")

# If secrets file missing, pass via env to avoid showing in CLI args
if ! have_file "$SECRETS_FILE"; then
  export TF_VAR_discord_bot_token="$discord_bot_token_var"
fi

terraform "${TF_APPLY_ARGS[@]}"

popd >/dev/null

echo "==> Deploy to Cloud Run via gcloud (non-interactive)"
sa_email="${service_name}-sa@${project_id}.iam.gserviceaccount.com"

# Ensure gcloud project is set to avoid odd quoting in config
gcloud config set project "$project_id" >/dev/null

ENV_VARS_ARG="^~^DISCORD_CHANNEL_ID=${discord_channel_id}~DISCORD_GUILD_ID=${discord_guild_id}~WEEKDAY_OPTIONS=${weekday_options}~POLL_DURATION_HOURS=${poll_duration_hours}"

gcloud run deploy "$service_name" \
  --project "$project_id" \
  --source "$ROOT_DIR" \
  --region "$region" \
  --service-account "$sa_email" \
  --set-env-vars "$ENV_VARS_ARG" \
  --set-secrets "DISCORD_BOT_TOKEN=discord-bot-token:latest" \
  --quiet

echo "==> Done. Check Cloud Run service: $service_name in region $region (project $project_id)"
