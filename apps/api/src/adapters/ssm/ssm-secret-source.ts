import {
  GetParametersCommand,
  type GetParametersCommandOutput,
} from '@aws-sdk/client-ssm';
import type { SecretSource } from '../../core/guest/secrets.js';

export interface SsmSecretClientLike {
  send(command: GetParametersCommand): Promise<GetParametersCommandOutput>;
}

const NAMES = ['turnstile_secret', 'guest_pass_key'] as const;

// Reads the two SecureStrings with decryption. The values stay inside CachedSecrets: they are never returned
// to a caller that logs, and the source holds nothing of its own.
export class SsmSecretSource implements SecretSource {
  constructor(
    private readonly client: SsmSecretClientLike,
    private readonly prefix: string,
  ) {}

  async load(): Promise<Record<string, string>> {
    const output = await this.client.send(
      new GetParametersCommand({
        Names: NAMES.map((name) => `${this.prefix}/${name}`),
        WithDecryption: true,
      }),
    );
    const values: Record<string, string> = {};
    for (const parameter of output.Parameters ?? []) {
      if (parameter.Name !== undefined && parameter.Value !== undefined) {
        values[parameter.Name.slice(this.prefix.length + 1)] = parameter.Value;
      }
    }
    return values;
  }
}
