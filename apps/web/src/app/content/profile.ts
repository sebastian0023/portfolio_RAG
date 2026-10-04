import type { CardProfile } from '../ui/card/card.models';

// Owner content slots. Every bracketed value is a placeholder, not a claim about the owner; the
// only fixed fact is the one the design itself states (Systems Engineering at ITESO). Replace the
// slots, drop `pending`, and the dev-only markers disappear.
export const DISPLAY_NAME = '[Name]';

export const PROFILE: CardProfile = {
  name: { value: '[Your Name]', pending: true },
  initials: '[AB]',
  headline: { value: '[Software developer]', pending: true },
  availability: 'internships',
  facts: [
    {
      icon: 'mapPin',
      label: 'Location',
      slot: { value: '[City, Region, Country]', pending: true },
    },
    {
      icon: 'grad',
      label: 'Studies',
      prefix: 'Systems Engineering · ITESO · ',
      slot: { value: '[expected graduation year]', pending: true },
    },
    {
      icon: 'target',
      label: 'Focus',
      slot: { value: '[Software development]', pending: true },
    },
  ],
  links: [
    {
      id: 'gh',
      label: 'GitHub',
      icon: 'github',
      ariaLabel: `${DISPLAY_NAME} on GitHub, opens in a new tab`,
      href: null,
    },
    {
      id: 'li',
      label: 'LinkedIn',
      icon: 'linkedin',
      ariaLabel: `${DISPLAY_NAME} on LinkedIn, opens in a new tab`,
      href: null,
    },
    {
      id: 'cv',
      label: 'Résumé (PDF)',
      icon: 'fileText',
      ariaLabel: `${DISPLAY_NAME}'s résumé (PDF), opens in a new tab`,
      href: null,
    },
    {
      id: 'ct',
      label: 'Contact',
      icon: 'mail',
      ariaLabel: `Contact page for ${DISPLAY_NAME}, opens in a new tab`,
      href: null,
    },
  ],
  recent: [
    {
      date: { value: '[Sep 2026]', pending: true },
      prefix: 'Building ',
      slot: { value: '[project name]', pending: true },
    },
    {
      date: { value: '[Aug 2026]', pending: true },
      prefix: 'Learning ',
      slot: { value: '[topic]', pending: true },
    },
    {
      date: { value: '[Jul 2026]', pending: true },
      prefix: 'Shipped ',
      slot: { value: '[thing]', pending: true },
    },
  ],
  lastUpdated: { value: '[date]', pending: true },
};
