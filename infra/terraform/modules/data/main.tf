# Single DynamoDB table for players, progress, shared designs and leaderboards.
# See services/api/src/repository.ts for the key design and access patterns.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.80" }
  }
}

variable "name" {
  type        = string
  description = "Table name."
}

variable "deletion_protection" {
  type        = bool
  description = "Block accidental table deletion (on in prod)."
  default     = false
}

resource "aws_dynamodb_table" "game" {
  name                        = var.name
  billing_mode                = "PAY_PER_REQUEST" # scales to zero cost when nobody is playing
  hash_key                    = "PK"
  range_key                   = "SK"
  deletion_protection_enabled = var.deletion_protection

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  # Inverted index: list a player's shared designs, newest first.
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "KEYS_ONLY"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

output "table_name" {
  value = aws_dynamodb_table.game.name
}

output "table_arn" {
  value = aws_dynamodb_table.game.arn
}
