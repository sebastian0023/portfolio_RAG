locals {
  deny_policy_name  = "${var.name_prefix}-deny-model-invoke"
  probe_role_name   = "${var.name_prefix}-killswitch-probe"
  action_role_name  = "${var.name_prefix}-budget-action"
  kill_target_roles = concat([local.probe_role_name], var.additional_kill_target_roles)
}

# Deny policy attached by the budget action. It covers both endpoint families (R-03): runtime inference
# (InvokeModel, streaming, Converse) which also serves Titan embeddings, and the mantle endpoint used by Gemma.
data "aws_iam_policy_document" "deny_model_invoke" {
  statement {
    sid    = "DenyModelInference"
    effect = "Deny"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:Converse",
      "bedrock:ConverseStream",
      "bedrock-mantle:*",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "deny_model_invoke" {
  name        = local.deny_policy_name
  description = "Explicit deny for all model inference. Attached to portfolio-v2 roles by the budget action."
  policy      = data.aws_iam_policy_document.deny_model_invoke.json
}

# Stand-in for the API execution role until Phase 3. It lets the drill prove that a role which could
# invoke Titan, Haiku, and Gemma is blocked once the deny policy is attached, and works again after.
data "aws_iam_policy_document" "probe_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [var.operator_role_arn]
    }
  }
}

resource "aws_iam_role" "killswitch_probe" {
  name                 = local.probe_role_name
  description          = "Kill-switch drill target. Assumable only by the operator role."
  assume_role_policy   = data.aws_iam_policy_document.probe_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "probe_allow" {
  #checkov:skip=CKV_AWS_356:Test-only role; resource ARNs for inference profiles and mantle are confirmed by the P1-01 probes. Assumable only by the operator role.
  #checkov:skip=CKV_AWS_355:Same as above; the deny policy is what this role exists to test.
  statement {
    sid = "InvokeCandidateModels"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:Converse",
      "bedrock:ConverseStream",
      "bedrock-mantle:CreateInference",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "probe_allow" {
  name   = "${var.name_prefix}-killswitch-probe-invoke"
  role   = aws_iam_role.killswitch_probe.id
  policy = data.aws_iam_policy_document.probe_allow.json
}

# Role AWS Budgets assumes to attach and detach the deny policy. It can touch only the listed target
# roles and only with the one deny policy.
data "aws_iam_policy_document" "action_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:budgets::${var.account_id}:budget/${var.name_prefix}-*"]
    }
  }
}

resource "aws_iam_role" "budget_action" {
  name               = local.action_role_name
  description        = "Executes the kill-switch budget action. Can only attach or detach the deny policy on listed roles."
  assume_role_policy = data.aws_iam_policy_document.action_trust.json
}

data "aws_iam_policy_document" "action_permissions" {
  statement {
    sid       = "AttachDenyPolicyToTargetRolesOnly"
    actions   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
    resources = [for name in local.kill_target_roles : "arn:aws:iam::${var.account_id}:role/${name}"]

    condition {
      test     = "ArnEquals"
      variable = "iam:PolicyARN"
      values   = [aws_iam_policy.deny_model_invoke.arn]
    }
  }
}

resource "aws_iam_role_policy" "action_permissions" {
  name   = "${var.name_prefix}-budget-action-attach-deny"
  role   = aws_iam_role.budget_action.id
  policy = data.aws_iam_policy_document.action_permissions.json
}

# Account-wide budgets are not used because other projects share the account (ADR-047). The service
# budget over-approximates model spend, which fails safe: the deny policy only touches portfolio-v2 roles.
resource "aws_budgets_budget" "bedrock" {
  name         = "${var.name_prefix}-bedrock-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.bedrock_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "Service"
    values = var.bedrock_service_names
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

resource "aws_budgets_budget" "scope" {
  name         = "${var.name_prefix}-scope-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.scope_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:CostScope$${var.cost_scope_tag}"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

resource "aws_budgets_budget_action" "deny_model_invoke" {
  budget_name        = aws_budgets_budget.bedrock.name
  action_type        = "APPLY_IAM_POLICY"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.budget_action.arn

  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 100
  }

  definition {
    iam_action_definition {
      policy_arn = aws_iam_policy.deny_model_invoke.arn
      roles      = local.kill_target_roles
    }
  }

  subscriber {
    subscription_type = "EMAIL"
    address           = var.alert_email
  }

  depends_on = [aws_iam_role_policy.action_permissions]
}
