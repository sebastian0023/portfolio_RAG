import { isAllowedSourceUrl } from '@portfolio/shared';
import type { Finding } from './config.js';

// Rejects what must never be in a public corpus (ADR-031, R-17). It reports the rule and the line only: a finding
// that echoed the match would put the private value into CI logs.

export interface ScanOptions {
  readonly path: string;
  readonly allowedHosts: readonly string[];
  readonly allowedEmails?: readonly string[];
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE = /(?<![\w/])\+?\d[\d\s().-]{7,}\d(?![\w/])/g;
const ADDRESS =
  /\b\d{1,5}\s+(?:[A-Z][\w.']*\s+){1,3}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|calle|avenida)\b/i;
const POSTAL = /\b(?:zip|postal code|c\.?p\.?)\s*:?\s*\d{4,6}\b/i;
const SECRETS = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /(?<![A-Za-z0-9/])[A-Za-z0-9+/_=-]{40,}(?![A-Za-z0-9/])/,
];
const HTML = /<\/?[a-z][^>]*>|<!--/i;
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)>\]"']+|\bjavascript:/gi;
const INJECTION = [
  /ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|prompts?)/i,
  /disregard\s+.{0,40}(?:instructions|rules|prompt)/i,
  /(?:reveal|show|print|repeat)\s+.{0,30}(?:system\s+prompt|instructions)/i,
  /\byou\s+are\s+now\b/i,
  /\bsystem\s+prompt\b/i,
];
// Inline citation markers belong to the model's answer, never to a source (ADR-054).
const MARKER = /\[\d+\]/;

function digitCount(text: string): number {
  return text.replace(/\D/g, '').length;
}

function looksLikeDateOrYears(text: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{4}\s*[-–]\s*\d{4}$/.test(text)
  );
}

export function scanPublicSafety(raw: string, options: ScanOptions): Finding[] {
  const findings: Finding[] = [];
  const allowedEmails = new Set(
    (options.allowedEmails ?? []).map((e) => e.toLowerCase()),
  );
  raw.split('\n').forEach((line, i) => {
    const add = (rule: string): void => {
      findings.push({ path: options.path, rule, line: i + 1 });
    };
    for (const email of line.match(EMAIL) ?? []) {
      if (!allowedEmails.has(email.toLowerCase())) {
        add('email');
        break;
      }
    }
    for (const phone of line.match(PHONE) ?? []) {
      if (digitCount(phone) >= 9 && !looksLikeDateOrYears(phone.trim())) {
        add('phone');
        break;
      }
    }
    if (ADDRESS.test(line) || POSTAL.test(line)) add('address');
    if (SECRETS.some((pattern) => pattern.test(line))) add('secret');
    if (HTML.test(line)) add('html');
    for (const url of line.match(URL_IN_TEXT) ?? []) {
      if (!isAllowedSourceUrl(url, options.allowedHosts)) {
        add('link');
        break;
      }
    }
    if (INJECTION.some((pattern) => pattern.test(line))) add('injection');
    if (MARKER.test(line)) add('marker');
  });
  return findings;
}
