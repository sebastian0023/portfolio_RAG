import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PROFILE } from '../../content/profile';
import type { CardProfile } from './card.models';
import { PresentationCardComponent } from './presentation-card.component';

// The card's placeholder behavior (dashed markers, inert links) is tested against a template profile, not the
// live content, so filling in the owner's real details never breaks these component tests.
const TEMPLATE_PROFILE: CardProfile = {
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
      ariaLabel: `Daniel on GitHub, opens in a new tab`,
      href: null,
    },
    {
      id: 'li',
      label: 'LinkedIn',
      icon: 'linkedin',
      ariaLabel: `Daniel on LinkedIn, opens in a new tab`,
      href: null,
    },
    {
      id: 'cv',
      label: 'Résumé (PDF)',
      icon: 'fileText',
      ariaLabel: `Daniel's résumé (PDF), opens in a new tab`,
      href: null,
    },
    {
      id: 'ct',
      label: 'Contact',
      icon: 'mail',
      ariaLabel: `Contact page for Daniel, opens in a new tab`,
      href: null,
    },
  ],
  projects: [{ id: 'p1', name: '[project name]', href: null }],
  lastUpdated: { value: '[date]', pending: true },
};

function render(options: {
  variant: 'aside' | 'compact';
  markers?: boolean;
  profile?: CardProfile;
}): ComponentFixture<PresentationCardComponent> {
  const fixture = TestBed.createComponent(PresentationCardComponent);
  fixture.componentRef.setInput('profile', options.profile ?? TEMPLATE_PROFILE);
  fixture.componentRef.setInput('variant', options.variant);
  fixture.componentRef.setInput('markers', options.markers ?? false);
  fixture.detectChanges();
  return fixture;
}

const root = (f: ComponentFixture<unknown>): HTMLElement =>
  f.nativeElement as HTMLElement;
const text = (f: ComponentFixture<unknown>): string =>
  root(f).textContent ?? '';

beforeEach(() => TestBed.resetTestingModule());

