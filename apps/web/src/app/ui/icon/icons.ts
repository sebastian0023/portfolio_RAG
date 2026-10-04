// Lucide shapes (ISC licence) used by the design, as data. Components render them as SVG elements;
// nothing here is ever passed through innerHTML (R-17).
export interface IconShape {
  readonly tag: 'path' | 'circle' | 'rect' | 'line' | 'polyline';
  readonly attrs: Readonly<Record<string, string>>;
}

export const ICON_SHAPES = {
  sparkles: [
    {
      tag: 'path',
      attrs: {
        d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
      },
    },
    { tag: 'path', attrs: { d: 'M20 3v4M22 5h-4' } },
  ],
  mapPin: [
    {
      tag: 'path',
      attrs: {
        d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
      },
    },
    { tag: 'circle', attrs: { cx: '12', cy: '10', r: '3' } },
  ],
  grad: [
    { tag: 'path', attrs: { d: 'M22 10v6M2 10l10-5 10 5-10 5z' } },
    { tag: 'path', attrs: { d: 'M6 12v5c3 3 9 3 12 0v-5' } },
  ],
  target: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '6' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '2' } },
  ],
  github: [
    {
      tag: 'path',
      attrs: {
        d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
      },
    },
    { tag: 'path', attrs: { d: 'M9 18c-4.51 2-5-2-7-2' } },
  ],
  linkedin: [
    {
      tag: 'path',
      attrs: {
        d: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z',
      },
    },
    { tag: 'rect', attrs: { width: '4', height: '12', x: '2', y: '9' } },
    { tag: 'circle', attrs: { cx: '4', cy: '4', r: '2' } },
  ],
  fileText: [
    {
      tag: 'path',
      attrs: {
        d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
      },
    },
    {
      tag: 'path',
      attrs: { d: 'M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8' },
    },
  ],
  mail: [
    {
      tag: 'rect',
      attrs: { width: '20', height: '16', x: '2', y: '4', rx: '2' },
    },
    { tag: 'path', attrs: { d: 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' } },
  ],
  ext: [
    {
      tag: 'path',
      attrs: {
        d: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
      },
    },
  ],
  checkCircle: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
    { tag: 'path', attrs: { d: 'm9 12 2 2 4-4' } },
  ],
  users: [
    { tag: 'path', attrs: { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' } },
    { tag: 'circle', attrs: { cx: '9', cy: '7', r: '4' } },
    {
      tag: 'path',
      attrs: { d: 'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    },
  ],
  minusCircle: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
    { tag: 'path', attrs: { d: 'M8 12h8' } },
  ],
  sun: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '4' } },
    {
      tag: 'path',
      attrs: {
        d: 'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
      },
    },
  ],
  moon: [{ tag: 'path', attrs: { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' } }],
  monitor: [
    {
      tag: 'rect',
      attrs: { width: '20', height: '14', x: '2', y: '3', rx: '2' },
    },
    { tag: 'path', attrs: { d: 'M8 21h8M12 17v4' } },
  ],
  arrowUp: [{ tag: 'path', attrs: { d: 'm5 12 7-7 7 7M12 19V5' } }],
  stop: [
    {
      tag: 'rect',
      attrs: { width: '12', height: '12', x: '6', y: '6', rx: '2' },
    },
  ],
  copy: [
    {
      tag: 'rect',
      attrs: { width: '14', height: '14', x: '8', y: '8', rx: '2' },
    },
    {
      tag: 'path',
      attrs: { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' },
    },
  ],
  check: [{ tag: 'path', attrs: { d: 'M20 6 9 17l-5-5' } }],
  x: [{ tag: 'path', attrs: { d: 'M18 6 6 18M6 6l12 12' } }],
  chevLeft: [{ tag: 'path', attrs: { d: 'm15 18-6-6 6-6' } }],
  chevRight: [{ tag: 'path', attrs: { d: 'm9 18 6-6-6-6' } }],
  chevDown: [{ tag: 'path', attrs: { d: 'm6 9 6 6 6-6' } }],
  shield: [
    {
      tag: 'path',
      attrs: {
        d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      },
    },
    { tag: 'path', attrs: { d: 'm9 12 2 2 4-4' } },
  ],
  alert: [
    {
      tag: 'path',
      attrs: {
        d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
      },
    },
    { tag: 'path', attrs: { d: 'M12 9v4M12 17h.01' } },
  ],
  alertCircle: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
    { tag: 'path', attrs: { d: 'M12 8v4M12 16h.01' } },
  ],
  info: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
    { tag: 'path', attrs: { d: 'M12 16v-4M12 8h.01' } },
  ],
  loader: [{ tag: 'path', attrs: { d: 'M21 12a9 9 0 1 1-6.219-8.56' } }],
  arrowDown: [{ tag: 'path', attrs: { d: 'M12 5v14M19 12l-7 7-7-7' } }],
  clock: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
    { tag: 'path', attrs: { d: 'M12 6v6l4 2' } },
  ],
  wifiOff: [
    {
      tag: 'path',
      attrs: {
        d: 'M12 20h.01M8.5 16.429a5 5 0 0 1 7 0M5 12.859a10 10 0 0 1 5.17-2.69M19 12.859a10 10 0 0 0-2.007-1.523M2 8.82a15 15 0 0 1 4.177-2.643M22 8.82a15 15 0 0 0-11.288-3.764M2 2l20 20',
      },
    },
  ],
  power: [
    {
      tag: 'path',
      attrs: {
        d: 'M18.36 6.64A9 9 0 0 1 20.77 15M6.16 6.16a9 9 0 1 0 12.68 12.68M12 2v4M2 2l20 20',
      },
    },
  ],
  login: [
    {
      tag: 'path',
      attrs: {
        d: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
      },
    },
  ],
  logout: [
    {
      tag: 'path',
      attrs: {
        d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
      },
    },
  ],
  retry: [
    {
      tag: 'path',
      attrs: { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' },
    },
    { tag: 'path', attrs: { d: 'M3 3v5h5' } },
  ],
  list: [
    {
      tag: 'path',
      attrs: { d: 'M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13' },
    },
  ],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICON_SHAPES;
