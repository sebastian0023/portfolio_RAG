import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

// Owner-supplied text. In dev builds a pending placeholder gets a dashed underline and a tag.
@Component({
  selector: 'app-slot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class.pending]="marked()">{{ value() }}</span>
    @if (marked()) {
      <span class="tag" [class.tag--lg]="size() === 'lg'">Pending</span>
    }
  `,
  styles: `
    .pending {
      border-bottom: 2px dashed var(--warning);
      padding-bottom: 1px;
    }
    .tag {
      display: inline-flex;
      vertical-align: middle;
      margin-left: 6px;
      padding: 0 6px;
      border-radius: 999px;
      border: 1px solid var(--warning);
      color: var(--warning);
      font-family: var(--font-body);
      font-size: 12px;
      line-height: 16px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .tag--lg {
      margin-left: 8px;
      padding: 0 8px;
      line-height: 18px;
    }
  `,
})
export class SlotComponent {
  readonly value = input.required<string>();
  readonly pending = input(false);
  readonly markers = input(false);
  readonly size = input<'sm' | 'lg'>('sm');

  protected readonly marked = computed(() => this.pending() && this.markers());
}
