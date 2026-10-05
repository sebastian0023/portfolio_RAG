// Owner content slots (bracketed text is a placeholder the owner fills in). The mock backend keys
// its canned answers on these exact strings.
export const Q_STUDYING = 'What is Daniel studying?';
export const Q_AWS = 'Which AWS services has Daniel used?';
export const Q_PROJECT = 'Tell me about a project Daniel built';
export const Q_BEST_AT = 'What is Daniel best at?';
export const Q_INTERNSHIPS = 'Is Daniel open to internships?';
export const Q_CONTACT = 'How can I contact Daniel?';

export const SUGGESTIONS: readonly string[] = [
  Q_STUDYING,
  Q_AWS,
  Q_PROJECT,
  Q_BEST_AT,
  Q_INTERNSHIPS,
  Q_CONTACT,
];

// Offered when retrieval finds nothing in the reviewed sources.
export const RELATED: readonly string[] = [Q_PROJECT, Q_AWS, Q_BEST_AT];

// Suggestions stay visible but disabled while the assistant is off.
export const DISABLED_SUGGESTIONS: readonly string[] = SUGGESTIONS.slice(0, 3);
