variable "name_prefix" {
  description = "Resource name prefix, portfolio-v2-<env> (ADR-047)."
  type        = string
}

variable "account_id" {
  description = "AWS account id, used as the globally unique bucket name suffix."
  type        = string
}
