import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import type { SourceCitation } from '@portfolio/shared';
import {
  DISABLED_SUGGESTIONS,
  RELATED,
  SUGGESTIONS,
} from '../../content/suggestions';
import { parseAnswer, type Block } from '../../core/chat/answer-parser';
import { ChatFacade } from '../../core/chat/chat-facade';
import type { AssistantMessage } from '../../core/chat/chat-state';
import {
  composerView,
  limitView,
  meterView,
} from '../../core/chat/view-models';
import { LayoutService } from '../../core/layout/layout.service';
import { ModalComponent } from '../../ui/modal/modal.component';

interface ExcerptPart {
  readonly text: string;
  readonly marked: boolean;
}

@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.css',
})
export class ChatPanelComponent {
  protected readonly facade = inject(ChatFacade);
  private readonly layout = inject(LayoutService);
  protected readonly suggestions = SUGGESTIONS;
  protected readonly disabledSuggestions = DISABLED_SUGGESTIONS;
  protected readonly related = RELATED;
  protected readonly meter = computed(() => meterView(this.facade.quota()));
  protected readonly limit = computed(() =>
    limitView(this.facade.quota(), this.facade.siteLimit(), new Date()),
  );
  protected readonly composer = computed(() =>
    composerView({
      input: this.facade.input(),
      busy:
        this.facade.phase() === 'submitting' ||
        this.facade.phase() === 'streaming',
      chatEnabled: this.facade.chatEnabled(),
      quota: this.facade.quota(),
      inline: this.facade.inline(),
      check: this.facade.check(),
      compact: this.layout.breakpoint() !== 'desktop',
    }),
  );

  protected blocks(message: AssistantMessage): readonly Block[] {
    return parseAnswer(message.text, {
      citeable: new Set(message.sources.map((source) => source.n)),
      unavailable: this.facade.missing(message),
      streaming: message.status === 'streaming',
    });
  }

  protected sourceIndex(message: AssistantMessage, n: number): number {
    return message.sources.findIndex((source) => source.n === n);
  }

  protected excerpt(source: SourceCitation): readonly ExcerptPart[] {
    const parts: ExcerptPart[] = [];
    let offset = 0;
    for (const range of [...source.highlights].sort(
      (a, b) => a.start - b.start,
    )) {
      if (
        range.start < offset ||
        range.end > source.excerpt.length ||
        range.end <= range.start
      )
        continue;
      if (range.start > offset)
        parts.push({
          text: source.excerpt.slice(offset, range.start),
          marked: false,
        });
      parts.push({
        text: source.excerpt.slice(range.start, range.end),
        marked: true,
      });
      offset = range.end;
    }
    if (offset < source.excerpt.length)
      parts.push({ text: source.excerpt.slice(offset), marked: false });
    return parts;
  }

  protected onInput(event: Event): void {
    this.facade.setInput((event.target as HTMLTextAreaElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!this.composer().sendDisabled && !this.facade.busy())
        void this.facade.send();
    }
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (this.facade.busy()) this.facade.stop();
    else void this.facade.send();
  }

  protected ask(question: string): void {
    void this.facade.send(question);
  }
}
