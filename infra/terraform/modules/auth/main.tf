# Cognito user pool for optional sign-in. The game is fully playable as a guest;
# signing in only adds cloud saves and leaderboards.

terraform {
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.80" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

variable "name" {
  type = string
}

variable "callback_urls" {
  type        = list(string)
  description = "Allowed redirect URLs after sign-in (the site URL, plus localhost in dev)."
}

variable "google_client_id" {
  type        = string
  description = "Google OAuth client id. Leave empty to disable Google sign-in."
  default     = ""
}

variable "google_client_secret" {
  type        = string
  description = "Google OAuth client secret. Pass via TF_VAR_google_client_secret, never commit it."
  default     = ""
  sensitive   = true
}

locals {
  google_enabled = var.google_client_id != ""
}

resource "aws_cognito_user_pool" "players" {
  name                     = "${var.name}-players"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OPTIONAL"
  deletion_protection      = "INACTIVE"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 3
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  schema {
    name                = "preferred_username"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 1
      max_length = 24
    }
  }
}

resource "aws_cognito_identity_provider" "google" {
  count         = local.google_enabled ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.players.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email              = "email"
    preferred_username = "given_name"
    username           = "sub"
  }
}

resource "random_id" "domain" {
  byte_length = 4
}

resource "aws_cognito_user_pool_domain" "players" {
  domain       = "${var.name}-${random_id.domain.hex}"
  user_pool_id = aws_cognito_user_pool.players.id
}

# Public browser client: authorization code flow with PKCE, no client secret.
resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${var.name}-web"
  user_pool_id                         = aws_cognito_user_pool.players.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.callback_urls
  supported_identity_providers         = concat(["COGNITO"], local.google_enabled ? ["Google"] : [])
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 1
  id_token_validity                    = 1
  refresh_token_validity               = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  depends_on = [aws_cognito_identity_provider.google]
}

data "aws_region" "current" {}

output "user_pool_id" {
  value = aws_cognito_user_pool.players.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "issuer" {
  value = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.players.id}"
}

output "hosted_ui_domain" {
  value = "${aws_cognito_user_pool_domain.players.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}
