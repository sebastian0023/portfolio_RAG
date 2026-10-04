variable "name_prefix" {
  description = "Resource name prefix, for example portfolio-v2-prod."
  type        = string
}

variable "account_id" {
  type = string
}

variable "alert_email" {
  description = "Budget owner address for alerts and action notices. Supplied through gitignored tfvars or a CI variable, never committed."
  type        = string
}

variable "operator_role_arn" {
  description = "Role allowed to assume the kill-switch probe role."
  type        = string
}

variable "bedrock_budget_usd" {
  description = "Monthly limit across Bedrock service charges. Deliberately counts other projects' model spend too (ADR-047)."
  type        = number
  default     = 10
}

variable "scope_budget_usd" {
  description = "Monthly limit across everything tagged CostScope=portfolio-v2-prod."
  type        = number
  default     = 5
}

variable "bedrock_service_names" {
  description = "Cost Explorer service names that carry model charges (third-party models bill under their own names)."
  type        = list(string)
}

variable "cost_scope_tag" {
  description = "Cost-allocation tag value for this stack."
  type        = string
  default     = "portfolio-v2-prod"
}
