import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

// Scrim plus a centered dialog. The focus trap captures focus when the dialog opens and gives it
// back to the opener when it goes away. Esc is handled once, in the app shell.
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkTrapFocus],
  template: `
    <div class="scrim" role="presentation" (click)="onScrim($event)">
      <div
        #panel
        class="panel"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        [attr.aria-labelledby]="labelledBy()"
        [style.max-width.px]="maxWidth()"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
      >
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .scrim {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: grid;
      place-items: center;
      padding: 16px;
      background: var(--scrim);
      animation: dcFade 180ms ease-out;
    }
    .panel {
      width: 100%;
      max-height: 100%;
      overflow-y: auto;
      background: var(--surface);
      border-radius: var(--radius-panel);
      box-shadow: var(--elev-raised);
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
  `,
})
export class ModalComponent implements AfterViewInit {
  readonly labelledBy = input.required<string>();
  readonly maxWidth = input(440);
  readonly dismissed = output<void>();
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly opener = document.activeElement as HTMLElement | null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.opener?.focus());
  }

  ngAfterViewInit(): void {
    const panel = this.panel().nativeElement;
    (
      panel.querySelector<HTMLElement>('button, [href], input, textarea') ??
      panel
    ).focus();
  }

  protected onScrim(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.dismissed.emit();
  }
}
