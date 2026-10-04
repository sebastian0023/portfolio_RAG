provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Application = "portfolio-v2"
      Environment = var.env
      CostScope   = "portfolio-v2-${var.env}"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix       = "portfolio-v2-${var.env}"
  state_bucket_name = "${local.name_prefix}-tfstate-${data.aws_caller_identity.current.account_id}"
}

# Remote state for every root in this repository (ADR-007). Locking uses the native S3 lockfile, so there is no DynamoDB lock table.
resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket_name

  #checkov:skip=CKV_AWS_144:State is single-region by design; versioning provides recovery.
  #checkov:skip=CKV_AWS_145:ADR-023 uses service-managed encryption, not customer KMS keys.
  #checkov:skip=CKV_AWS_18:Access logging would need a second bucket; CloudTrail data events are a Phase 7 decision.
  #checkov:skip=CKV2_AWS_62:No consumers need bucket event notifications.

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
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
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "retain-recent-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 365
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "state_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]

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

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.state]
}

module "oidc" {
  source = "../modules/oidc"

  name_prefix          = local.name_prefix
  github_owner         = var.github_owner
  github_repository    = var.github_repository
  github_owner_id      = var.github_owner_id
  github_repository_id = var.github_repository_id
  state_bucket_arn     = aws_s3_bucket.state.arn
  account_id           = data.aws_caller_identity.current.account_id
}
