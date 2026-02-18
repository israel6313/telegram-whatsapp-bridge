import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
    readonly options = signal<ConfirmOptions | null>(null);
    private _resolve: ((value: boolean) => void) | null = null;

    confirm(opts: ConfirmOptions): Promise<boolean> {
        this.options.set(opts);
        return new Promise(resolve => {
            this._resolve = resolve;
        });
    }

    respond(value: boolean) {
        this._resolve?.(value);
        this._resolve = null;
        this.options.set(null);
    }
}
