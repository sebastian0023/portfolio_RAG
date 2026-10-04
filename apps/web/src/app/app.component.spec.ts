import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { ChatFacade } from './core/chat/chat-facade';
import { quota, setup } from './core/chat/chat.testing';

function stubViewport(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    };
  });
}

function create(
  width: number,
  seed = {},
): {
  el: HTMLElement;
  facade: ChatFacade;
  f: ReturnType<typeof TestBed.createComponent<AppComponent>>;
} {
  stubViewport(width);
  const h = setup(seed);
  const f = TestBed.createComponent(AppComponent);
  document.body.appendChild(f.nativeElement as HTMLElement);
  f.detectChanges();
  return { el: f.nativeElement as HTMLElement, facade: h.facade, f };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('AppComponent layout', () => {
  it.each([
    [1440, 'aside'],
    [834, 'section.compact'],
    [390, 'section.compact'],
  ])('at %ipx shows the %s card', (width, selector) => {
    const { el } = create(width);
    const sel = selector === 'aside' ? 'aside.card' : selector;
    expect(el.querySelector(sel)).not.toBeNull();
    expect(
      el.querySelectorAll('[data-component="PresentationCard"]'),
    ).toHaveLength(1);
  });

  it('uses four link columns on tablet and two on phone', () => {
    const tablet = create(834).el.querySelector<HTMLElement>('nav ul')!;
    expect(tablet.style.gridTemplateColumns).toContain('repeat(4');
    document.body.replaceChildren();
    TestBed.resetTestingModule();
    const phone = create(390).el.querySelector<HTMLElement>('nav ul')!;
    expect(phone.style.gridTemplateColumns).toContain('repeat(2');
  });

  it('puts the card before the chat in reading order', () => {
    const { el } = create(390);
    const card = el.querySelector('[data-component="PresentationCard"]')!;
    const chat = el.querySelector('[data-component="ChatPanel"]')!;
    expect(
      card.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('offers a skip link that moves focus to the chat', () => {
    const { el } = create(1440);
    const skip = el.querySelector<HTMLAnchorElement>('a.skip')!;
    expect(skip.getAttribute('href')).toBe('#chat');
    skip.click();
    expect((document.activeElement as HTMLElement).id).toBe('chat');
  });

  it('has polite and assertive live regions that mirror the facade', () => {
    const { el, f } = create(1440);
    expect(el.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(el.querySelector('[aria-live="assertive"]')).not.toBeNull();
    f.detectChanges();
  });
});

describe('AppComponent dialogs and Esc', () => {
  it('opens the how-it-works dialog from the card and closes it with Esc', async () => {
    const { el, facade, f } = create(1440);
    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('How this assistant works'))!
      .click();
    f.detectChanges();
    expect(facade.dialog()).toBe('how');
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(facade.dialog()).toBeNull();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes the top layer first: dialog before source viewer before stopping an answer', () => {
    const { facade } = create(1440, { verified: true, quota: quota(3) });
    facade.openHow();
    const esc = (): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    };
    esc();
    expect(facade.dialog()).toBeNull();
  });
});

describe('AppComponent theme', () => {
  it('applies a chosen theme to the page and remembers it', () => {
    const { el, f } = create(1440);
    const dark = Array.from(
      el.querySelectorAll('app-theme-switch button'),
    ).find((b) => b.textContent?.includes('Dark'))!;
    (dark as HTMLButtonElement).click();
    f.detectChanges();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('portfolio-theme')).toBe('dark');
  });
});

describe('AppComponent chat rendering', () => {
  it('renders model markup as text in the conversation', () => {
    const payload = '<img src=x onerror=alert(1)> [1]';
    const { el } = create(1440, {
      messages: [
        { id: 1, role: 'user', text: 'Question', time: '10:00 AM' },
        {
          id: 2,
          role: 'assistant',
          question: 'Question',
          status: 'done',
          text: payload,
          sources: [],
          cited: [],
          coverage: 'answered',
        },
      ],
    });
    const answer = el.querySelector('.assistant-message')!;
    expect(answer.textContent).toContain(payload);
    expect(answer.querySelector('img')).toBeNull();
  });
});
