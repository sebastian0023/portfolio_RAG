# Counter table for the pre-auth rate limits and the temporary daily cap (ADR-017). Phase 4 adds the per-user
# quota keys to the same table. The window is part of every key; TTL only removes expired items.
resource "aws_dynamodb_table" "counters" {
  name         = "${var.name_prefix}-counters"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  #checkov:skip=CKV_AWS_119:ADR-023 uses AWS-owned encryption, not customer KMS keys.
  #checkov:skip=CKV_AWS_28:Counters live for one window; point-in-time recovery would restore stale counts.

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  deletion_protection_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}
