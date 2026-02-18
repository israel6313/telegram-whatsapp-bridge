import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SocketService } from '../../services/socket.service';
import { SettingsService } from '../../services/settings.service';

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './dashboard.component.html',
    styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
    readonly socket = inject(SocketService);
    readonly settingsService = inject(SettingsService);

    readonly stats = signal<any>(null);

    async ngOnInit() {
        try {
            const s = await this.settingsService.getStats();
            this.stats.set(s);
        } catch { /* server may not be running */ }
    }

    getStatusLabel(): string {
        const map: Record<string, string> = {
            disconnected: 'מנותק',
            qr: 'ממתין לסריקת QR',
            authenticated: 'מאומת',
            ready: 'מחובר ✓',
            error: 'שגיאה',
        };
        return map[this.socket.waStatus()] || this.socket.waStatus();
    }

    getStatusClass(): string {
        const s = this.socket.waStatus();
        if (s === 'ready') return 'status-ready';
        if (s === 'error') return 'status-error';
        if (s === 'qr') return 'status-qr';
        return 'status-disconnected';
    }
}
