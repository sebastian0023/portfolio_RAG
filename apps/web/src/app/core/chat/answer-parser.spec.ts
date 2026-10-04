import { describe, expect, it } from 'vitest';
import { parseAnswer, plainAnswer } from './answer-parser';

const cite = new Set([1, 2]);

describe('parseAnswer', () => {
  it('renders markup-looking model output as plain text', () => {
    const [block] = parseAnswer(
      '<script>alert(1)</script> <img src=x onerror=y> done',
      {
        citeable: cite,
      },
    );
    expect(block?.segments).toEqual([
      {
        kind: 'text',
        text: '<script>alert(1)</script> <img src=x onerror=y> done',
      },
    ]);
  });

  it('parses bold, code, list lines, and known citation markers', () => {
    const blocks = parseAnswer('**Name** uses `aws` [1]\n- item [2]', {
      citeable: cite,
    });
    expect(blocks).toEqual([
      {
        type: 'p',
        segments: [
          { kind: 'bold', text: 'Name' },
          { kind: 'text', text: ' uses ' },
          { kind: 'code', text: 'aws' },
          { kind: 'text', text: ' ' },
          { kind: 'cite', n: 1 },
        ],
      },
      {
        type: 'li',
        segments: [
          { kind: 'text', text: 'item ' },
          { kind: 'cite', n: 2 },
        ],
      },
    ]);
  });

  it('keeps a marker without a source as literal text, and drops an unavailable one', () => {
    const blocks = parseAnswer('a [9] b [6]', {
      citeable: cite,
      unavailable: new Set([6]),
    });
    expect(plainAnswer(blocks)).toBe('a [9] b ');
  });

  it('only treats purely numeric brackets as markers', () => {
    const [block] = parseAnswer('[Name] studies [year] [1]', {
      citeable: cite,
    });
    expect(block?.segments.filter((s) => s.kind === 'cite')).toHaveLength(1);
    expect(plainAnswer([block!])).toBe('[Name] studies [year] [1]');
  });

  it('holds back an unfinished marker while streaming but not once done', () => {
    const options = { citeable: cite };
    expect(
      plainAnswer(parseAnswer('so far [', { ...options, streaming: true })),
    ).toBe('so far ');
    expect(
      plainAnswer(parseAnswer('so far [1', { ...options, streaming: true })),
    ).toBe('so far ');
    expect(
      plainAnswer(parseAnswer('so far **bol', { ...options, streaming: true })),
    ).toBe('so far ');
    expect(
      plainAnswer(parseAnswer('so far [1]', { ...options, streaming: true })),
    ).toBe('so far [1]');
    expect(plainAnswer(parseAnswer('a * b', options))).toBe('a * b');
  });

  it('does not hold back a finished bold span at the end of the line', () => {
    const blocks = parseAnswer('x **bold**', {
      citeable: cite,
      streaming: true,
    });
    expect(blocks[0]?.segments.at(-1)).toEqual({ kind: 'bold', text: 'bold' });
  });

  it('drops blank lines', () => {
    expect(parseAnswer('a\n\nb', { citeable: cite })).toHaveLength(2);
  });
});
