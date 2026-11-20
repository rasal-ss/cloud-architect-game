# One-time setup, applied by hand with an admin profile (local state):
#   - an S3 bucket for Terraform remote state (versioned, encrypted, private)
#   - the GitHub Actions OIDC identity provider
#   - IAM roles that GitHub Actions assumes with short-lived credentials (no access keys):
#       <name>-plan        read-only, for terraform plan on pull requests
#       <name>-deploy-dev  deploys the dev environment from main
#       <name>-deploy-prod deploys prod, only from the "prod" GitHub environment (manual approval)

terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.80" }
  }
}

variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "name" {
  type    = string
  default = "cloud-architect"
}

variable "github_repository" {
  type        = string
  description = "owner/repo that may assume the roles, e.g. your-user/cloud-architect-game."
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "cloud-architect-game", ManagedBy = "terraform", Stack = "${var.name}-bootstrap" }
  }
}

data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# Remote state
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "state" {
  bucket = "${var.name}-tfstate-${data.aws_caller_identity.current.account_id}"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# ---------------------------------------------------------------------------
# GitHub Actions OIDC
# ---------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates GitHub's certificate itself; the thumbprint is kept for older tooling.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  repo = "repo:${var.github_repository}"
  roles = {
    plan = {
      subjects = ["${local.repo}:pull_request", "${local.repo}:ref:refs/heads/main"]
      deploy   = false
    }
    deploy-dev = {
      subjects = ["${local.repo}:environment:dev"]
      deploy   = true
    }
    deploy-prod = {
      subjects = ["${local.repo}:environment:prod"]
      deploy   = true
    }
  }
}

data "aws_iam_policy_document" "trust" {
  for_each = local.roles
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = each.value.subjects
    }
  }
}

resource "aws_iam_role" "github" {
  for_each             = local.roles
  name                 = "${var.name}-${each.key}"
  assume_role_policy   = data.aws_iam_policy_document.trust[each.key].json
  max_session_duration = 3600
}

# Every role can read and write Terraform state and its lock file.
data "aws_iam_policy_document" "state" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/cloud-architect/*"]
  }
}

resource "aws_iam_role_policy" "state" {
  for_each = local.roles
  name     = "terraform-state"
  role     = aws_iam_role.github[each.key].id
  policy   = data.aws_iam_policy_document.state.json
}

resource "aws_iam_role_policy_attachment" "read_only" {
  role       = aws_iam_role.github["plan"].name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# Deploy roles manage only the services the stack uses. IAM is limited to the stack's own roles.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid = "StackServices"
    actions = [
      "s3:*", "cloudfront:*", "apigateway:*", "lambda:*", "dynamodb:*", "cognito-idp:*",
      "logs:*", "cloudwatch:*", "sns:*", "budgets:*", "xray:*", "kms:DescribeKey",
    ]
    resources = ["*"]
  }
  statement {
    sid = "OwnRolesOnly"
    actions = [
      "iam:GetRole", "iam:CreateRole", "iam:DeleteRole", "iam:UpdateRole", "iam:TagRole", "iam:UntagRole",
      "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole", "iam:UpdateAssumeRolePolicy",
      "iam:PassRole",
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-*"]
  }
  statement {
    sid       = "ReadIdentity"
    actions   = ["sts:GetCallerIdentity", "iam:ListRoles"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  for_each = { for k, v in local.roles : k => v if v.deploy }
  name     = "deploy-stack"
  role     = aws_iam_role.github[each.key].id
  policy   = data.aws_iam_policy_document.deploy.json
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "role_arns" {
  value = { for k, r in aws_iam_role.github : k => r.arn }
}
