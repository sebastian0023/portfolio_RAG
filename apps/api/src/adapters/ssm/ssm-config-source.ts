import {
  GetParametersCommand,
  type GetParametersCommandOutput,
} from '@aws-sdk/client-ssm';
import type { ConfigSource } from '../../core/config/cached-config.js';
import { PARAMETER_NAMES } from '../../core/config/runtime-config.js';

export interface SsmClientLike {
  send(command: GetParametersCommand): Promise<GetParametersCommandOutput>;
}

// Reads the four config parameters in one call. Absent parameters are simply missing from the result, so the
// core validator reports them and the request fails closed (ADR-027, ADR-044).
export class SsmConfigSource implements ConfigSource {
  constructor(
    private readonly client: SsmClientLike,
    private readonly prefix: string,
  ) {}

  async load(): Promise<Record<string, string>> {
    const output = await this.client.send(
      new GetParametersCommand({
        Names: PARAMETER_NAMES.map((name) => `${this.prefix}/${name}`),
        WithDecryption: false,
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
