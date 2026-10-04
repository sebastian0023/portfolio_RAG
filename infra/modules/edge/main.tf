locals {
  s3_origin_id = "web"

  # AWS managed cache policy ids. Constants avoid a ListCachePolicies read for the plan role.
  caching_optimized_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
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
