import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CardRecent } from './card.models';
import { SlotComponent } from './slot.component';

@Component({
  selector: 'app-recent-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SlotComponent],
  template: `
    <section aria-labelledby="recent-heading">
      <h2 id="recent-heading" class="eyebrow">Recently</h2>
      <ol>
        @for (item of items(); track item.date.value) {
          <li>
            <span class="dot" aria-hidden="true"></span>
            <span class="date">
              <app-slot
                [value]="item.date.value"
                [pending]="item.date.pending ?? false"
                [markers]="markers()"
              />
            </span>
            <span>
              {{ item.prefix
              }}<app-slot
                [value]="item.slot.value"
                [pending]="item.slot.pending ?? false"
                [markers]="markers()"
              />
            </span>
          </li>
        }
      </ol>
    </section>
  `,
  styles: `
    section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    ol {
      list-style: none;
      margin: 0 0 0 6px;
      padding: 0 0 0 20px;
      border-left: 2px solid var(--hairline);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    li {
      position: relative;
      display: flex;
      flex-direction: column;
    }
    .dot {
      position: absolute;
      left: -28px;
      top: 6px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--surface);
      box-shadow:
        2px 2px 4px var(--shadow-dark),
        -2px -2px 4px var(--shadow-light);
      border: 2px solid var(--accent);
    }
    .date {
      font-size: 14px;
      line-height: 20px;
      font-weight: 600;
      color: var(--text-muted);
    }
  `,
})
export class RecentTimelineComponent {
  readonly items = input.required<readonly CardRecent[]>();
  readonly markers = input(false);
}
