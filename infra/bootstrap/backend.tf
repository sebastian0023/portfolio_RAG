# Bucket and region come from the gitignored backend.hcl (terraform init -backend-config=backend.hcl).
terraform {
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}
