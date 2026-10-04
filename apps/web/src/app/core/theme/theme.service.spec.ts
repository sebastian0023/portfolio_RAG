import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });
  afterEach(() => localStorage.clear());

  it('defaults to the system preference', () => {
    const service = TestBed.inject(ThemeService);
    expect(service.choice()).toBe('system');
    expect(['light', 'dark']).toContain(service.resolved());
  });

  it('applies and persists an explicit choice', () => {
    const service = TestBed.inject(ThemeService);
    service.set('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('portfolio-theme')).toBe('dark');
  });

  it('ignores an unknown stored value', () => {
    localStorage.setItem('portfolio-theme', 'purple');
    expect(TestBed.inject(ThemeService).choice()).toBe('system');
  });
});
