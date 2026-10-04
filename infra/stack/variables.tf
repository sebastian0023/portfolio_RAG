variable "region" {
  type    = string
  default = "us-east-1"
}

variable "env" {
  description = "Always prod: one stack exists (ADR-032)."
  type        = string
  default     = "prod"

  validation {
    condition     = var.env == "prod"
    error_message = "Only the prod environment is instantiated (ADR-032)."
  }
}

variable "alert_email" {
  description = "Budget owner address. Set in gitignored terraform.tfvars locally and TF_VAR_alert_email in CI."
  type        = string
}

variable "bedrock_service_names" {
  description = "Billing service names that carry model charges. Haiku bills under its own name, not under Amazon Bedrock. Gemma's name is unknown until billed usage appears (P6-03)."
  type        = list(string)
  default = [
    "Amazon Bedrock",
    "Amazon Bedrock Service",
    "Claude Haiku 4.5 (Amazon Bedrock Edition)",
  ]
}
