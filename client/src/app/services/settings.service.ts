import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface BridgeSettings {
    telegramBotToken: string;
    // Legacy support (optional)
    telegramChannelId?: string;
    whatsappGroupId?: string;

    // New Structure
    channels: { id: string; name: string }[];
    groups: { id: string; name: string }[];

    footerText: string;
    autoRetry: boolean;
    retryIntervalMs: number;
    maxRetries: number;
}

const API = '/api';

@Injectable({ providedIn: 'root' })
export class SettingsService {
    readonly settings = signal<BridgeSettings | null>(null);
    readonly loading = signal(false);
    readonly saved = signal(false);

    constructor(private http: HttpClient) { }

    async load(): Promise<BridgeSettings> {
        this.loading.set(true);
        try {
            const data = await firstValueFrom(this.http.get<BridgeSettings>(`${API}/settings`));
            this.settings.set(data);
            return data;
        } finally {
            this.loading.set(false);
        }
    }

    async save(partial: Partial<BridgeSettings>): Promise<BridgeSettings> {
        this.loading.set(true);
        this.saved.set(false);
        try {
            const data = await firstValueFrom(this.http.post<BridgeSettings>(`${API}/settings`, partial));
            this.settings.set(data);
            this.saved.set(true);
            setTimeout(() => this.saved.set(false), 3000);
            return data;
        } finally {
            this.loading.set(false);
        }
    }

    async hardResetWa(): Promise<void> {
        await firstValueFrom(this.http.post(`${API}/wa/hard-reset`, {}));
    }

    async restartTelegram(): Promise<void> {
        await firstValueFrom(this.http.post(`${API}/telegram/restart`, {}));
    }

    async getStats(): Promise<any> {
        return firstValueFrom(this.http.get(`${API}/stats`));
    }

    async getWhatsAppGroups(): Promise<{ id: string; name: string }[]> {
        return firstValueFrom(this.http.get<{ id: string; name: string }[]>(`${API}/wa/groups`));
    }

    async getRecentTelegramChannels(): Promise<{ id: string; name: string; username?: string; lastSeen: number }[]> {
        return firstValueFrom(this.http.get<any[]>(`${API}/telegram/recents`));
    }
}
