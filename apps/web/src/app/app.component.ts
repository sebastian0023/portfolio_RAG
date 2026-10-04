import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
} from '@angular/core';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1>Ask Portfolio</h1>
      <p>Theme: {{ theme.resolved() }}</p>
    </main>
  `,
})
export class AppComponent {
  protected readonly theme = inject(ThemeService);

  constructor() {
    // Keep <html data-theme> in step with the signal.
    effect(() => {
      this.theme.resolved();
      this.theme.apply();
    });
  }
}
