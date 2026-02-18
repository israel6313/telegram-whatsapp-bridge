import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
    selector: 'app-toast',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="toast-stack">
            @for (toast of toastService.toasts(); track toast.id) {
                <div class="toast-item" [attr.data-type]="toast.type" (click)="toastService.dismiss(toast.id)">
                    <div class="toast-icon">
                        <i [class]="getIcon(toast.type)"></i>
                    </div>
                    <span class="toast-msg">{{ toast.message }}</span>
                    <button class="toast-close"><i class='bx bx-x'></i></button>
                </div>
            }
        </div>
    `,
    styles: [`
        .toast-stack {
            position: fixed;
            bottom: 24px;
            left: 24px;
            z-index: 9999;
            display: flex;
            flex-direction: column-reverse;
            gap: 8px;
            max-width: 420px;
        }

        .toast-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 14px 18px;
            background: var(--bg-elevated);
            border: 1px solid var(--border-default);
            border-radius: var(--radius-md);
            color: var(--text-primary);
            font-size: 14px;
            cursor: pointer;
            animation: slideIn 0.25s ease-out;
            backdrop-filter: blur(12px);
            box-shadow: var(--shadow-float);

            &[data-type="success"] { border-right: 3px solid var(--accent-green); }
            &[data-type="error"]   { border-right: 3px solid var(--accent-red); }
            &[data-type="warning"] { border-right: 3px solid var(--accent-amber); }
            &[data-type="info"]    { border-right: 3px solid var(--accent-purple); }
        }

        .toast-icon { font-size: 20px; flex-shrink: 0; display: flex; align-items: center; }
        .toast-msg { flex: 1; }
        .toast-close {
            background: none; border: none; color: var(--text-muted);
            font-size: 18px; cursor: pointer; padding: 0; display: flex; align-items: center;
            &:hover { color: var(--text-primary); }
        }

        @keyframes slideIn {
            from { transform: translateX(-20px); opacity: 0; }
            to   { transform: translateX(0); opacity: 1; }
        }
    `]
})
export class ToastComponent {
    readonly toastService = inject(ToastService);

    getIcon(type: string): string {
        switch (type) {
            case 'success': return 'bx bxs-check-circle';
            case 'error': return 'bx bxs-x-circle';
            case 'warning': return 'bx bxs-error';
            case 'info': return 'bx bxs-info-circle';
            default: return 'bx bxs-info-circle';
        }
    }
}
