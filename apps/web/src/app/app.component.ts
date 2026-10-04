import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';
import { environment } from '../environments/environment';
import { PROFILE } from './content/profile';
import { ChatFacade } from './core/chat/chat-facade';
import { LayoutService } from './core/layout/layout.service';
import { ThemeService } from './core/theme/theme.service';
import { ChatPanelComponent } from './features/shell/chat-panel.component';
import { HowDialogComponent } from './ui/how-dialog/how-dialog.component';
import { PresentationCardComponent } from './ui/card/presentation-card.component';
import { ThemeSwitchComponent } from './ui/theme-switch/theme-switch.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ChatPanelComponent,
    HowDialogComponent,
    PresentationCardComponent,
    ThemeSwitchComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  host: { '(document:keydown.escape)': 'onEscape($event)' },
})
export class AppComponent {
  protected readonly facade = inject(ChatFacade);
  protected readonly theme = inject(ThemeService);
  protected readonly layout = inject(LayoutService);
  protected readonly profile = PROFILE;
  protected readonly markers = environment.showPendingMarkers;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected skipToChat(event: Event): void {
    event.preventDefault();
    const target =
      this.host.nativeElement.querySelector<HTMLElement>('#chat-input, #chat');
    target?.focus();
  }

  // One Esc, resolved by what is on top: dialog, source viewer, then a running answer.
  protected onEscape(event: Event): void {
    if (this.facade.dialog()) {
      event.preventDefault();
      this.facade.closeDialog();
    } else if (this.facade.viewer()) {
      event.preventDefault();
      this.facade.closeViewer();
    } else if (this.facade.busy()) {
      event.preventDefault();
      this.facade.stop();
    }
  }
}
