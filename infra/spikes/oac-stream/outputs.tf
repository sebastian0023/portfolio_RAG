output "distribution_domain" {
  value = aws_cloudfront_distribution.spike.domain_name
}

output "function_url" {
  description = "The origin URL. It must be unreachable without a valid SigV4 signature."
  value       = aws_lambda_function_url.stream.function_url
}

output "log_group" {
  value = aws_cloudwatch_log_group.fn.name
}
