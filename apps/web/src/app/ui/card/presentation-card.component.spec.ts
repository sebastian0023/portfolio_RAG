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
  it('has no placeholder, pending slot, or dead link', () => {
    const json = JSON.stringify(PROFILE);
    expect(json).not.toMatch(/\[[A-Za-z][^\]"]*\]/);
    expect(json).not.toContain('"pending"');
    for (const link of PROFILE.links) {
      expect(link.href, link.id).toMatch(/^https:\/\//);
    }
  });

  it('renders the owner name and real links', () => {
    const f = render({ variant: 'aside', profile: PROFILE });
    expect(text(f)).toContain('Daniel Sebastian Macias Macias');
    expect(text(f)).not.toMatch(/\[[^\]]+\]/);
    const hrefs = Array.from(
      root(f).querySelectorAll<HTMLAnchorElement>('nav a'),
    ).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(PROFILE.links.map((l) => l.href));
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

  it('tags the GitHub and LinkedIn links so each icon gets its brand color', () => {
    const f = render({ variant: 'aside', profile: PROFILE });
    const brands = Array.from(
      root(f).querySelectorAll<HTMLAnchorElement>('nav a'),
    ).map((a) => a.getAttribute('data-brand'));
    expect(brands).toEqual(['gh', 'li']);
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
    // name, headline, location, graduation year, focus, 3 dates, 3 recent items, last updated
    expect(tags.length).toBe(12);
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

  it('keeps public links keyboard reachable, in a new tab, with descriptive names', () => {
    const f = render({ variant: 'aside' });
    const links = Array.from(
      root(f).querySelectorAll<HTMLAnchorElement>('nav a'),
    );
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Daniel on GitHub, opens in a new tab',
      'Daniel on LinkedIn, opens in a new tab',
      "Daniel's résumé (PDF), opens in a new tab",
      'Contact page for Daniel, opens in a new tab',
    ]);
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
      expect(a.tabIndex).toBe(0);
    }
  });

  it('does not navigate when a link has no owner URL yet', () => {
    const f = render({ variant: 'aside' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    root(f).querySelector('nav a')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('shows a tooltip on focus for the desktop card and none for the compact card', () => {
    const aside = render({ variant: 'aside' });
    root(aside).querySelector('nav a')!.dispatchEvent(new FocusEvent('focus'));
    aside.detectChanges();
    expect(
      root(aside).querySelector('[role="tooltip"]')?.textContent,
    ).toContain('Opens in a new tab');

    TestBed.resetTestingModule();
    const compact = render({ variant: 'compact' });
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
    expect(text(f)).not.toContain('Recently');

    toggle.click();
    f.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(text(f)).toContain('Recently');
    expect(text(f)).toContain('Location');

    toggle.click();
    f.detectChanges();
    expect(text(f)).not.toContain('Recently');
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
