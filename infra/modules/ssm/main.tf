# SSM parameters are described once in parameters.json, which tests/contracts/ssm-parameters.test.ts
# keeps in step with the runtime schema. Only non-secret configuration lives here: the Turnstile
# secret is a SecureString whose name is provisioned in Phase 4 and whose value never enters Terraform (ADR-023, R-18).
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
  #checkov:skip=CKV2_AWS_34:Non-secret configuration. Only the Turnstile secret is a SecureString (ADR-023).
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
  #checkov:skip=CKV2_AWS_34:Non-secret configuration. Only the Turnstile secret is a SecureString (ADR-023).
  for_each = local.terraform_managed

  name        = "${local.manifest.prefix}/${each.key}"
  description = each.value.description
  type        = "String"
  tier        = "Standard"
  value       = local.encoded[each.key]
}
