import { describe, expect, test } from 'vitest';
import { checkPlan, type Plan } from '../../infra/scripts/check-plan.ts';

const change = (
  type: string,
  actions: string[],
  attributes: Record<string, unknown>,
  mode = 'managed',
): Plan => ({
  resource_changes: [
    {
      address: `${type}.example`,
      mode,
      type,
      change: {
        actions,
        before: actions.includes('create') ? null : attributes,
        after: actions.includes('delete') ? null : attributes,
      },
    },
  ],
});

describe('plan guard (ADR-033, ADR-047)', () => {
  test('allows creating a prefixed bucket', () => {
    const plan = change('aws_s3_bucket', ['create'], {
      bucket: 'portfolio-v2-prod-tfstate-123456789012',
    });
    expect(checkPlan(plan)).toEqual([]);
  });

  test('allows an SSM parameter under the prefixed path', () => {
    const plan = change('aws_ssm_parameter', ['update'], {
      name: '/portfolio-v2/prod/chat_enabled',
    });
    expect(checkPlan(plan)).toEqual([]);
  });

  test('ignores no-op changes and data sources', () => {
    expect(
      checkPlan(change('aws_s3_bucket', ['no-op'], { bucket: 'other-bucket' })),
    ).toEqual([]);
    expect(
      checkPlan(change('aws_iam_role', ['read'], { name: 'other' }, 'data')),
    ).toEqual([]);
  });

  test('rejects destroying a protected bucket', () => {
    const plan = change('aws_s3_bucket', ['delete'], {
      bucket: 'portfolio-v2-prod-tfstate-123456789012',
    });
    expect(checkPlan(plan).map((v) => v.reason)).toContain(
      'would destroy or replace a protected stateful resource',
    );
  });

  test('rejects replacing a protected table in either action order', () => {
    for (const actions of [
      ['delete', 'create'],
      ['create', 'delete'],
    ]) {
      const plan = change('aws_dynamodb_table', actions, {
        name: 'portfolio-v2-prod-counters',
      });
      expect(checkPlan(plan).some((v) => v.reason.includes('protected'))).toBe(
        true,
      );
    }
  });

  test('allows deleting an unprotected prefixed role', () => {
    const plan = change('aws_iam_role', ['delete'], {
      name: 'portfolio-v2-prod-killswitch-probe',
    });
    expect(checkPlan(plan)).toEqual([]);
  });

  test('rejects names outside the prefix, including near-misses', () => {
    for (const name of [
      'lift-dev-table',
      'portfolio-gha-tf-plan',
      'dsmm-portfolio-prod-site',
      'portfolio-v2',
    ]) {
      const plan = change('aws_iam_role', ['update'], { name });
      expect(checkPlan(plan)).toHaveLength(1);
    }
  });

  test('judges a deletion by the existing name', () => {
    const plan = change('aws_iam_role', ['delete'], {
      name: 'portfolio-gha-tf-apply',
    });
    expect(checkPlan(plan)[0]?.reason).toContain(
      'outside the portfolio-v2 prefix',
    );
  });

  test('allows the Lambda, CloudFront, and log group types under the prefix', () => {
    const plans = [
      change('aws_lambda_function', ['create'], {
        function_name: 'portfolio-v2-prod-spike-stream',
      }),
      change('aws_cloudfront_distribution', ['create'], {
        comment: 'portfolio-v2-prod-spike-oac-stream',
      }),
      change('aws_cloudfront_origin_access_control', ['create'], {
        name: 'portfolio-v2-prod-spike-oac',
      }),
      change('aws_cloudwatch_log_group', ['create'], {
        name: '/aws/lambda/portfolio-v2-prod-spike-stream',
      }),
    ];
    for (const plan of plans) expect(checkPlan(plan)).toEqual([]);
  });

  test('allows the alias, headers policy, and counters table under the prefix', () => {
    const plans = [
      change('aws_lambda_alias', ['create'], {
        name: 'live',
        function_name: 'portfolio-v2-prod-api',
      }),
      change('aws_cloudfront_response_headers_policy', ['create'], {
        name: 'portfolio-v2-prod-spa',
      }),
      change('aws_dynamodb_table', ['create'], {
        name: 'portfolio-v2-prod-counters',
      }),
    ];
    for (const plan of plans) expect(checkPlan(plan)).toEqual([]);
  });

  test('judges the alias by its function, not its own name', () => {
    expect(
      checkPlan(
        change('aws_lambda_alias', ['update'], {
          name: 'live',
          function_name: 'lift-dev-get-today',
        }),
      ),
    ).toHaveLength(1);
  });

  test('allows an alias whose function is created in the same plan', () => {
    const plan: Plan = {
      resource_changes: [
        {
          address: 'aws_lambda_alias.live',
          mode: 'managed',
          type: 'aws_lambda_alias',
          change: {
            actions: ['create'],
            before: null,
            after: { name: 'live' },
            after_unknown: { function_name: true },
          },
        },
      ],
    };
    expect(checkPlan(plan)).toEqual([]);
  });

  test('rejects deleting or replacing the counters table and foreign table names', () => {
    for (const actions of [
      ['delete'],
      ['delete', 'create'],
      ['create', 'delete'],
    ]) {
      expect(
        checkPlan(
          change('aws_dynamodb_table', actions, {
            name: 'portfolio-v2-prod-counters',
          }),
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(
      checkPlan(
        change('aws_dynamodb_table', ['create'], { name: 'lift-dev-counters' }),
      ),
    ).toHaveLength(1);
  });

  test("rejects another project's log group and function", () => {
    expect(
      checkPlan(
        change('aws_cloudwatch_log_group', ['update'], {
          name: '/aws/lambda/lift-dev-get-today',
        }),
      ),
    ).toHaveLength(1);
    expect(
      checkPlan(
        change('aws_lambda_function', ['update'], {
          function_name: 'relationship-rag-test-api-ChatFunction',
        }),
      ),
    ).toHaveLength(1);
  });

  test('rejects managing the shared OIDC provider', () => {
    const plan = change('aws_iam_openid_connect_provider', ['create'], {
      url: 'https://token.actions.githubusercontent.com',
    });
    expect(checkPlan(plan)[0]?.reason).toContain('shared');
  });

  test('fails closed on unknown resource types and unknown names', () => {
    expect(
      checkPlan(
        change('aws_sqs_queue', ['create'], {
          name: 'portfolio-v2-prod-jobs',
        }),
      )[0]?.reason,
    ).toContain('not allowed by the guard');
    expect(
      checkPlan(change('aws_s3_bucket', ['create'], { bucket: null }))[0]
        ?.reason,
    ).toContain('unknown at plan time');
  });

  test('accepts an unknown parent reference only on dependent types', () => {
    const dependent: Plan = {
      resource_changes: [
        {
          address: 'aws_s3_bucket_versioning.state',
          mode: 'managed',
          type: 'aws_s3_bucket_versioning',
          change: {
            actions: ['create'],
            before: null,
            after: {},
            after_unknown: { bucket: true },
          },
        },
      ],
    };
    expect(checkPlan(dependent)).toEqual([]);

    const primary: Plan = {
      resource_changes: [
        {
          address: 'aws_s3_bucket.state',
          mode: 'managed',
          type: 'aws_s3_bucket',
          change: {
            actions: ['create'],
            before: null,
            after: {},
            after_unknown: { bucket: true },
          },
        },
      ],
    };
    expect(checkPlan(primary)[0]?.reason).toContain('unknown at plan time');
  });

  test('still rejects a dependent resource whose parent is outside the prefix', () => {
    const plan: Plan = {
      resource_changes: [
        {
          address: 'aws_s3_bucket.other',
          mode: 'managed',
          type: 'aws_s3_bucket',
          change: {
            actions: ['create'],
            before: null,
            after: { bucket: 'other-bucket' },
          },
        },
        {
          address: 'aws_s3_bucket_versioning.other',
          mode: 'managed',
          type: 'aws_s3_bucket_versioning',
          change: {
            actions: ['create'],
            before: null,
            after: {},
            after_unknown: { bucket: true },
          },
        },
      ],
    };
    const violations = checkPlan(plan);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.address).toBe('aws_s3_bucket.other');
  });

  test('reports every violation in a mixed plan', () => {
    const plan: Plan = {
      resource_changes: [
        ...(change('aws_iam_role', ['create'], { name: 'portfolio-v2-prod-ok' })
          .resource_changes ?? []),
        ...(change('aws_iam_role', ['update'], { name: 'someone-elses-role' })
          .resource_changes ?? []),
        ...(change('aws_s3_bucket', ['delete'], {
          bucket: 'portfolio-v2-prod-x',
        }).resource_changes ?? []),
      ],
    };
    expect(checkPlan(plan)).toHaveLength(2);
  });
});
