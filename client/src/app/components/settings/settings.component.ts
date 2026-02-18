import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService, BridgeSettings } from '../../services/settings.service';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './settings.component.html',
    styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
    readonly settingsService = inject(SettingsService);

    form = signal<BridgeSettings>({
        telegramBotToken: '',
        telegramChannelId: '',
        whatsappGroupId: '',
        footerText: '',
        autoRetry: true,
        retryIntervalMs: 5000,
        maxRetries: 10,
    });

    async ngOnInit() {
        try {
            const data = await this.settingsService.load();
            this.form.set({ ...data });
        } catch { /* server may not be running */ }
    }

    async save() {
        // Trim string values
        const current = this.form();
        const cleaned = {
            ...current,
            telegramBotToken: current.telegramBotToken?.trim(),
            telegramChannelId: current.telegramChannelId?.trim(),
            whatsappGroupId: current.whatsappGroupId?.trim(),
        };
        this.form.set(cleaned);
        await this.settingsService.save(cleaned);
    }

    /** Insert WhatsApp markdown at cursor position in footer text */
    insertMarkdown(type: 'bold' | 'italic' | 'strike') {
        const chars: Record<string, string> = { bold: '*', italic: '_', strike: '~' };
        const char = chars[type];
        const current = this.form().footerText;
        this.form.update((f) => ({ ...f, footerText: current + `${char}טקסט${char}` }));
    }

    async hardReset() {
        if (confirm('האם אתה בטוח? פעולה זו תמחק את נתוני האימות של WhatsApp.')) {
            await this.settingsService.hardResetWa();
        }
    }

    async restartBot() {
        this.settingsService.loading.set(true);
        try {
            await this.settingsService.restartTelegram();
            // Toast or simple alert for now, as we don't have a full toast service yet
            alert('✅ הבוט הופעל מחדש בהצלחה');
        } catch (err: any) {
            alert(`❌ שגיאה בהפעלת הבוט: ${err.message || err}`);
        } finally {
            this.settingsService.loading.set(false);
        }
    }

    updateField(field: keyof BridgeSettings, value: any) {
        this.form.update((f) => ({ ...f, [field]: value }));
    }
}
