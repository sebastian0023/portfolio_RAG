output "parameter_names" {
  value = module.ssm.parameter_names
}

output "deny_policy_arn" {
  value = module.budgets.deny_policy_arn
}

output "probe_role_arn" {
  value = module.budgets.probe_role_arn
}
