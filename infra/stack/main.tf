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

  # The API role is a kill-switch target (kill-switch.md). Referencing the module output orders its creation first.
  additional_kill_target_roles = [module.api.role_name]
}

module "web" {
  source = "../modules/web"

  name_prefix = local.name_prefix
  account_id  = local.account_id
}

module "storage" {
  source = "../modules/storage"

  name_prefix = local.name_prefix
}

module "api" {
  source = "../modules/api"

  name_prefix         = local.name_prefix
  account_id          = local.account_id
  region              = var.region
  bundle_path         = "${path.root}/../../apps/api/dist/lambda/index.mjs"
  timeout_seconds     = jsondecode(file("${path.root}/../modules/ssm/parameters.json")).parameters.limits.default.timeoutSeconds
  parameter_prefix    = "/portfolio-v2/${var.env}"
  counters_table_name = module.storage.counters_table_name
  counters_table_arn  = module.storage.counters_table_arn
}

module "edge" {
  source = "../modules/edge"

  name_prefix                     = local.name_prefix
  web_bucket_id                   = module.web.bucket_id
  web_bucket_arn                  = module.web.bucket_arn
  web_bucket_regional_domain_name = module.web.bucket_regional_domain_name
  lambda_function_name            = module.api.function_name
  lambda_alias_name               = module.api.alias_name
  lambda_function_url             = module.api.function_url
}
