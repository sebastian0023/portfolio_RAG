output "deny_policy_arn" {
  value = aws_iam_policy.deny_model_invoke.arn
}

output "probe_role_arn" {
  value = aws_iam_role.killswitch_probe.arn
}

output "bedrock_budget_name" {
  value = aws_budgets_budget.bedrock.name
}
