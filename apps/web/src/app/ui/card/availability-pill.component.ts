import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';
import type { Availability } from './card.models';

interface Look {
  readonly label: string;
  readonly icon: IconName;
  readonly color: string;
}

const LOOKS: Readonly<Record<Availability, Look>> = {
  internships: {
    label: 'Open to internships',
    icon: 'checkCircle',
    color: 'var(--success)',
  },
  'part-time': {
    label: 'Open to part-time roles',
    icon: 'checkCircle',
    color: 'var(--success)',
  },
  collaborations: {
    label: 'Open to collaborations',
    icon: 'users',
    color: 'var(--accent)',
  },
  unavailable: {
    label: 'Not available right now',
    icon: 'minusCircle',
    color: 'var(--text-muted)',
  },
};

@Component({
  selector: 'app-availability-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <span class="pill" data-component="AvailabilityPill">
      <span class="icon" [style.color]="look().color"
        ><app-icon [name]="look().icon"
      /></span>
      {{ look().label }}
    </span>
  `,
  styles: `
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 6px 14px;
      border-radius: var(--radius-pill);
      background: var(--surface);
      box-shadow: var(--elev-raised-sm);
      font-size: 14px;
      line-height: 20px;
      font-weight: 600;
    }
    .icon {
      display: inline-flex;
    }
  `,
})
export class AvailabilityPillComponent {
  readonly status = input.required<Availability>();
  protected readonly look = computed(() => LOOKS[this.status()]);
}
