import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ModalComponent } from './modal.component';

@Component({
  imports: [ModalComponent],
  template: `
    <button id="opener">open</button>
    @if (open()) {
      <app-modal labelledBy="t" (dismissed)="dismissed = dismissed + 1">
        <h2 id="t">Title</h2>
        <button id="inside">inside</button>
      </app-modal>
    }
  `,
})
class HostComponent {
  open = signal(true);
  dismissed = 0;
}

describe('ModalComponent', () => {
  it('is a labelled modal dialog and captures focus inside', async () => {
    const f = TestBed.createComponent(HostComponent);
    document.body.appendChild(f.nativeElement as HTMLElement);
    f.detectChanges();
    await f.whenStable();
    const dialog = (f.nativeElement as HTMLElement).querySelector(
      '[role="dialog"]',
    )!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('t');
    expect(dialog.contains(document.activeElement)).toBe(true);
    f.nativeElement.remove();
  });

  it('dismisses on a scrim click but not on a click inside the panel', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    el.querySelector<HTMLElement>('#inside')!.click();
    expect(f.componentInstance.dismissed).toBe(0);
    el.querySelector<HTMLElement>('.scrim')!.click();
    expect(f.componentInstance.dismissed).toBe(1);
  });

  it('hands focus back to the opener when it closes', async () => {
    const f = TestBed.createComponent(HostComponent);
    document.body.appendChild(f.nativeElement as HTMLElement);
    f.componentInstance.open.set(false);
    f.detectChanges();
    const opener = (f.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '#opener',
    )!;
    opener.focus();
    f.componentInstance.open.set(true);
    f.detectChanges();
    await f.whenStable();
    expect(
      (f.nativeElement as HTMLElement).querySelector('[role="dialog"]'),
    ).not.toBeNull();
    expect(document.activeElement).not.toBe(opener);
    f.componentInstance.open.set(false);
    f.detectChanges();
    await f.whenStable();
    expect(document.activeElement).toBe(opener);
    f.nativeElement.remove();
  });
});
