import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmService } from '../../services/confirm.service';

@Component({
    selector: 'app-confirm-dialog',
    standalone: true,
    imports: [CommonModule],
    template: `
        @if (confirmService.options(); as opts) {
            <div class="overlay" (click)="confirmService.respond(false)">
                <div class="dialog" (click)="$event.stopPropagation()">
                    <h3 class="dialog-title">{{ opts.title }}</h3>
                    <p class="dialog-message">{{ opts.message }}</p>
                    <div class="dialog-actions">
                        <button class="btn btn-ghost" (click)="confirmService.respond(false)">
                            {{ opts.cancelText || 'ביטול' }}
                        </button>
                        <button
                            class="btn"
                            [class.btn-danger]="opts.danger"
                            [class.btn-primary]="!opts.danger"
                            (click)="confirmService.respond(true)">
                            {{ opts.confirmText || 'אישור' }}
                        </button>
                    </div>
                </div>
            </div>
        }
    `,
    styles: [`
        .overlay {
            position: fixed;
            inset: 0;
            z-index: 10000;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.15s ease-out;
        }

        .dialog {
            background: var(--bg-elevated);
            border: 1px solid var(--border-default);
            border-radius: var(--radius-lg);
            padding: 28px;
            min-width: 360px;
            max-width: 460px;
            box-shadow: var(--shadow-float);
            animation: scaleIn 0.2s ease-out;
        }

        .dialog-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .dialog-message {
            font-size: 14px;
            color: var(--text-secondary);
            line-height: 1.6;
            margin-bottom: 24px;
        }

        .dialog-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-start;
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes scaleIn {
            from { transform: scale(0.95); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
    `]
})
export class ConfirmDialogComponent {
    readonly confirmService = inject(ConfirmService);
}
