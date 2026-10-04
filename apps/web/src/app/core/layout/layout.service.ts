import { BreakpointObserver } from '@angular/cdk/layout';
import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

export type Breakpoint = 'desktop' | 'tablet' | 'mobile';

const DESKTOP = '(min-width: 1024px)';
const TABLET = '(min-width: 640px)';

// The design's breakpoints: 1024 and up is desktop (card beside chat), 640 to 1023 is tablet and
// below is mobile (compact card above chat).
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly observer = inject(BreakpointObserver);

  readonly breakpoint = toSignal(
    this.observer
      .observe([DESKTOP, TABLET])
      .pipe(
        map((state): Breakpoint =>
          state.breakpoints[DESKTOP]
            ? 'desktop'
            : state.breakpoints[TABLET]
              ? 'tablet'
              : 'mobile',
        ),
      ),
    { initialValue: this.current() },
  );

  private current(): Breakpoint {
    if (this.observer.isMatched(DESKTOP)) return 'desktop';
    return this.observer.isMatched(TABLET) ? 'tablet' : 'mobile';
  }
}
