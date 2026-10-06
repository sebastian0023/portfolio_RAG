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
  // null means the owner has not supplied it yet: the control is shown disabled and goes nowhere.
  readonly href: string | null;
  // The browser saves the file instead of opening it (the CV).
  readonly download?: boolean;
}

// A project the owner built. It is plain text until the owner adds an https `href`.
export interface CardProject {
  readonly id: string;
  readonly name: string;
  readonly href: string | null;
}

export interface CardProfile {
  readonly name: Slot;
  readonly initials: string;
  // Optional photo shown in the avatar circle (a same-origin file, so the CSP img-src 'self' allows it). The
  // initials stay as the fallback behind it.
  readonly avatarSrc?: string;
  readonly headline: Slot;
  readonly availability: Availability;
  readonly facts: readonly CardFact[];
  readonly links: readonly CardLink[];
  readonly projects: readonly CardProject[];
  readonly lastUpdated: Slot;
}
