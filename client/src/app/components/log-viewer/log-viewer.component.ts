import { Component, inject, ElementRef, viewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SocketService } from '../../services/socket.service';

@Component({
    selector: 'app-log-viewer',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './log-viewer.component.html',
    styleUrl: './log-viewer.component.scss',
})
export class LogViewerComponent {
    readonly socket = inject(SocketService);
    readonly scrollContainer = viewChild<ElementRef>('scrollContainer');

    constructor() {
        // Auto-scroll when logs change
        effect(() => {
            const logs = this.socket.logs();
            const el = this.scrollContainer()?.nativeElement;
            if (el && logs.length > 0) {
                setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
            }
        });
    }

    getLogClass(level: string): string {
        const map: Record<string, string> = {
            success: 'log-success',
            error: 'log-error',
            warning: 'log-warning',
            info: 'log-info',
        };
        return map[level] || 'log-info';
    }

    formatTime(iso: string): string {
        try {
            return new Date(iso).toLocaleTimeString('he-IL');
        } catch {
            return '';
        }
    }

    clearLogs() {
        this.socket.clearLogs();
    }
}
