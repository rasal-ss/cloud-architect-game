# CloudWatch alarms, a dashboard, and a monthly budget alert.
# The game practises what it teaches: no monitoring means customers notice first.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.80" }
  }
}

variable "name" {
  type = string
}

variable "alert_email" {
  type        = string
  description = "Where alarms and budget alerts go. Leave empty to create the topic without a subscription."
  default     = ""
}

variable "monthly_budget_usd" {
  type        = number
  description = "Monthly AWS cost budget for this environment."
}

variable "api_id" {
  type = string
}

variable "function_names" {
  type = map(string)
}

variable "table_name" {
  type = string
}

data "aws_region" "current" {}

resource "aws_sns_topic" "alerts" {
  name              = "${var.name}-alerts"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = var.function_names
  alarm_name          = "${each.value}-errors"
  alarm_description   = "Lambda ${each.key} is throwing errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name}-api-5xx"
  alarm_description   = "The API is returning server errors."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = var.api_id }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_latency" {
  alarm_name          = "${var.name}-api-p95-latency"
  alarm_description   = "API p95 latency is above 1 second."
  namespace           = "AWS/ApiGateway"
  metric_name         = "Latency"
  dimensions          = { ApiId = var.api_id }
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 1000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "dynamodb_throttles" {
  alarm_name          = "${var.name}-dynamodb-throttles"
  alarm_description   = "DynamoDB is throttling requests (hot partition?)."
  namespace           = "AWS/DynamoDB"
  metric_name         = "ThrottledRequests"
  dimensions          = { TableName = var.table_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = var.name
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title  = "API requests and errors"
          region = data.aws_region.current.name
          stat   = "Sum"
          period = 300
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", var.api_id],
            [".", "4xx", ".", "."],
            [".", "5xx", ".", "."],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title   = "API latency p50 / p95 / p99"
          region  = data.aws_region.current.name
          period  = 300
          metrics = [for s in ["p50", "p95", "p99"] : ["AWS/ApiGateway", "Latency", "ApiId", var.api_id, { stat = s }]]
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 12, height = 6
        properties = {
          title   = "Lambda duration p95"
          region  = data.aws_region.current.name
          period  = 300
          metrics = [for k, f in var.function_names : ["AWS/Lambda", "Duration", "FunctionName", f, { stat = "p95", label = k }]]
        }
      },
      {
        type = "metric", x = 12, y = 6, width = 12, height = 6
        properties = {
          title  = "DynamoDB capacity consumed"
          region = data.aws_region.current.name
          stat   = "Sum"
          period = 300
          metrics = [
            ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", var.table_name],
            [".", "ConsumedWriteCapacityUnits", ".", "."],
          ]
        }
      },
    ]
  })
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Counts only resources tagged Stack=<name>. Activate "Stack" as a cost allocation tag
  # in the Billing console once, or remove this filter to budget the whole account.
  cost_filter {
    name   = "TagKeyValue"
    values = [format("user:Stack$%s", var.name)]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "FORECASTED"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }
}

# AWS Budgets needs permission to publish to the encrypted topic.
data "aws_iam_policy_document" "alerts" {
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com", "cloudwatch.amazonaws.com"]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts.json
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "dashboard_url" {
  value = "https://console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.name}#dashboards:name=${var.name}"
}
