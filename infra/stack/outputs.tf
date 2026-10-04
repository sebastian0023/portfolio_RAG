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

output "api_function_name" {
  value = module.api.function_name
}

output "api_alias_name" {
  value = module.api.alias_name
}

output "api_function_url" {
  description = "Direct Function URL; only used by the smoke test to prove unsigned calls are refused."
  value       = module.api.function_url
}
