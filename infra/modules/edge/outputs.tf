output "distribution_id" {
  value = aws_cloudfront_distribution.edge.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.edge.arn
}

output "distribution_domain_name" {
  value = aws_cloudfront_distribution.edge.domain_name
}
