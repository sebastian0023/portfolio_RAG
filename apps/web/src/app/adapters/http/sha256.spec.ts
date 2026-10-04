import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the empty body and always returns 64 lowercase hex characters', async () => {
    const hash = await sha256Hex(new Uint8Array());
    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
