// Fails a Terraform plan that would destroy protected stateful resources (ADR-033) or touch anything
// outside the portfolio-v2 prefix in the shared AWS account (ADR-047).
// Usage: terraform show -json plan.out > plan.json && node infra/scripts/check-plan.ts plan.json
import { readFileSync } from 'node:fs';

export interface ResourceChange {
  readonly address: string;
  readonly mode: string;
  readonly type: string;
  readonly change: {
    readonly actions: readonly string[];
    readonly before?: Readonly<Record<string, unknown>> | null;
    readonly after?: Readonly<Record<string, unknown>> | null;
    readonly after_unknown?: Readonly<Record<string, unknown>> | null;
  };
}

export interface Plan {
  readonly resource_changes?: readonly ResourceChange[];
}

export interface Violation {
  readonly address: string;
  readonly reason: string;
}

// Managed resource types this repository may change, and the attribute that carries the name.
// A type missing from this map is rejected, so adding a service is a deliberate edit to this file.
const NAME_ATTRIBUTE: Readonly<Record<string, string>> = {
  aws_s3_bucket: 'bucket',
  aws_s3_bucket_lifecycle_configuration: 'bucket',
  aws_s3_bucket_ownership_controls: 'bucket',
  aws_s3_bucket_policy: 'bucket',
  aws_s3_bucket_public_access_block: 'bucket',
  aws_s3_bucket_server_side_encryption_configuration: 'bucket',
  aws_s3_bucket_versioning: 'bucket',
  aws_iam_role: 'name',
  aws_iam_role_policy: 'role',
  aws_iam_role_policy_attachment: 'role',
  aws_iam_policy: 'name',
  aws_ssm_parameter: 'name',
  aws_budgets_budget: 'name',
  aws_budgets_budget_action: 'budget_name',
  aws_lambda_function: 'function_name',
  aws_lambda_function_url: 'function_name',
  aws_lambda_permission: 'function_name',
  aws_lambda_alias: 'function_name',
  aws_cloudfront_distribution: 'comment',
  aws_cloudfront_origin_access_control: 'name',
  aws_cloudfront_origin_request_policy: 'name',
  aws_cloudfront_response_headers_policy: 'name',
  aws_dynamodb_table: 'name',
  aws_cloudwatch_log_group: 'name',
};

// These types name their parent resource (a bucket or role) instead of carrying their own name.
// When the parent is created in the same plan the reference is unknown until apply. That is acceptable
// because the parent is itself checked against the prefix.
const DEPENDENT_TYPES: ReadonlySet<string> = new Set([
  'aws_s3_bucket_lifecycle_configuration',
  'aws_s3_bucket_ownership_controls',
  'aws_s3_bucket_policy',
  'aws_s3_bucket_public_access_block',
  'aws_s3_bucket_server_side_encryption_configuration',
  'aws_s3_bucket_versioning',
  'aws_iam_role_policy',
  'aws_iam_role_policy_attachment',
  'aws_budgets_budget_action',
  'aws_lambda_function_url',
  'aws_lambda_permission',
  'aws_lambda_alias',
]);

// Destroying or replacing these loses state or data that cannot be recreated (ADR-033).
const PROTECTED_TYPES: ReadonlySet<string> = new Set([
  'aws_s3_bucket',
  'aws_dynamodb_table',
  'aws_cognito_user_pool',
  'aws_s3vectors_vector_bucket',
  'aws_s3vectors_index',
]);

const PREFIXES = [
  'portfolio-v2-',
  '/portfolio-v2/',
  '/aws/lambda/portfolio-v2-',
];

const isNoop = (actions: readonly string[]): boolean =>
  actions.every((action) => action === 'no-op' || action === 'read');

export function checkPlan(plan: Plan): Violation[] {
  const violations: Violation[] = [];
  const add = (address: string, reason: string): void => {
    violations.push({ address, reason });
  };

  for (const rc of plan.resource_changes ?? []) {
    if (rc.mode !== 'managed' || isNoop(rc.change.actions)) continue;

    if (rc.type === 'aws_iam_openid_connect_provider') {
      add(
        rc.address,
        'the GitHub OIDC provider is shared and must only be read',
      );
      continue;
    }

    const destroys = rc.change.actions.includes('delete');
    if (destroys && PROTECTED_TYPES.has(rc.type)) {
      add(rc.address, 'would destroy or replace a protected stateful resource');
    }

    const attribute = NAME_ATTRIBUTE[rc.type];
    if (attribute === undefined) {
      add(rc.address, `resource type ${rc.type} is not allowed by the guard`);
      continue;
    }

    // Deletions are judged on the existing object, everything else on the planned one.
    const source =
      destroys && !rc.change.actions.includes('create')
        ? rc.change.before
        : rc.change.after;
    const name = source?.[attribute];
    const unknown = rc.change.after_unknown?.[attribute] === true;
    if (typeof name !== 'string' && unknown && DEPENDENT_TYPES.has(rc.type)) {
      continue;
    }
    if (typeof name !== 'string') {
      add(
        rc.address,
        `cannot verify ${attribute}: value is unknown at plan time`,
      );
    } else if (!PREFIXES.some((prefix) => name.startsWith(prefix))) {
      add(
        rc.address,
        `${attribute} "${name}" is outside the portfolio-v2 prefix`,
      );
    }
  }
  return violations;
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node infra/scripts/check-plan.ts <plan.json>');
    process.exit(2);
  }
  const violations = checkPlan(JSON.parse(readFileSync(path, 'utf8')) as Plan);
  for (const v of violations) console.error(`${v.address}: ${v.reason}`);
  if (violations.length > 0) process.exit(1);
  console.log('plan guard: no violations');
}
