import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  ThemeSwitchComponent,
  type ThemeValue,
} from './theme-switch.component';

describe('ThemeSwitchComponent', () => {
  it('marks only the active choice as pressed and emits the clicked one', () => {
    const f = TestBed.createComponent(ThemeSwitchComponent);
    f.componentRef.setInput('choice', 'dark');
    f.detectChanges();
    const chosen: ThemeValue[] = [];
    f.componentInstance.choose.subscribe((v) => chosen.push(v));
    const buttons = Array.from(
      (f.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    buttons[2]!.click();
    expect(chosen).toEqual(['system']);
  });
});
