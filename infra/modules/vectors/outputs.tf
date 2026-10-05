output "vector_bucket_name" {
  value = aws_s3vectors_vector_bucket.chunks.vector_bucket_name
}

output "vector_bucket_arn" {
  value = aws_s3vectors_vector_bucket.chunks.vector_bucket_arn
}

output "index_arn_pattern" {
  description = "Resource pattern for every candidate or active index in the bucket."
  value       = "${aws_s3vectors_vector_bucket.chunks.vector_bucket_arn}/index/chunks-*"
}

output "ingest_role_name" {
  value = aws_iam_role.ingest.name
}

output "ingest_role_arn" {
  value = aws_iam_role.ingest.arn
}

output "eval_role_name" {
  value = aws_iam_role.eval.name
}

output "eval_role_arn" {
  value = aws_iam_role.eval.arn
}
