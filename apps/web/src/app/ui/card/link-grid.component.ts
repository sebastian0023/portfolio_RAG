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
              [attr.target]="isWeb(link) ? '_blank' : null"
              [attr.rel]="isWeb(link) ? 'noopener noreferrer' : null"
              [attr.download]="link.download && link.href ? '' : null"
              [attr.aria-disabled]="link.href === null ? 'true' : null"
              [attr.aria-label]="link.ariaLabel"
              [attr.data-brand]="link.id"
              [attr.title]="tooltips() ? null : hint(link)"
              (click)="onClick($event, link)"
              (mouseenter)="show(link.id)"
              (mouseleave)="hide(link.id)"
              (focus)="show(link.id)"
              (blur)="hide(link.id)"
            >
              <app-icon [name]="link.icon" />
              <span class="label">{{ link.label }}</span>
              @if (isWeb(link)) {
                <span class="ext"><app-icon name="ext" [size]="16" /></span>
              }
            </a>
            @if (tooltips() && tip() === link.id) {
              <span role="tooltip" class="tip">{{ hint(link) }}</span>
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
    /* Not available yet (no URL supplied): visibly inactive, never an accent hover. */
    a[aria-disabled='true'] {
      color: var(--text-muted);
      cursor: default;
    }
    a[aria-disabled='true']:hover {
      color: var(--text-muted);
    }
    a:active {
      box-shadow: var(--elev-pressed);
      background: var(--accent-soft);
      color: var(--accent);
    }
    /* Brand colors stay on the icon even on hover; the dark theme lightens them so they remain visible. */
    a[data-brand='gh'] app-icon:first-child {
      color: var(--brand-github);
    }
    a[data-brand='li'] app-icon:first-child {
      color: var(--brand-linkedin);
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

  protected isWeb(link: CardLink): boolean {
    return link.href !== null && /^https?:/i.test(link.href);
  }

  // What the control will do, for the tooltip and the native title.
  protected hint(link: CardLink): string {
    if (link.href === null) return 'Coming soon';
    if (link.href.startsWith('mailto:')) return 'Opens your email app';
    if (link.download) return 'Downloads a PDF';
    return 'Opens in a new tab';
  }

  protected onClick(event: Event, link: CardLink): void {
    // Links without an owner URL yet go nowhere instead of jumping to the top of the page.
    if (link.href === null) event.preventDefault();
  }
}
