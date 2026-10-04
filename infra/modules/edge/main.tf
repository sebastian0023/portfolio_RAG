locals {
  s3_origin_id = "web"

  # AWS managed cache policy ids. Constants avoid a ListCachePolicies read for the plan role.
  caching_optimized_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  caching_disabled_policy_id  = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

  api_origin_id     = "api"
  api_origin_domain = trimsuffix(trimprefix(var.lambda_function_url, "https://"), "/")
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name_prefix}-web"
  description                       = "OAC for the private SPA bucket."
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Baseline security headers. The Content-Security-Policy is added with the web transport (P3-06).
resource "aws_cloudfront_response_headers_policy" "spa" {
  name    = "${var.name_prefix}-spa"
  comment = "Baseline security headers for the SPA."

  #checkov:skip=CKV_AWS_259:HSTS preload is irreversible once submitted and the default cloudfront.net domain is not eligible; revisit with the custom domain in Phase 7.

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      preload                    = false
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

resource "aws_cloudfront_origin_access_control" "api" {
  name                              = "${var.name_prefix}-api"
  description                       = "OAC that signs requests to the API Function URL."
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# x-amz-content-sha256 is deliberately absent: CloudFront rejects it in an origin request policy, and the
# viewer must send it anyway so CloudFront can sign the POST body (oac-spike.md).
resource "aws_cloudfront_origin_request_policy" "api" {
  name    = "${var.name_prefix}-api-origin"
  comment = "Forwards the content type, the app auth token, and the trusted viewer address."

  cookies_config {
    cookie_behavior = "none"
  }

  query_strings_config {
    query_string_behavior = "none"
  }

  headers_config {
    header_behavior = "whitelist"

    headers {
      items = ["Content-Type", "X-Auth-Token", "CloudFront-Viewer-Address"]
    }
  }
}

resource "aws_cloudfront_distribution" "edge" {
  comment             = "${var.name_prefix}-edge"
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  price_class         = "PriceClass_100"
  default_root_object = "index.html"

  #checkov:skip=CKV_AWS_68:No WAF in v1 (ADR-029); revisited in Phase 7.
  #checkov:skip=CKV2_AWS_47:No WAF in v1 (ADR-029), so there is no Log4j rule to attach.
  #checkov:skip=CKV_AWS_86:Access logging would store viewer IPs (ADR-028); it is a Phase 7 decision.
  #checkov:skip=CKV_AWS_310:A single private bucket origin has nothing to fail over to.
  #checkov:skip=CKV_AWS_374:No geo restriction; the portfolio is public worldwide.
  #checkov:skip=CKV2_AWS_42:The default CloudFront certificate is used until the custom domain in Phase 7.
  #checkov:skip=CKV_AWS_174:The default certificate fixes the minimum TLS version; a custom domain comes in Phase 7.
  #checkov:skip=CKV_AWS_305:default_root_object is set; there is no SPA fallback mapping on purpose (ADR-013).

  # No custom_error_response: it applies distribution-wide and would hide API failures (ADR-013).

  origin {
    domain_name              = var.web_bucket_regional_domain_name
    origin_id                = local.s3_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id           = local.s3_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.caching_optimized_policy_id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.spa.id
  }

  origin {
    domain_name              = local.api_origin_domain
    origin_id                = local.api_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.api.id

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  # compress is off so the SSE stream is never buffered for compression.
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = local.api_origin_id
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = false
    cache_policy_id          = local.caching_disabled_policy_id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
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

data "aws_iam_policy_document" "web_bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${var.web_bucket_arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.edge.arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [var.web_bucket_arn, "${var.web_bucket_arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = var.web_bucket_id
  policy = data.aws_iam_policy_document.web_bucket.json
}

# Both permissions are required for a Function URL behind OAC: AWS ends its InvokeFunctionUrl-only exception on
# 2026-11-01. Each is limited to this distribution and to the live alias.
resource "aws_lambda_permission" "invoke_url" {
  statement_id           = "AllowCloudFrontInvokeUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = var.lambda_function_name
  qualifier              = var.lambda_alias_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.edge.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "invoke_function" {
  statement_id             = "AllowCloudFrontInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = var.lambda_function_name
  qualifier                = var.lambda_alias_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.edge.arn
  invoked_via_function_url = true
}
