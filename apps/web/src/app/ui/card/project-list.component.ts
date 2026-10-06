import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { CardProject } from './card.models';

@Component({
  selector: 'app-project-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <section aria-labelledby="projects-heading">
      <h2 id="projects-heading" class="eyebrow">Projects</h2>
      <ul role="list">
        @for (project of projects(); track project.id) {
          <li>
            @if (project.href; as href) {
              <a
                [href]="href"
                target="_blank"
                rel="noopener noreferrer"
                [attr.aria-label]="project.name + ', opens in a new tab'"
              >
                <span class="name">{{ project.name }}</span>
                <app-icon name="ext" [size]="16" />
              </a>
            } @else {
              <span class="plain">{{ project.name }}</span>
            }
          </li>
        }
      </ul>
    </section>
  `,
  styles: `
    section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    li {
      position: relative;
      padding-left: 20px;
    }
    li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 9px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 2px solid var(--accent);
      box-sizing: border-box;
    }
    a {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text);
      font-weight: 600;
      text-decoration: none;
    }
    a:hover {
      color: var(--accent);
    }
    a app-icon {
      color: var(--text-muted);
    }
    .plain {
      font-weight: 600;
    }
  `,
})
export class ProjectListComponent {
  readonly projects = input.required<readonly CardProject[]>();
}
