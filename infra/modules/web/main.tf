# Private bucket for the built Angular SPA. Only CloudFront reads it, through OAC; the bucket policy lives in the
# edge module so modules never reference each other (ADR-006). Objects are uploaded by infra/scripts/deploy-web.ts.
resource "aws_s3_bucket" "web" {
  bucket = "${var.name_prefix}-web-${var.account_id}"

  #checkov:skip=CKV_AWS_144:The SPA is rebuilt from source; cross-region replication adds cost without recovery value.
  #checkov:skip=CKV_AWS_145:ADR-023 uses service-managed encryption, not customer KMS keys.
  #checkov:skip=CKV_AWS_18:Access logging would need a second bucket; CloudFront logging is a Phase 7 decision.
  #checkov:skip=CKV2_AWS_62:No consumers need bucket event notifications.

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.web]
}
