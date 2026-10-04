locals {
  repo_slug = "${var.github_owner}/${var.github_repository}"
  oidc_host = "token.actions.githubusercontent.com"
}

# The GitHub OIDC provider is shared by other projects in this account (ADR-047).
# It is read-only here: this module must never create, change, or destroy it.
# Looked up by ARN rather than URL: a URL lookup lists every provider in the account, which the plan role must not be allowed to do.
data "aws_iam_openid_connect_provider" "github" {
  arn = "arn:aws:iam::${var.account_id}:oidc-provider/${local.oidc_host}"
}

# Plan role: assumable only by pull_request runs of this exact repository (ADR-008).
# There is deliberately no apply role. CI apply stays disabled until an approval gate is proven (ADR-035, R-13).
data "aws_iam_policy_document" "plan_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["repo:${local.repo_slug}:pull_request"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:repository_owner_id"
      values   = [var.github_owner_id]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:repository_id"
      values   = [var.github_repository_id]
    }
  }
}

resource "aws_iam_role" "plan" {
  name                 = "${var.name_prefix}-gha-plan"
  description          = "Read-only Terraform plan from pull_request runs of ${local.repo_slug}."
  assume_role_policy   = data.aws_iam_policy_document.plan_trust.json
  max_session_duration = 3600
}

# Read access is limited to portfolio-v2 resources wherever the service supports resource-level scoping (ADR-047).
data "aws_iam_policy_document" "plan" {
  statement {
    sid       = "StateRead"
    actions   = ["s3:GetBucketLocation", "s3:ListBucket"]
    resources = [var.state_bucket_arn]
  }

  statement {
    sid       = "StateObjectRead"
    actions   = ["s3:GetObject"]
    resources = ["${var.state_bucket_arn}/*"]
  }

  statement {
    sid = "BucketMetadataRead"
    actions = [
      "s3:GetAccelerateConfiguration",
      "s3:GetBucket*",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:ListBucket",
    ]
    resources = ["arn:aws:s3:::portfolio-v2-*"]
  }

  statement {
    sid = "IamRead"
    actions = [
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListPolicyVersions",
      "iam:ListRolePolicies",
      "iam:ListRoleTags",
    ]
    resources = [
      "arn:aws:iam::${var.account_id}:role/portfolio-v2-*",
      "arn:aws:iam::${var.account_id}:policy/portfolio-v2-*",
    ]
  }

  statement {
    sid       = "OidcProviderRead"
    actions   = ["iam:GetOpenIDConnectProvider"]
    resources = [data.aws_iam_openid_connect_provider.github.arn]
  }

  statement {
    sid = "SsmParameterRead"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:ListTagsForResource",
    ]
    resources = ["arn:aws:ssm:*:${var.account_id}:parameter/portfolio-v2/*"]
  }

  statement {
    sid       = "SsmParameterList"
    actions   = ["ssm:DescribeParameters"]
    resources = ["*"] #checkov:skip=CKV_AWS_356:DescribeParameters does not support resource-level permissions.
  }

  statement {
    sid = "BudgetsRead"
    actions = [
      "budgets:DescribeBudgetAction",
      "budgets:DescribeBudgetActionsForBudget",
      "budgets:ListTagsForResource",
      "budgets:ViewBudget",
    ]
    resources = ["arn:aws:budgets::${var.account_id}:budget/portfolio-v2-*"]
  }
}

resource "aws_iam_role_policy" "plan" {
  name   = "${var.name_prefix}-gha-plan-read"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan.json
}
