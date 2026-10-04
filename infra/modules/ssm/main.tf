# SSM parameters are described once in parameters.json, which tests/contracts/ssm-parameters.test.ts
# keeps in step with the runtime schema. Configuration values live here; secrets are provisioned by name only
# (a SecureString holding a placeholder) and their real values never enter Terraform (ADR-023, R-18).
locals {
  manifest = jsondecode(file("${path.module}/parameters.json"))

  encoded = {
    for name, p in local.manifest.parameters :
    name => p.format == "json" ? jsonencode(p.default) : tostring(p.default)
  }

  operator_managed  = { for name, p in local.manifest.parameters : name => p if p.managed == "operator" }
  terraform_managed = { for name, p in local.manifest.parameters : name => p if p.managed == "terraform" }
}

# Operators change these at runtime (chat switch, index promotion, model swap). Terraform creates them
# with safe defaults and then leaves the live value alone, so an apply never undoes a runbook action.
resource "aws_ssm_parameter" "operator" {
  #checkov:skip=CKV2_AWS_34:Non-secret configuration; the secrets are SecureStrings (ADR-023).
  for_each = local.operator_managed

  name        = "${local.manifest.prefix}/${each.key}"
  description = each.value.description
  type        = "String"
  tier        = "Standard"
  value       = local.encoded[each.key]

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "managed" {
  #checkov:skip=CKV2_AWS_34:Non-secret configuration; the secrets are SecureStrings (ADR-023).
  for_each = local.terraform_managed

  name        = "${local.manifest.prefix}/${each.key}"
  description = each.value.description
  type        = "String"
  tier        = "Standard"
  value       = local.encoded[each.key]
}

# Secrets are created with a placeholder and then left alone: the owner sets the real value with
# `aws ssm put-parameter --overwrite`, so it never lands in this module's state or in a plan (R-18). The API
# refuses to run while a secret still holds the placeholder.
resource "aws_ssm_parameter" "secret" {
  #checkov:skip=CKV_AWS_337:ADR-023 uses the AWS-managed SSM key, not a customer KMS key.
  for_each = local.manifest.secrets

  name        = "${local.manifest.prefix}/${each.key}"
  description = each.value.description
  type        = "SecureString"
  tier        = "Standard"
  value       = "unset"

  lifecycle {
    ignore_changes = [value]
  }
}
