variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "Primary region (Cloud Run, AR, Scheduler)"
  type        = string
  default     = "asia-northeast1"
}

variable "service_name" {
  description = "Cloud Run service name"
  type        = string
  default     = "discord-scheduler"
}

variable "ar_repo" {
  description = "Artifact Registry repository name"
  type        = string
  default     = "discord-scheduler"
}

variable "schedule_cron" {
  description = "Cron schedule for weekly run"
  type        = string
  default     = "0 10 * * 1" # Mon 10:00
}

variable "discord_channel_id" {
  description = "Target Discord channel ID"
  type        = string
}

variable "discord_guild_id" {
  description = "Discord guild ID (legacy; optional)"
  type        = string
  default     = ""
}

variable "weekday_options" {
  description = "Poll options (comma-separated)"
  type        = string
  default     = "月,火,水,木,金"
}

variable "poll_duration_hours" {
  description = "Poll duration in hours"
  type        = number
  default     = 168
}
