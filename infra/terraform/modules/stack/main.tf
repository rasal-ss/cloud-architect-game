# One complete environment of the game's hosting: site, API, data, auth and monitoring.
# envs/dev and envs/prod call this module with different settings.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.80" }
  }
}

variable "name" {
  type        = string
  description = "Stack name, e.g. cloud-architect-dev. Prefixes every resource."
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "api_dist_dir" {
  type        = string
  description = "Path to the bundled Lambda handlers (services/api/dist)."
}

variable "extra_origins" {
  type        = list(string)
  description = "Extra CORS origins and Cognito callback URLs, e.g. http://localhost:5173 in dev."
  default     = []
}

variable "alert_email" {
  type    = string
  default = ""
}

variable "monthly_budget_usd" {
  type = number
}

variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

locals {
  is_prod = var.environment == "prod"
}

module "site" {
  source        = "../static_site"
  name          = var.name
  force_destroy = !local.is_prod
}

module "data" {
  source              = "../data"
  name                = var.name
  deletion_protection = local.is_prod
}

module "auth" {
  source               = "../auth"
  name                 = var.name
  callback_urls        = concat([module.site.url], var.extra_origins)
  google_client_id     = var.google_client_id
  google_client_secret = var.google_client_secret
}

module "api" {
  source             = "../api"
  name               = var.name
  table_name         = module.data.table_name
  table_arn          = module.data.table_arn
  jwt_issuer         = module.auth.issuer
  jwt_audience       = [module.auth.client_id]
  allowed_origins    = concat([module.site.url], var.extra_origins)
  dist_dir           = var.api_dist_dir
  log_retention_days = local.is_prod ? 30 : 7
}

module "monitoring" {
  source             = "../monitoring"
  name               = var.name
  alert_email        = var.alert_email
  monthly_budget_usd = var.monthly_budget_usd
  api_id             = module.api.api_id
  function_names     = module.api.function_names
  table_name         = module.data.table_name
}

output "site_url" {
  value = module.site.url
}

output "site_bucket" {
  value = module.site.bucket_name
}

output "distribution_id" {
  value = module.site.distribution_id
}

output "api_url" {
  value = module.api.api_url
}

output "cognito_user_pool_id" {
  value = module.auth.user_pool_id
}

output "cognito_client_id" {
  value = module.auth.client_id
}

output "cognito_domain" {
  value = module.auth.hosted_ui_domain
}

output "dashboard_url" {
  value = module.monitoring.dashboard_url
}
