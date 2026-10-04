import type { ChatRequest } from '@portfolio/shared';
import { describe, expect, it } from 'vitest';
import { fitRequest } from './request-fit';

const turn = (role: 'user' | 'assistant', text: string) => ({ role, text });

describe('fitRequest', () => {
  it('leaves a request that fits unchanged and returns its exact bytes', () => {
    const request: ChatRequest = {
      question: 'hi',
      history: [turn('user', 'a')],
    };
    const fitted = fitRequest(request, 8192);
    expect(fitted.request).toEqual(request);
    expect(new TextDecoder().decode(fitted.bytes)).toBe(
      JSON.stringify(request),
    );
  });

  it('drops the oldest turns first until the body fits', () => {
    const big = 'x'.repeat(3000);
    const request: ChatRequest = {
      question: 'q',
      history: [
        turn('user', 'one'),
        turn('assistant', big),
        turn('user', 'two'),
        turn('assistant', big),
      ],
    };
    const fitted = fitRequest(request, 4000);
    expect(fitted.bytes.byteLength).toBeLessThanOrEqual(4000);
    expect(fitted.request.history.at(-1)).toEqual(turn('assistant', big));
    expect(fitted.request.history.length).toBeLessThan(4);
  });

  it('counts bytes, not characters', () => {
    const request: ChatRequest = { question: 'é'.repeat(100), history: [] };
    expect(fitRequest(request, 8192).bytes.byteLength).toBeGreaterThan(200);
    const history = [
      turn('user', 'é'.repeat(100)),
      turn('assistant', 'é'.repeat(100)),
    ];
    expect(
      fitRequest({ question: 'q', history }, 100).request.history,
    ).toHaveLength(0);
  });

  it('gives up shrinking when only the question remains', () => {
    const fitted = fitRequest({ question: 'q'.repeat(500), history: [] }, 10);
    expect(fitted.request.history).toEqual([]);
    expect(fitted.bytes.byteLength).toBeGreaterThan(10);
  });
});
