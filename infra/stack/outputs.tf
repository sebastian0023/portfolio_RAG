output "parameter_names" {
  value = module.ssm.parameter_names
}

output "deny_policy_arn" {
  value = module.budgets.deny_policy_arn
}

output "probe_role_arn" {
  value = module.budgets.probe_role_arn
}

output "site_url" {
  value = "https://${module.edge.distribution_domain_name}"
}

output "distribution_id" {
  value = module.edge.distribution_id
}

output "web_bucket" {
  value = module.web.bucket_id
}
