terraform {
  required_version = ">= 1.11"

  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.80" }
    archive = { source = "hashicorp/archive", version = "~> 2.6" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }

  # Partial configuration: the bucket and region come from backend.hcl (see backend.hcl.example),
  # or from -backend-config flags in CI. State locking uses an S3 lock file (no DynamoDB table).
  backend "s3" {
    key          = "cloud-architect/dev/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "alert_email" {
  type        = string
  description = "Email for alarms and budget alerts."
  default     = ""
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

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "cloud-architect-game"
      Environment = "dev"
      Stack       = "cloud-architect-dev"
      ManagedBy   = "terraform"
    }
  }
}

module "stack" {
  source               = "../../modules/stack"
  name                 = "cloud-architect-dev"
  environment          = "dev"
  api_dist_dir         = "${path.root}/../../../../services/api/dist"
  extra_origins        = ["http://localhost:5173"]
  alert_email          = var.alert_email
  monthly_budget_usd   = 10
  google_client_id     = var.google_client_id
  google_client_secret = var.google_client_secret
}

output "site_url" { value = module.stack.site_url }
output "site_bucket" { value = module.stack.site_bucket }
output "distribution_id" { value = module.stack.distribution_id }
output "api_url" { value = module.stack.api_url }
output "cognito_user_pool_id" { value = module.stack.cognito_user_pool_id }
output "cognito_client_id" { value = module.stack.cognito_client_id }
output "cognito_domain" { value = module.stack.cognito_domain }
output "dashboard_url" { value = module.stack.dashboard_url }
