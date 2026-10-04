locals {
  function_name = "${var.name_prefix}-api"
  alias_name    = "live"
}

data "archive_file" "bundle" {
  type             = "zip"
  source_file      = var.bundle_path
  output_path      = "${path.root}/.build/api.zip"
  output_file_mode = "0644"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = 14

  #checkov:skip=CKV_AWS_158:ADR-023 uses service-managed encryption, not customer KMS keys.
  #checkov:skip=CKV_AWS_338:14-day retention is deliberate (ADR-028); a year of metadata-only logs is not wanted.
}

# The profile is read so the model permission can name the exact profile and the models it routes to.
data "aws_bedrock_inference_profile" "model" {
  inference_profile_id = var.inference_profile_id
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = local.function_name
  description        = "Execution role of the portfolio-v2 API function."
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

# An inline policy replaces AWSLambdaBasicExecutionRole, which allows CreateLogGroup on every resource.
data "aws_iam_policy_document" "api" {
  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }

  statement {
    sid       = "ReadConfiguration"
    actions   = ["ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.region}:${var.account_id}:parameter${var.parameter_prefix}/*"]
  }

  statement {
    sid       = "UseCounters"
    actions   = ["dynamodb:UpdateItem", "dynamodb:GetItem"]
    resources = [var.counters_table_arn]
  }

  statement {
    sid       = "InvokeProfile"
    actions   = ["bedrock:InvokeModelWithResponseStream"]
    resources = [data.aws_bedrock_inference_profile.model.inference_profile_arn]
  }

  # A system profile routes to foundation models in several regions; each is allowed only through this profile.
  statement {
    sid       = "InvokeRoutedModels"
    actions   = ["bedrock:InvokeModelWithResponseStream"]
    resources = [for model in data.aws_bedrock_inference_profile.model.models : model.model_arn]

    condition {
      test     = "StringEquals"
      variable = "bedrock:InferenceProfileArn"
      values   = [data.aws_bedrock_inference_profile.model.inference_profile_arn]
    }
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "${local.function_name}-runtime"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_lambda_function" "api" {
  function_name = local.function_name
  description   = "Streaming chat API behind CloudFront (ADR-004)."
  role          = aws_iam_role.api.arn
  runtime       = "nodejs24.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 512
  # The application deadline is timeout_seconds; the margin lets it send a final event before Lambda stops it.
  timeout                        = var.timeout_seconds + 5
  reserved_concurrent_executions = var.reserved_concurrency
  publish                        = true

  filename         = data.archive_file.bundle.output_path
  source_code_hash = filebase64sha256(var.bundle_path)

  #checkov:skip=CKV_AWS_50:X-Ray tracing is a Phase 7 observability decision.
  #checkov:skip=CKV_AWS_116:The function is invoked synchronously; a dead letter queue never receives its failures.
  #checkov:skip=CKV_AWS_117:No VPC resources are reachable or needed; the function only calls regional AWS APIs.
  #checkov:skip=CKV_AWS_173:Environment variables hold names and flags, never secrets (ADR-023).
  #checkov:skip=CKV_AWS_272:Code signing is a Phase 7 supply-chain decision.

  environment {
    variables = {
      APP_ENV          = "production"
      PARAMETER_PREFIX = var.parameter_prefix
      COUNTERS_TABLE   = var.counters_table_name
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.api.name
  }

  depends_on = [aws_iam_role_policy.api]
}

resource "aws_lambda_alias" "live" {
  name             = local.alias_name
  function_name    = aws_lambda_function.api.function_name
  function_version = aws_lambda_function.api.version
}

# Rollback is an alias change (ADR-035). The URL is on the alias, so CloudFront always reaches the live version.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  qualifier          = aws_lambda_alias.live.name
  authorization_type = "AWS_IAM"
  invoke_mode        = "RESPONSE_STREAM"

  #checkov:skip=CKV_AWS_258:AWS_IAM authorization is set; only the CloudFront OAC principal may call the URL.
}
