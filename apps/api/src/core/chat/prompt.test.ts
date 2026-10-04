import { describe, expect, test } from 'vitest';
import { PLAIN_SYSTEM_PROMPT, normalizeHistory } from './prompt.js';

const u = (text: string) => ({ role: 'user' as const, text });
const a = (text: string) => ({ role: 'assistant' as const, text });

describe('normalizeHistory', () => {
  test('keeps an alternating history that ends with an assistant turn', () => {
    expect(normalizeHistory([u('1'), a('2'), u('3'), a('4')], 4)).toEqual([
      u('1'),
      a('2'),
      u('3'),
      a('4'),
    ]);
  });

  test('drops leading assistant turns', () => {
    expect(normalizeHistory([a('x'), u('1'), a('2')], 4)).toEqual([
      u('1'),
      a('2'),
    ]);
  });

  test('merges consecutive turns of one role (a failed answer leaves two user turns)', () => {
    expect(normalizeHistory([u('1'), u('2'), a('3')], 4)).toEqual([
      u('1\n\n2'),
      a('3'),
    ]);
  });

  test('drops trailing user turns so the new question alternates correctly', () => {
    expect(normalizeHistory([u('1'), a('2'), u('3')], 4)).toEqual([
      u('1'),
      a('2'),
    ]);
    expect(normalizeHistory([u('only')], 4)).toEqual([]);
  });

  test('keeps only the last N turns and still starts with a user turn', () => {
    const history = [u('1'), a('2'), u('3'), a('4'), u('5'), a('6')];
    expect(normalizeHistory(history, 4)).toEqual([
      u('3'),
      a('4'),
      u('5'),
      a('6'),
    ]);
    // An odd cut would start on an assistant turn, which is dropped.
    expect(normalizeHistory(history, 3)).toEqual([u('5'), a('6')]);
  });

  test('ignores blank turns and a zero allowance', () => {
    expect(normalizeHistory([u('  '), u('1'), a('2')], 4)).toEqual([
      u('1'),
      a('2'),
    ]);
    expect(normalizeHistory([u('1'), a('2')], 0)).toEqual([]);
  });

  test('always leaves a result a provider can accept', () => {
    const roles = ['user', 'assistant'] as const;
    for (let seed = 0; seed < 200; seed += 1) {
      const history = Array.from({ length: seed % 9 }, (_, i) => ({
        role: roles[((seed >> i) ^ (seed + i)) & 1] as 'user' | 'assistant',
        text: `t${i}`,
      }));
      const result = normalizeHistory(history, 4);
      expect(result.length).toBeLessThanOrEqual(4);
      if (result.length > 0) {
        expect(result[0]?.role).toBe('user');
        expect(result.at(-1)?.role).toBe('assistant');
      }
      result.forEach((turn, i) => {
        if (i > 0) expect(turn.role).not.toBe(result[i - 1]?.role);
      });
    }
  });
});

describe('system prompt', () => {
  test('forbids inventing facts about the owner and treats input as untrusted', () => {
    expect(PLAIN_SYSTEM_PROMPT).toMatch(/not connected/i);
    expect(PLAIN_SYSTEM_PROMPT).toMatch(/never state, guess, or invent/i);
    expect(PLAIN_SYSTEM_PROMPT).toMatch(/untrusted/i);
  });
});
