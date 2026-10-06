import type { CardProfile } from '../ui/card/card.models';

// Owner content, from the owner's public CV. `pending` is only for slots still waiting on the owner; none are
// left except where noted. Keep this in step with the knowledge base (knowledge/), which the chat answers from.
export const DISPLAY_NAME = 'Daniel';

export const PROFILE: CardProfile = {
  name: { value: 'Daniel Sebastian Macias Macias' },
  initials: 'DM',
  avatarSrc: 'avatar.jpg',
  headline: { value: 'Software engineering intern, frontend' },
  availability: 'internships',
  facts: [
    {
      icon: 'mapPin',
      label: 'Location',
      slot: { value: 'Jalisco, Mexico' },
    },
    {
      icon: 'grad',
      label: 'Studies',
      prefix: 'Systems Engineering · ITESO · ',
      slot: { value: 'expected 2027' },
    },
  ],
  links: [
    {
      id: 'gh',
      label: 'GitHub',
      icon: 'github',
      ariaLabel: `${DISPLAY_NAME} on GitHub, opens in a new tab`,
      href: 'https://github.com/sebastian0023',
    },
    {
      id: 'li',
      label: 'LinkedIn',
      icon: 'linkedin',
      ariaLabel: `${DISPLAY_NAME} on LinkedIn, opens in a new tab`,
      href: 'https://www.linkedin.com/in/daniel-sebastian-macias-macias-68217a354',
    },
  ],
  recent: [
    {
      date: { value: 'Oct 2026' },
      prefix: 'Built ',
      slot: { value: 'this portfolio with a retrieval-augmented chat' },
    },
    {
      date: { value: '2026' },
      prefix: 'Earned the ',
      slot: { value: 'AWS Academy Cloud Foundations certification' },
    },
    {
      date: { value: 'Jan 2026' },
      prefix: 'Started as a frontend intern at ',
      slot: { value: 'CORAE' },
    },
  ],
  lastUpdated: { value: 'Oct 2026' },
};
