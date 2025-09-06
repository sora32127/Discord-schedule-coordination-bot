provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

data "google_project" "this" {}

# Artifact Registry for container images
resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = var.ar_repo
  description   = "Images for ${var.service_name}"
  format        = "DOCKER"
}

# Service account for Cloud Run runtime
resource "google_service_account" "run_sa" {
  account_id   = "${var.service_name}-sa"
  display_name = "${var.service_name} runtime"
}

# Service account for Cloud Scheduler to invoke Cloud Run
resource "google_service_account" "scheduler_sa" {
  account_id   = "${var.service_name}-scheduler"
  display_name = "${var.service_name} scheduler invoker"
}

# Grant Cloud Build SA permissions to deploy to Run and push to AR
locals {
  # Cloud Build default service account uses PROJECT_NUMBER, not PROJECT_ID
  cloud_build_sa = "${data.google_project.this.number}@cloudbuild.gserviceaccount.com"
}

resource "google_project_iam_member" "cb_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${local.cloud_build_sa}"
}

resource "google_project_iam_member" "cb_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${local.cloud_build_sa}"
}

resource "google_service_account_iam_member" "cb_run_sa_user" {
  service_account_id = google_service_account.run_sa.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${local.cloud_build_sa}"
}

# Secret: Discord bot token
resource "google_secret_manager_secret" "discord_token" {
  secret_id = "discord-bot-token"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "discord_token_v" {
  secret      = google_secret_manager_secret.discord_token.id
  secret_data = var.discord_bot_token
}

# Allow Cloud Build to read secrets during deploy
resource "google_secret_manager_secret_iam_member" "cb_secret_access_token" {
  secret_id = google_secret_manager_secret.discord_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.cloud_build_sa}"
}

# Allow Cloud Run runtime service account to read secrets at runtime
resource "google_secret_manager_secret_iam_member" "run_secret_access_token" {
  secret_id = google_secret_manager_secret.discord_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run_sa.email}"
}

# Create Cloud Run service (v2) with a placeholder image; Cloud Build will deploy new revisions
resource "google_cloud_run_v2_service" "service" {
  name     = var.service_name
  location = var.region

  template {
    service_account = google_service_account.run_sa.email
    containers {
      # Placeholder image; replaced by Cloud Build
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      env {
        name  = "DISCORD_CHANNEL_ID"
        value = var.discord_channel_id
      }
      env {
        name  = "DISCORD_GUILD_ID"
        value = var.discord_guild_id
      }
      env {
        name  = "WEEKDAY_OPTIONS"
        value = var.weekday_options
      }
      env {
        name  = "POLL_DURATION_HOURS"
        value = tostring(var.poll_duration_hours)
      }
      # Secrets will be set at deploy time by Cloud Build
    }
  }
  ingress = "INGRESS_TRAFFIC_ALL"
}

# Allow Scheduler SA to invoke the service
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  location = google_cloud_run_v2_service.service.location
  name     = google_cloud_run_v2_service.service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler_sa.email}"
}

# Cloud Scheduler job to call /schedule/weekly with OIDC auth and header
resource "google_cloud_scheduler_job" "weekly" {
  name        = "${var.service_name}-weekly"
  description = "Trigger weekly poll"
  schedule    = var.schedule_cron
  time_zone   = "Asia/Tokyo"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.service.uri}/schedule/weekly"

    headers = {
      "Content-Type"  = "application/json"
    }

    body = base64encode("{}")

    oidc_token {
      service_account_email = google_service_account.scheduler_sa.email
      audience              = google_cloud_run_v2_service.service.uri
    }
  }
}

output "cloud_run_uri" {
  value = google_cloud_run_v2_service.service.uri
}

output "artifact_registry_repo" {
  value = google_artifact_registry_repository.repo.repository_id
}

output "run_service_account" {
  value = google_service_account.run_sa.email
}
