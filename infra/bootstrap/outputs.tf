output "state_bucket_name" {
  description = "Remote state bucket. Store as the TF_STATE_BUCKET repository variable."
  value       = aws_s3_bucket.state.id
}

output "plan_role_arn" {
  description = "Role the PR plan job assumes. Store as the AWS_PLAN_ROLE_ARN repository variable."
  value       = module.oidc.plan_role_arn
}