describe('the live profile', () => {
  // Controls the owner has not supplied yet. Remove an id here when its URL is set (the CV needs the PDF).
  const AWAITING = new Set(['cv']);

  it('has no placeholder, pending slot, or dead link', () => {
    const json = JSON.stringify(PROFILE);
    expect(json).not.toMatch(/\[[A-Za-z][^\]"]*\]/);
    expect(json).not.toContain('"pending"');
    expect(json).not.toContain('"recent"');
    for (const link of PROFILE.links) {
      if (AWAITING.has(link.id)) expect(link.href, link.id).toBeNull();
      else expect(link.href, link.id).toMatch(/^(https:\/\/|mailto:)/);
    }
    for (const project of PROFILE.projects) {
      if (project.href !== null)
        expect(project.href, project.id).toMatch(/^https:\/\//);
    }
  });

  it('renders the owner name and the real links', () => {
    const f = render({ variant: 'aside', profile: PROFILE });
    expect(text(f)).toContain('Daniel Sebastian Macias Macias');
    expect(text(f)).not.toMatch(/\[[^\]]+\]/);
    const anchors = Array.from(
      root(f).querySelectorAll<HTMLAnchorElement>('nav a'),
    );
    expect(anchors.map((a) => a.getAttribute('data-brand'))).toEqual([
      'gh',
      'li',
      'em',
      'cv',
    ]);
    expect(anchors[0]?.getAttribute('href')).toBe(
      'https://github.com/sebastian0023',
    );
    expect(anchors[2]?.getAttribute('href')).toMatch(
      /^mailto:[^@\s]+@[^@\s]+$/,
    );
  });
});

describe('email and CV buttons', () => {
  const links = (f: ComponentFixture<unknown>) =>
    Array.from(root(f).querySelectorAll<HTMLAnchorElement>('nav a'));

  it('opens an email draft without opening a new tab', () => {
    const email = links(render({ variant: 'aside', profile: PROFILE }))[2]!;
    expect(email.getAttribute('aria-label')).toBe('Email Daniel');
    expect(email.getAttribute('href')).toMatch(/^mailto:/);
    expect(email.hasAttribute('target')).toBe(false);
    expect(email.querySelector('.ext')).toBeNull();
  });

  it('shows the CV as disabled until the PDF exists, and it goes nowhere', () => {
    const f = render({ variant: 'aside', profile: PROFILE });
    const cv = links(f)[3]!;
    expect(cv.getAttribute('aria-label')).toBe("Download Daniel's CV (PDF)");
    expect(cv.getAttribute('aria-disabled')).toBe('true');
    expect(cv.hasAttribute('download')).toBe(false);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    cv.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    cv.dispatchEvent(new FocusEvent('focus'));
    f.detectChanges();
    expect(root(f).querySelector('[role="tooltip"]')?.textContent).toContain(
      'Coming soon',
    );
  });

  it('becomes a real download as soon as a PDF address is set', () => {
    const profile: CardProfile = {
      ...PROFILE,
      links: PROFILE.links.map((l) =>
        l.id === 'cv' ? { ...l, href: 'daniel-macias-cv.pdf' } : l,
      ),
    };
    const f = render({ variant: 'aside', profile });
    const cv = links(f)[3]!;
    expect(cv.getAttribute('href')).toBe('daniel-macias-cv.pdf');
    expect(cv.hasAttribute('download')).toBe(true);
    expect(cv.hasAttribute('aria-disabled')).toBe(false);
    cv.dispatchEvent(new FocusEvent('focus'));
    f.detectChanges();
    expect(root(f).querySelector('[role="tooltip"]')?.textContent).toContain(
      'Downloads a PDF',
    );
  });

  it('keeps all four buttons in the compact card too', () => {
    const f = render({ variant: 'compact', profile: PROFILE });
    expect(links(f)).toHaveLength(4);
  });
});

describe('projects', () => {
  it('lists the project names in place of the old timeline, as plain text while they have no link', () => {
    const f = render({ variant: 'aside', profile: PROFILE });
    expect(text(f)).toContain('Projects');
    expect(text(f)).not.toContain('Recently');
    for (const project of PROFILE.projects)
      expect(text(f)).toContain(project.name);
    expect(
      root(f).querySelectorAll('section[aria-labelledby="projects-heading"] a'),
    ).toHaveLength(0);
  });

  it('turns a project into a safe external link once an https address is set', () => {
    const profile: CardProfile = {
      ...PROFILE,
      projects: PROFILE.projects.map((p, i) =>
        i === 1
          ? { ...p, href: 'https://github.com/sebastian0023/relationship-rag' }
          : p,
      ),
    };
    const f = render({ variant: 'aside', profile });
    const anchors = root(f).querySelectorAll<HTMLAnchorElement>(
      'section[aria-labelledby="projects-heading"] a',
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.target).toBe('_blank');
    expect(anchors[0]?.rel).toContain('noopener');
    expect(anchors[0]?.getAttribute('aria-label')).toBe(
      'Relationship RAG, opens in a new tab',
    );
  });
});

describe('avatar and link brand colors', () => {
  it('shows the photo inside both avatars, decorative and same-origin, with the initials behind it', () => {
    for (const variant of ['aside', 'compact'] as const) {
      TestBed.resetTestingModule();
      const f = render({ variant, profile: PROFILE });
      const img = root(f).querySelector<HTMLImageElement>('.avatar img');
      expect(img, variant).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('avatar.jpg');
      expect(img?.getAttribute('alt')).toBe('');
      expect(root(f).querySelector('.avatar')?.textContent).toContain('DM');
    }
  });

  it('shows no image when the profile has no photo', () => {
    const f = render({ variant: 'aside', profile: TEMPLATE_PROFILE });
    expect(root(f).querySelector('.avatar img')).toBeNull();
  });

  it('tags every link with its id, so GitHub and LinkedIn can take their brand colors', () => {
    const f = render({ variant: 'aside', profile: PROFILE });
    const brands = Array.from(
      root(f).querySelectorAll<HTMLAnchorElement>('nav a'),
    ).map((a) => a.getAttribute('data-brand'));
    // Only GitHub and LinkedIn get brand colors (CSS keys on these two ids); email and CV use the normal text color.
    expect(brands).toEqual(['gh', 'li', 'em', 'cv']);
  });

  it('has no Focus line in the live card', () => {
    const f = render({ variant: 'aside', profile: PROFILE });
    expect(text(f)).not.toContain('Focus');
  });
});

describe('PresentationCardComponent', () => {
  it('shows the owner placeholders as plain text without markers in a clean build', () => {
    const f = render({ variant: 'aside' });
    expect(text(f)).toContain('[Your Name]');
    expect(text(f)).not.toContain('Pending');
    expect(root(f).querySelector('.pending')).toBeNull();
  });

  it('flags every pending slot when markers are on, and only pending ones', () => {
    const f = render({ variant: 'aside', markers: true });
    const tags = root(f).querySelectorAll('.tag');
    // name, headline, location, graduation year, focus, last updated
    expect(tags.length).toBe(6);
    // The fixed fact the design states is never marked.
    expect(
      Array.from(root(f).querySelectorAll('dd'))
        .map((dd) => dd.textContent)
        .join(' '),
    ).toContain('Systems Engineering · ITESO ·');
    expect(text(f)).toContain(
      'Systems Engineering · ITESO · [expected graduation year]',
    );
  });

  it('keeps public links keyboard reachable, with descriptive names, and web links in a new tab', () => {
    const f = render({ variant: 'aside', profile: PROFILE });
    const links = Array.from(
      root(f).querySelectorAll<HTMLAnchorElement>('nav a'),
    );
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Daniel on GitHub, opens in a new tab',
      'Daniel on LinkedIn, opens in a new tab',
      'Email Daniel',
      "Download Daniel's CV (PDF)",
    ]);
    for (const a of links) expect(a.tabIndex).toBe(0);
    for (const a of links.slice(0, 2)) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
    }
  });

  it('does not navigate when a link has no owner URL yet', () => {
    const f = render({ variant: 'aside' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    root(f).querySelector('nav a')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('shows a tooltip on focus for the desktop card and none for the compact card', () => {
    const aside = render({ variant: 'aside', profile: PROFILE });
    root(aside).querySelector('nav a')!.dispatchEvent(new FocusEvent('focus'));
    aside.detectChanges();
    expect(
      root(aside).querySelector('[role="tooltip"]')?.textContent,
    ).toContain('Opens in a new tab');

    TestBed.resetTestingModule();
    const compact = render({ variant: 'compact', profile: PROFILE });
    root(compact)
      .querySelector('nav a')!
      .dispatchEvent(new FocusEvent('focus'));
    compact.detectChanges();
    expect(root(compact).querySelector('[role="tooltip"]')).toBeNull();
  });

  it('reveals details in the compact card only after the visitor asks, and reflects it in aria-expanded', () => {
    const f = render({ variant: 'compact' });
    const toggle = root(f).querySelector<HTMLButtonElement>('button.expand')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(text(f)).not.toContain('Projects');

    toggle.click();
    f.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(text(f)).toContain('Projects');
    expect(text(f)).toContain('Location');

    toggle.click();
    f.detectChanges();
    expect(text(f)).not.toContain('Projects');
  });

  it('exposes one h1 and labels the region with the owner name', () => {
    for (const variant of ['aside', 'compact'] as const) {
      TestBed.resetTestingModule();
      const f = render({ variant });
      expect(root(f).querySelectorAll('h1')).toHaveLength(1);
      expect(
        root(f).querySelector('[aria-label="About [Your Name]"]'),
      ).not.toBeNull();
    }
  });

  it('emits openHow from the footer link', () => {
    const f = render({ variant: 'aside' });
    let opened = 0;
    f.componentInstance.openHow.subscribe(() => opened++);
    const how = Array.from(root(f).querySelectorAll('button')).find((b) =>
      b.textContent?.includes('How this assistant works'),
    );
    how!.click();
    expect(opened).toBe(1);
  });
});
