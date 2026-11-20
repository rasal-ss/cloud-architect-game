# HTTP API Gateway + one Lambda per handler, each with its own least-privilege IAM role.

terraform {
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 5.80" }
    archive = { source = "hashicorp/archive", version = "~> 2.6" }
  }
}

variable "name" {
  type = string
}

variable "table_name" {
  type = string
}

variable "table_arn" {
  type = string
}

variable "jwt_issuer" {
  type = string
}

variable "jwt_audience" {
  type = list(string)
}

variable "allowed_origins" {
  type        = list(string)
  description = "Origins allowed by CORS (the CloudFront URL, plus localhost in dev)."
}

variable "dist_dir" {
  type        = string
  description = "Folder with the bundled handlers (services/api/dist)."
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "throttle_rate_limit" {
  type        = number
  description = "Steady-state requests per second across the API. Protects the bill from abuse."
  default     = 50
}

locals {
  # Each function only gets the DynamoDB actions it needs.
  functions = {
    progress = {
      actions = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem"]
      memory  = 512 # re-runs the simulation to verify scores
      timeout = 10
    }
    designs = {
      actions = ["dynamodb:GetItem", "dynamodb:PutItem"]
      memory  = 256
      timeout = 5
    }
    leaderboard = {
      actions = ["dynamodb:Query"]
      memory  = 256
      timeout = 5
    }
  }

  routes = {
    "GET /progress"              = { fn = "progress", auth = true }
    "PUT /progress/{levelId}"    = { fn = "progress", auth = true }
    "POST /designs"              = { fn = "designs", auth = true }
    "GET /designs/{id}"          = { fn = "designs", auth = false }
    "GET /leaderboard/{levelId}" = { fn = "leaderboard", auth = false }
    "GET /health"                = { fn = "leaderboard", auth = false }
  }
}

data "archive_file" "fn" {
  for_each    = local.functions
  type        = "zip"
  source_dir  = "${var.dist_dir}/${each.key}"
  output_path = "${path.module}/.build/${each.key}.zip"
}

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  for_each           = local.functions
  name               = "${var.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

data "aws_iam_policy_document" "fn" {
  for_each = local.functions
  statement {
    sid       = "Table"
    actions   = each.value.actions
    resources = [var.table_arn, "${var.table_arn}/index/*"]
  }
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.fn[each.key].arn}:*"]
  }
  statement {
    sid       = "Tracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "fn" {
  for_each = local.functions
  name     = "least-privilege"
  role     = aws_iam_role.fn[each.key].id
  policy   = data.aws_iam_policy_document.fn[each.key].json
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${var.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "fn" {
  for_each         = local.functions
  function_name    = "${var.name}-${each.key}"
  role             = aws_iam_role.fn[each.key].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"] # Graviton: cheaper per ms
  handler          = "index.handler"
  filename         = data.archive_file.fn[each.key].output_path
  source_code_hash = data.archive_file.fn[each.key].output_base64sha256
  memory_size      = each.value.memory
  timeout          = each.value.timeout

  environment {
    variables = {
      TABLE_NAME   = var.table_name
      NODE_OPTIONS = "--enable-source-maps"
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy.fn]
}

resource "aws_apigatewayv2_api" "http" {
  name          = var.name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "PUT", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.jwt_issuer
    audience = var.jwt_audience
  }
}

resource "aws_apigatewayv2_integration" "fn" {
  for_each               = local.functions
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.fn[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "route" {
  for_each           = local.routes
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.fn[each.value.fn].id}"
  authorization_type = each.value.auth ? "JWT" : "NONE"
  authorizer_id      = each.value.auth ? aws_apigatewayv2_authorizer.jwt.id : null
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.throttle_rate_limit
    throttling_burst_limit = var.throttle_rate_limit * 2
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId = "$context.requestId"
      routeKey  = "$context.routeKey"
      status    = "$context.status"
      latencyMs = "$context.responseLatency"
      ip        = "$context.identity.sourceIp"
    })
  }
}

resource "aws_lambda_permission" "apigw" {
  for_each      = local.functions
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "api_url" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "api_id" {
  value = aws_apigatewayv2_api.http.id
}

output "function_names" {
  value = { for k, f in aws_lambda_function.fn : k => f.function_name }
}
