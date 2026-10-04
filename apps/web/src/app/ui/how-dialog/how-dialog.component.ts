import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';
import { ModalComponent } from '../modal/modal.component';

interface Point {
  readonly icon: IconName;
  readonly text: string;
  // Wording the owner still has to confirm before launch.
  readonly confirm?: boolean;
}

@Component({
  selector: 'app-how-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ModalComponent],
  template: `
    <app-modal
      labelledBy="how-title"
      [maxWidth]="500"
      (dismissed)="closed.emit()"
    >
      <div class="head">
        <h2 id="how-title">How this assistant works</h2>
        <button
          type="button"
          class="neu-round"
          aria-label="Close"
          (click)="closed.emit()"
        >
          <app-icon name="x" />
        </button>
      </div>
      <ul>
        @for (point of points(); track point.text) {
          <li>
            <span class="icon"><app-icon [name]="point.icon" /></span>
            <span>
              {{ point.text }}
              @if (point.confirm && markers()) {
                <span class="confirm">[Owner to confirm this wording]</span>
              }
            </span>
          </li>
        }
      </ul>
      <button type="button" class="neu-btn close" (click)="closed.emit()">
        Close
      </button>
    </app-modal>
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    h2 {
      margin: 0;
      font-family: var(--font-head);
      font-weight: 600;
      font-size: 24px;
      line-height: 32px;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    li {
      display: flex;
      gap: 12px;
    }
    .icon {
      flex: none;
      display: inline-flex;
      color: var(--accent);
    }
    .confirm {
      font-size: 12px;
      color: var(--warning);
      font-weight: 600;
    }
    .close {
      align-self: flex-end;
    }
  `,
})
export class HowDialogComponent {
  readonly name = input.required<string>();
  readonly markers = input(false);
  readonly closed = output<void>();

  protected readonly points = () =>
    [
      {
        icon: 'fileText',
        text: `Answers come only from documents ${this.name()} has reviewed and published.`,
      },
      { icon: 'list', text: 'Every answer lists the sources it used.' },
      {
        icon: 'alert',
        text: 'The assistant can be wrong, so check the sources.',
      },
      {
        icon: 'shield',
        text: 'The text of your questions is not stored, only how many you ask.',
        confirm: true,
      },
    ] satisfies readonly Point[];
}
