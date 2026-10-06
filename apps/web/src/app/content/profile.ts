import type { CardProfile } from '../ui/card/card.models';

// Owner content, from the owner's public CV. `pending` is only for slots still waiting on the owner; none are
// left except where noted. Keep this in step with the knowledge base (knowledge/), which the chat answers from.
export const DISPLAY_NAME = 'Daniel';

export const PROFILE: CardProfile = {
  name: { value: 'Daniel Sebastian Macias' },
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
    {
      id: 'em',
      label: 'Email',
      icon: 'mail',
      ariaLabel: `Email ${DISPLAY_NAME}`,
      href: 'mailto:sebastian.macias@iteso.mx',
    },
    {
      id: 'cv',
      label: 'CV',
      icon: 'fileText',
      ariaLabel: `Download ${DISPLAY_NAME}'s CV (PDF)`,
      // Waiting for the PDF: set this to the hosted file (for example 'daniel-macias-cv.pdf') and the button works.
      href: null,
      download: true,
    },
  ],
  // Names only. To link a project, set its `href` to an https URL; until then it is shown as plain text.
  projects: [
    {
      id: 'image-classification',
      name: 'Image Classification Platform',
      href: null,
    },
    { id: 'relationship-rag', name: 'Relationship RAG', href: null },
    {
      id: 'serverless-portfolio',
      name: 'Serverless AI Portfolio with RAG Chat',
      href: null,
    },
    { id: 'lift', name: 'Lift, Workout Tracking PWA', href: null },
  ],
  lastUpdated: { value: 'Oct 2026' },
};
