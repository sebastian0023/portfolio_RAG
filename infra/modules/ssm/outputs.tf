output "parameter_names" {
  description = "Full names of every parameter this module manages."
  value = concat(
    [for p in aws_ssm_parameter.operator : p.name],
    [for p in aws_ssm_parameter.managed : p.name],
    [for p in aws_ssm_parameter.secret : p.name],
  )
}
