output "counters_table_name" {
  value = aws_dynamodb_table.counters.name
}

output "counters_table_arn" {
  value = aws_dynamodb_table.counters.arn
}
