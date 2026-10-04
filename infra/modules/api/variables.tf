variable "name_prefix" {
  description = "Resource name prefix, portfolio-v2-<env> (ADR-047)."
  type        = string
}

variable "account_id" {
  description = "AWS account id, used to scope IAM resources."
  type        = string
}

variable "region" {
  description = "Region of the function, parameters, and model profile."
  type        = string
}

variable "bundle_path" {
  description = "Built Lambda bundle (apps/api/dist/lambda/index.mjs). It must exist at plan time."
  type        = string
}

variable "timeout_seconds" {
  description = "Model deadline from the limits parameter; the function timeout adds a margin."
  type        = number
}

variable "parameter_prefix" {
  description = "SSM parameter path prefix the function may read."
  type        = string
}

variable "counters_table_name" {
  description = "DynamoDB table holding rate and quota counters."
  type        = string
}

variable "counters_table_arn" {
  description = "ARN of the counters table."
  type        = string
}

variable "inference_profile_id" {
  description = "System inference profile the model adapter calls."
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "reserved_concurrency" {
  description = "Reserved concurrency that caps spend and protects shared account concurrency (ADR-024)."
  type        = number
  default     = 5
}
