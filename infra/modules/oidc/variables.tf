variable "name_prefix" {
  description = "Resource name prefix, for example portfolio-v2-prod."
  type        = string
}

variable "github_owner" {
  type = string
}

variable "github_repository" {
  type = string
}

variable "github_owner_id" {
  type = string
}

variable "github_repository_id" {
  type = string
}

variable "state_bucket_arn" {
  description = "Remote state bucket the plan role may read."
  type        = string
}

variable "account_id" {
  description = "AWS account id, used to scope ARNs in the plan policy."
  type        = string
}
