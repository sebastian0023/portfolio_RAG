# Throwaway spike for P1-10 / R-04: can CloudFront reach a streaming Lambda Function URL through OAC,
# with a custom auth header, and is the origin unreachable any other way? Applied, probed, then destroyed.
# Checkov skips below apply to this short-lived root only; the production edge module (Phase 3) must
# address them (WAF decision is ADR-029, logging and response headers are Phase 3 and 7 work).
provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Application = "portfolio-v2"
      Environment = "prod"
      CostScope   = "portfolio-v2-prod"
      ManagedBy   = "terraform"
      Purpose     = "spike-oac-stream"
    }
  }
}

locals {
  prefix = "portfolio-v2-prod-spike"
}

data "archive_file" "handler" {
  type        = "zip"
  source_file = "${path.module}/handler.mjs"
  output_path = "${path.module}/handler.zip"
}

resource "aws_cloudwatch_log_group" "fn" {
  #checkov:skip=CKV_AWS_158:Service-managed encryption only (ADR-023); the spike logs no request data.
  #checkov:skip=CKV_AWS_338:14-day retention is deliberate (ADR-028); the spike is deleted within hours.
  name              = "/aws/lambda/${local.prefix}-stream"
  retention_in_days = 14
}

data "aws_iam_policy_document" "fn_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  name               = "${local.prefix}-stream"
  assume_role_policy = data.aws_iam_policy_document.fn_trust.json
}

resource "aws_iam_role_policy_attachment" "fn_logs" {
  role       = aws_iam_role.fn.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "stream" {
  #checkov:skip=CKV_AWS_50:No X-Ray tracing for a throwaway spike.
  #checkov:skip=CKV_AWS_116:No dead-letter queue: synchronous HTTP handler, no async invocation (ADR-030).
  #checkov:skip=CKV_AWS_117:No VPC: the function calls no private resources.
  #checkov:skip=CKV_AWS_115:Concurrency is capped by the account; the spike is short-lived.
  #checkov:skip=CKV_AWS_173:No environment variables are set.
  #checkov:skip=CKV_AWS_272:Code signing is out of scope for a throwaway spike.
  function_name    = "${local.prefix}-stream"
  role             = aws_iam_role.fn.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "handler.handler"
  filename         = data.archive_file.handler.output_path
  source_code_hash = data.archive_file.handler.output_base64sha256
  timeout          = 10
  memory_size      = 128

  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy_attachment.fn_logs]
}

resource "aws_lambda_function_url" "stream" {
  #checkov:skip=CKV_AWS_258:AWS_IAM is set; this check misreads the OAC-only setup.
  function_name      = aws_lambda_function.stream.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "RESPONSE_STREAM"
}

resource "aws_cloudfront_origin_access_control" "fn" {
  name                              = "${local.prefix}-oac"
  description                       = "Always-sign OAC for the streaming Lambda spike."
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

resource "aws_cloudfront_origin_request_policy" "forward" {
  name = "${local.prefix}-forward-auth-and-hash"

  headers_config {
    header_behavior = "whitelist"

    headers {
      items = ["X-Auth-Token", "x-amz-content-sha256"]
    }
  }

  cookies_config {
    cookie_behavior = "none"
  }

  query_strings_config {
    query_string_behavior = "none"
  }
}

resource "aws_cloudfront_distribution" "spike" {
  #checkov:skip=CKV_AWS_68:WAF is deferred to the Phase 7 decision (ADR-029).
  #checkov:skip=CKV2_AWS_47:Same as above.
  #checkov:skip=CKV_AWS_86:Access logging is a Phase 3 and 7 decision; the spike stores no logs.
  #checkov:skip=CKV_AWS_310:Single origin by design.
  #checkov:skip=CKV_AWS_374:No geo restriction for a throwaway spike.
  #checkov:skip=CKV2_AWS_32:Response headers policy belongs to the Phase 3 edge module.
  #checkov:skip=CKV2_AWS_42:No custom domain or certificate until Phase 7; the spike uses the default CloudFront certificate.
  #checkov:skip=CKV_AWS_305:No default root object: the spike only serves API-style paths.
  #checkov:skip=CKV_AWS_174:The default CloudFront certificate cannot set a minimum TLS version; the edge module will use a custom domain.
  comment             = "${local.prefix}-oac-stream"
  enabled             = true
  is_ipv6_enabled     = true
  price_class         = "PriceClass_100"
  wait_for_deployment = true

  origin {
    origin_id                = "lambda"
    domain_name              = trimsuffix(trimprefix(aws_lambda_function_url.stream.function_url, "https://"), "/")
    origin_access_control_id = aws_cloudfront_origin_access_control.fn.id

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    target_origin_id         = "lambda"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.forward.id
    compress                 = false
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# CloudFront needs both permissions to reach an OAC-protected function URL.
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id           = "AllowCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.stream.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.spike.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id  = "AllowCloudFrontInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.stream.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.spike.arn
}
