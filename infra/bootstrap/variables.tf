variable "region" {
  description = "AWS region for every resource (O-01)."
  type        = string
  default     = "us-east-1"
}

variable "env" {
  description = "Environment name used in resource names. One stack exists, so this is always prod (ADR-032)."
  type        = string
  default     = "prod"

  validation {
    condition     = var.env == "prod"
    error_message = "Only the prod environment is instantiated (ADR-032)."
  }
}

variable "github_owner" {
  description = "GitHub account that owns the repository."
  type        = string
  default     = "sebastian0023"
}

variable "github_repository" {
  description = "GitHub repository name."
  type        = string
  default     = "portfolio_RAG"
}

# Public GitHub identifiers. They bind the trust policy to this exact repository even if it is renamed or recreated.
variable "github_owner_id" {
  description = "Numeric GitHub owner id (repository_owner_id claim)."
  type        = string
  default     = "130592260"
}

variable "github_repository_id" {
  description = "Numeric GitHub repository id (repository_id claim)."
  type        = string
  default     = "1403806459"
}
