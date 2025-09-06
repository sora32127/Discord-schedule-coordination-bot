// Sensitive variables (Secrets)
// Provide values via `infra/terraform/secrets.auto.tfvars` (gitignored)
// or environment variables prefixed with TF_VAR_. Do not commit secrets.

variable "discord_bot_token" {
  description = "Discord bot token (stored in Secret Manager)"
  type        = string
  sensitive   = true
}
