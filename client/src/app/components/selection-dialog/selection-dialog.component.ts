import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SelectionItem {
    id: string;
    name: string;
    subtext?: string;
}

@Component({
    selector: 'app-selection-dialog',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="overlay" (click)="close.emit()">
            <div class="dialog" (click)="$event.stopPropagation()">
                <h3 class="dialog-title">{{ title() }}</h3>
                <div class="list-container">
                    @if (loading()) {
                        <div class="state-msg"><i class='bx bx-loader-alt bx-spin'></i> טוען...</div>
                    } @else if (items().length === 0) {
                        <div class="state-msg">
                            <i class='bx bx-ghost'></i> לא נמצאו תוצאות.
                            <br><span class="sub-msg">{{ emptyText() }}</span>
                        </div>
                    } @else {
                        @for (item of items(); track item.id) {
                            <div class="list-item" (click)="select.emit(item)">
                                <div class="item-name">{{ item.name }}</div>
                                @if (item.subtext) {
                                    <div class="item-sub">{{ item.subtext }}</div>
                                }
                            </div>
                        }
                    }
                </div>
                <button class="btn btn-ghost w-100" (click)="close.emit()">ביטול</button>
            </div>
        </div>
    `,
    styles: [`
        .overlay {
            position: fixed; inset: 0; z-index: 10000;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center;
            animation: fadeIn 0.15s ease-out;
        }
        .dialog {
            background: var(--bg-elevated);
            border: 1px solid var(--border-default);
            border-radius: var(--radius-lg);
            padding: 24px;
            width: 90%; max-width: 420px;
            box-shadow: var(--shadow-float);
            animation: scaleIn 0.2s ease-out;
            display: flex; flex-direction: column; gap: 16px;
        }
        .dialog-title { font-size: 18px; font-weight: 600; text-align: center; }
        .list-container {
            max-height: 300px; overflow-y: auto;
            display: flex; flex-direction: column; gap: 8px;
        }
        .list-item {
            padding: 12px 16px;
            background: var(--bg-base);
            border: 1px solid var(--border-default);
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: all 0.2s;
            &:hover { border-color: var(--accent-purple); background: var(--bg-hover); }
        }
        .item-name { font-weight: 500; font-size: 14px; }
        .item-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        .state-msg { text-align: center; color: var(--text-secondary); padding: 20px; }
        .sub-msg { font-size: 12px; opacity: 0.7; }
        .w-100 { width: 100%; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { transform: scale(0.95); } to { transform: scale(1); } }
    `]
})
export class SelectionDialogComponent {
    title = input.required<string>();
    items = input.required<SelectionItem[]>();
    loading = input<boolean>(false);
    emptyText = input<string>('');

    close = output<void>();
    select = output<SelectionItem>();
}
