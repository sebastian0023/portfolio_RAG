import type { IconName } from '../icon/icons';

export type Availability =
  'internships' | 'part-time' | 'collaborations' | 'unavailable';

// Owner-supplied text. `pending` marks a placeholder the owner still has to replace; dev builds
// flag it visibly so nothing invented slips into the published card.
export interface Slot {
  readonly value: string;
  readonly pending?: boolean;
}

export interface CardFact {
  readonly icon: IconName;
  readonly label: string;
  // Fixed text shown before the slot, such as "Systems Engineering · ITESO · ".
  readonly prefix?: string;
  readonly slot: Slot;
}

export interface CardLink {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly ariaLabel: string;
  readonly href: string | null;
}

export interface CardRecent {
  readonly date: Slot;
  readonly prefix: string;
  readonly slot: Slot;
}

export interface CardProfile {
  readonly name: Slot;
  readonly initials: string;
  readonly headline: Slot;
  readonly availability: Availability;
  readonly facts: readonly CardFact[];
  readonly links: readonly CardLink[];
  readonly recent: readonly CardRecent[];
  readonly lastUpdated: Slot;
}
