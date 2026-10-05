variable "name_prefix" {
  description = "Resource name prefix, portfolio-v2-<env> (ADR-047)."
  type        = string
}

variable "account_id" {
  description = "AWS account id, used to scope IAM resources."
  type        = string
}

variable "region" {
  description = "Region of the vector bucket and the embedding model."
  type        = string
}

variable "operator_role_arn" {
  description = "The MFA-gated operator role. It is the only principal allowed to assume the ingest and eval roles."
  type        = string
}

variable "parameter_prefix" {
  description = "SSM parameter path prefix, for example /portfolio-v2/prod."
  type        = string
}

variable "inference_profile_id" {
  description = "System inference profile the eval role may call, the same one the API calls."
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}
