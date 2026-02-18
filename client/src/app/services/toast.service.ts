import { Injectable, signal } from '@angular/core';

export interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
    readonly toasts = signal<Toast[]>([]);
    private _nextId = 0;

    show(message: string, type: Toast['type'] = 'info', duration = 4000) {
        const id = this._nextId++;
        this.toasts.update(t => [...t, { id, message, type }]);

        setTimeout(() => this.dismiss(id), duration);
    }

    success(message: string) { this.show(message, 'success'); }
    error(message: string) { this.show(message, 'error'); }
    warning(message: string) { this.show(message, 'warning'); }
    info(message: string) { this.show(message, 'info'); }

    dismiss(id: number) {
        this.toasts.update(t => t.filter(x => x.id !== id));
    }
}
