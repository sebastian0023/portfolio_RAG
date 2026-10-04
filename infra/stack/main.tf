provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Application = "portfolio-v2"
      Environment = var.env
      CostScope   = "portfolio-v2-${var.env}"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix = "portfolio-v2-${var.env}"
  account_id  = data.aws_caller_identity.current.account_id
}

module "ssm" {
  source = "../modules/ssm"
}

module "budgets" {
  source = "../modules/budgets"

  name_prefix           = local.name_prefix
  account_id            = local.account_id
  alert_email           = var.alert_email
  operator_role_arn     = "arn:aws:iam::${local.account_id}:role/${local.name_prefix}-operator"
  bedrock_service_names = var.bedrock_service_names
}

module "web" {
  source = "../modules/web"

  name_prefix = local.name_prefix
  account_id  = local.account_id
}

module "edge" {
  source = "../modules/edge"

  name_prefix                     = local.name_prefix
  web_bucket_id                   = module.web.bucket_id
  web_bucket_arn                  = module.web.bucket_arn
  web_bucket_regional_domain_name = module.web.bucket_regional_domain_name
}
