locals {
  bucket_name    = "${var.name_prefix}-vectors"
  ingest_name    = "${var.name_prefix}-ingest"
  eval_name      = "${var.name_prefix}-eval"
  titan_arn      = "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"
  param_prefix   = "arn:aws:ssm:${var.region}:${var.account_id}:parameter${var.parameter_prefix}"
  bucket_arn     = aws_s3vectors_vector_bucket.chunks.vector_bucket_arn
  index_arns     = "${local.bucket_arn}/index/chunks-*"
  tagged_targets = [local.bucket_arn, local.index_arns]
}

# The vector bucket holds every blue/green index (ADR-019). Terraform owns only the bucket: indexes are named by
# a content hash and are created, promoted, and pruned by the ingest and lifecycle tools (ADR-053), so a plan can
# never delete one. Default encryption is service-managed (SSE-S3), as everywhere else (ADR-023).
resource "aws_s3vectors_vector_bucket" "chunks" {
  vector_bucket_name = local.bucket_name
  force_destroy      = false

  lifecycle {
    prevent_destroy = true
  }
}

data "aws_iam_policy_document" "operator_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [var.operator_role_arn]
    }
  }
}

# Used by the operator-run ingest tool. It can create and fill indexes and read what it wrote, and nothing else:
# no delete action, no bucket policy, no SSM write. It is a kill-switch target (R-14).
resource "aws_iam_role" "ingest" {
  name                 = local.ingest_name
  description          = "Operator-run corpus ingestion. Assumable only by the operator role."
  assume_role_policy   = data.aws_iam_policy_document.operator_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "ingest" {
  statement {
    sid       = "EmbedWithTitan"
    actions   = ["bedrock:InvokeModel"]
    resources = [local.titan_arn]
  }

  statement {
    sid       = "ReadBucket"
    actions   = ["s3vectors:GetVectorBucket", "s3vectors:ListIndexes"]
    resources = [local.bucket_arn]
  }

  statement {
    sid = "BuildCandidateIndexes"
    actions = [
      "s3vectors:CreateIndex",
      "s3vectors:GetIndex",
      "s3vectors:PutVectors",
      "s3vectors:GetVectors",
      "s3vectors:ListVectors",
      "s3vectors:QueryVectors",
    ]
    resources = [local.index_arns]
  }

  # TagResource and ListTagsForResource are not in the access-management action table, so they are allowed on
  # both resource types of this one bucket rather than guessed.
  statement {
    sid       = "TagCandidateIndexes"
    actions   = ["s3vectors:TagResource", "s3vectors:ListTagsForResource"]
    resources = local.tagged_targets
  }

  statement {
    sid       = "ReadActiveIndexName"
    actions   = ["ssm:GetParameter"]
    resources = ["${local.param_prefix}/active_index"]
  }
}

resource "aws_iam_role_policy" "ingest" {
  name   = "${local.ingest_name}-runtime"
  role   = aws_iam_role.ingest.id
  policy = data.aws_iam_policy_document.ingest.json
}

# The profile is read so the eval role names the exact profile and the models it routes to, as the API role does.
data "aws_bedrock_inference_profile" "model" {
  inference_profile_id = var.inference_profile_id
}

# Used by the candidate eval tool (ADR-034): it runs the real answer path against a candidate index. It reads only
# the four non-secret parameters, never the Turnstile secret or the pass key. It is a kill-switch target (R-14).
resource "aws_iam_role" "eval" {
  name                 = local.eval_name
  description          = "Operator-run candidate evaluation. Assumable only by the operator role."
  assume_role_policy   = data.aws_iam_policy_document.operator_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "eval" {
  statement {
    sid       = "EmbedWithTitan"
    actions   = ["bedrock:InvokeModel"]
    resources = [local.titan_arn]
  }

  statement {
    sid       = "InvokeProfile"
    actions   = ["bedrock:InvokeModelWithResponseStream"]
    resources = [data.aws_bedrock_inference_profile.model.inference_profile_arn]
  }

  statement {
    sid       = "InvokeRoutedModels"
    actions   = ["bedrock:InvokeModelWithResponseStream"]
    resources = [for model in data.aws_bedrock_inference_profile.model.models : model.model_arn]

    condition {
      test     = "StringEquals"
      variable = "bedrock:InferenceProfileArn"
      values   = [data.aws_bedrock_inference_profile.model.inference_profile_arn]
    }
  }

  statement {
    sid       = "ReadBucket"
    actions   = ["s3vectors:GetVectorBucket", "s3vectors:ListIndexes"]
    resources = [local.bucket_arn]
  }

  statement {
    sid       = "QueryCandidateIndexes"
    actions   = ["s3vectors:GetIndex", "s3vectors:QueryVectors", "s3vectors:GetVectors", "s3vectors:ListVectors"]
    resources = [local.index_arns]
  }

  statement {
    sid       = "ReadIndexTags"
    actions   = ["s3vectors:ListTagsForResource"]
    resources = local.tagged_targets
  }

  statement {
    sid     = "ReadNonSecretConfiguration"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = [
      "${local.param_prefix}/chat_enabled",
      "${local.param_prefix}/active_index",
      "${local.param_prefix}/llm_config",
      "${local.param_prefix}/limits",
    ]
  }
}

resource "aws_iam_role_policy" "eval" {
  name   = "${local.eval_name}-runtime"
  role   = aws_iam_role.eval.id
  policy = data.aws_iam_policy_document.eval.json
}
