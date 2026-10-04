variable "name_prefix" {
  description = "Resource name prefix, portfolio-v2-<env> (ADR-047)."
  type        = string
}

variable "web_bucket_id" {
  description = "Private SPA bucket that CloudFront reads through OAC."
  type        = string
}

variable "web_bucket_arn" {
  description = "ARN of the SPA bucket."
  type        = string
}

variable "web_bucket_regional_domain_name" {
  description = "Regional domain name used as the S3 origin."
  type        = string
}

variable "lambda_function_name" {
  description = "API function that serves /api/*."
  type        = string
}

variable "lambda_alias_name" {
  description = "Alias that CloudFront is allowed to invoke."
  type        = string
}

variable "lambda_function_url" {
  description = "Function URL of the alias (qualifier on the live alias)."
  type        = string
}
