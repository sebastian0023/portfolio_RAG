import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { ICON_SHAPES, type IconName, type IconShape } from './icons';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @for (shape of shapes(); track $index) {
        @switch (shape.tag) {
          @case ('circle') {
            <svg:circle
              [attr.cx]="shape.attrs['cx']"
              [attr.cy]="shape.attrs['cy']"
              [attr.r]="shape.attrs['r']"
            />
          }
          @case ('rect') {
            <svg:rect
              [attr.x]="shape.attrs['x']"
              [attr.y]="shape.attrs['y']"
              [attr.width]="shape.attrs['width']"
              [attr.height]="shape.attrs['height']"
              [attr.rx]="shape.attrs['rx']"
            />
          }
          @default {
            <svg:path [attr.d]="shape.attrs['d']" />
          }
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    svg {
      display: block;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<16 | 20 | 24 | 32>(20);

  protected readonly shapes = computed<readonly IconShape[]>(
    () => ICON_SHAPES[this.name()],
  );
}
