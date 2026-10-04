output "function_name" {
  value = aws_lambda_function.api.function_name
}

output "alias_name" {
  value = aws_lambda_alias.live.name
}

output "function_url" {
  value = aws_lambda_function_url.api.function_url
}

output "role_name" {
  value = aws_iam_role.api.name
}
