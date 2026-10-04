import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { CardFact } from './card.models';
import { SlotComponent } from './slot.component';

@Component({
  selector: 'app-fact-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SlotComponent],
  template: `
    <dl>
      @for (fact of facts(); track fact.label) {
        <div class="row">
          <dt>
            <span class="icon"><app-icon [name]="fact.icon" [size]="16" /></span
            >{{ fact.label }}
          </dt>
          <dd>
            {{ fact.prefix
            }}<app-slot
              [value]="fact.slot.value"
              [pending]="fact.slot.pending ?? false"
              [markers]="markers()"
            />
          </dd>
        </div>
      }
    </dl>
  `,
  styles: `
    dl {
      margin: 0;
      display: flex;
      flex-direction: column;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      padding: 12px 0;
      border-top: 1px solid var(--hairline);
    }
    .icon {
      flex: none;
      display: inline-flex;
      padding-top: 4px;
      color: var(--text-muted);
    }
    dt {
      flex: 0 0 100px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 14px;
      line-height: 24px;
      color: var(--text-muted);
    }
    dd {
      margin: 0;
      flex: 1 1 160px;
      min-width: 0;
      overflow-wrap: anywhere;
    }
  `,
})
export class FactListComponent {
  readonly facts = input.required<readonly CardFact[]>();
  readonly markers = input(false);
}
