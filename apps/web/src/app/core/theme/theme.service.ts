import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'portfolio-theme';
const CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system'];

function isChoice(value: unknown): value is ThemeChoice {
  return (
    typeof value === 'string' && (CHOICES as readonly string[]).includes(value)
  );
}

// Owns the Light/Dark/System choice and mirrors the resolved theme onto <html data-theme>.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly query = this.document.defaultView?.matchMedia?.(
    '(prefers-color-scheme: dark)',
  );
  private readonly systemDark = signal(this.query?.matches ?? false);

  readonly choice = signal<ThemeChoice>(this.read());
  readonly resolved = computed<ResolvedTheme>(() => {
    const choice = this.choice();
    if (choice === 'system') return this.systemDark() ? 'dark' : 'light';
    return choice;
  });

  constructor() {
    this.query?.addEventListener('change', (event) =>
      this.systemDark.set(event.matches),
    );
    this.apply();
  }

  // persist: false applies the theme for this visit only (the scenario harness uses it).
  set(choice: ThemeChoice, options: { persist?: boolean } = {}): void {
    this.choice.set(choice);
    if (options.persist !== false) {
      try {
        this.document.defaultView?.localStorage.setItem(STORAGE_KEY, choice);
      } catch {
        // Storage can be blocked; the choice still applies for this visit.
      }
    }
    this.apply();
  }

  // Called by the shell whenever the system preference may have changed.
  apply(): void {
    const root = this.document.documentElement;
    root.setAttribute('data-theme', this.resolved());
    root.style.colorScheme = this.resolved();
  }

  private read(): ThemeChoice {
    try {
      const stored =
        this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (isChoice(stored)) return stored;
    } catch {
      // Fall through to the default.
    }
    return 'system';
  }
}
