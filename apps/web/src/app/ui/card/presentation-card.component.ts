import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { AvailabilityPillComponent } from './availability-pill.component';
import type { CardProfile } from './card.models';
import { FactListComponent } from './fact-list.component';
import { LinkGridComponent } from './link-grid.component';
import { RecentTimelineComponent } from './recent-timeline.component';
import { SlotComponent } from './slot.component';

// 'aside' is the desktop column; 'compact' sits above the chat on tablet and phone and keeps the
// remaining details behind "More about [Name]".
@Component({
  selector: 'app-presentation-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AvailabilityPillComponent,
    FactListComponent,
    IconComponent,
    LinkGridComponent,
    NgTemplateOutlet,
    RecentTimelineComponent,
    SlotComponent,
  ],
  templateUrl: './presentation-card.component.html',
  styleUrl: './presentation-card.component.css',
})
export class PresentationCardComponent {
  readonly profile = input.required<CardProfile>();
  readonly variant = input<'aside' | 'compact'>('aside');
  readonly compactColumns = input<2 | 4>(2);
  readonly markers = input(false);
  readonly openHow = output<void>();

  protected readonly expanded = signal(false);

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }
}
