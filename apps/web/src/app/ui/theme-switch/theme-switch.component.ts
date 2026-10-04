import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';

export type ThemeValue = 'light' | 'dark' | 'system';

interface Option {
  readonly value: ThemeValue;
  readonly label: string;
  readonly icon: IconName;
}

@Component({
  selector: 'app-theme-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div role="group" aria-label="Theme" class="switch">
      @for (option of options; track option.value) {
        <button
          type="button"
          [attr.aria-pressed]="choice() === option.value"
          [class.on]="choice() === option.value"
          (click)="choose.emit(option.value)"
        >
          <app-icon [name]="option.icon" [size]="16" />
          <span>{{ option.label }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    .switch {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      border-radius: var(--radius-pill);
      background: var(--surface);
      box-shadow: var(--elev-raised-sm);
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 44px;
      padding: 0 14px;
      border: 0;
      border-radius: var(--radius-pill);
      background: transparent;
      color: var(--text-muted);
      font-size: 14px;
      line-height: 20px;
      font-weight: 600;
      cursor: pointer;
      transition:
        box-shadow var(--motion),
        color var(--motion);
    }
    button.on {
      background: var(--accent-soft);
      color: var(--accent);
      box-shadow: var(--elev-pressed);
    }
  `,
})
export class ThemeSwitchComponent {
  readonly choice = input.required<ThemeValue>();
  readonly choose = output<ThemeValue>();

  protected readonly options: readonly Option[] = [
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
    { value: 'system', label: 'System', icon: 'monitor' },
  ];
}
