import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { CardLink } from './card.models';

@Component({
  selector: 'app-link-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <nav aria-label="Public links">
      <ul
        role="list"
        [style.grid-template-columns]="
          'repeat(' + columns() + ', minmax(0, 1fr))'
        "
      >
        @for (link of links(); track link.id) {
          <li>
            <a
              [attr.href]="link.href ?? '#'"
              target="_blank"
              rel="noopener noreferrer"
              [attr.aria-label]="link.ariaLabel"
              [attr.title]="tooltips() ? null : 'Opens in a new tab'"
              (click)="onClick($event, link)"
              (mouseenter)="show(link.id)"
              (mouseleave)="hide(link.id)"
              (focus)="show(link.id)"
              (blur)="hide(link.id)"
            >
              <app-icon [name]="link.icon" />
              <span class="label">{{ link.label }}</span>
              <span class="ext"><app-icon name="ext" [size]="16" /></span>
            </a>
            @if (tooltips() && tip() === link.id) {
              <span role="tooltip" class="tip">Opens in a new tab</span>
            }
          </li>
        }
      </ul>
    </nav>
  `,
  styles: `
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 12px;
    }
    li {
      position: relative;
      min-width: 0;
    }
    a {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      padding: 10px 12px 10px 14px;
      border-radius: var(--radius-control);
      background: var(--surface);
      box-shadow: var(--elev-raised-sm);
      color: var(--text);
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      line-height: 20px;
      transition:
        box-shadow var(--motion),
        color var(--motion);
    }
    a:hover {
      color: var(--accent);
    }
    a:active {
      box-shadow: var(--elev-pressed);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .label {
      flex: 1;
      min-width: 0;
    }
    .ext {
      display: inline-flex;
      color: var(--text-muted);
    }
    .tip {
      position: absolute;
      z-index: 20;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      padding: 6px 10px;
      border-radius: 8px;
      background: var(--text);
      color: var(--surface);
      font-size: 12px;
      line-height: 16px;
      white-space: nowrap;
      pointer-events: none;
    }
  `,
})
export class LinkGridComponent {
  readonly links = input.required<readonly CardLink[]>();
  readonly columns = input<2 | 4>(2);
  readonly tooltips = input(false);

  protected readonly tip = signal<string | null>(null);

  protected show(id: string): void {
    this.tip.set(id);
  }

  protected hide(id: string): void {
    this.tip.update((current) => (current === id ? null : current));
  }

  protected onClick(event: Event, link: CardLink): void {
    // Links without an owner URL yet go nowhere instead of jumping to the top of the page.
    if (link.href === null) event.preventDefault();
  }
}
