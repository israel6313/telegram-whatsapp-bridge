import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService, BridgeSettings } from '../../services/settings.service';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { SelectionDialogComponent, SelectionItem } from '../selection-dialog/selection-dialog.component';

interface ChannelItem { id: string; name: string; }

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [CommonModule, FormsModule, SelectionDialogComponent],
    templateUrl: './settings.component.html',
    styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
    readonly settingsService = inject(SettingsService);
    readonly toast = inject(ToastService);
    readonly confirm = inject(ConfirmService);

    form = signal<BridgeSettings>({
        telegramBotToken: '',
        telegramChannelId: '',
        whatsappGroupId: '',
        channels: [],
        groups: [],
        footerText: '',
        autoRetry: true,
        retryIntervalMs: 5000,
        maxRetries: 10,
    });

    channels = signal<ChannelItem[]>([]);
    groups = signal<ChannelItem[]>([]);

    // ---- Selection Dialog State ----
    showSelection = signal(false);
    selectionTitle = signal('');
    selectionItems = signal<SelectionItem[]>([]);
    selectionLoading = signal(false);
    selectionEmptyText = signal('');
    currentSelectionType = signal<'channel' | 'group' | null>(null);

    async ngOnInit() {
        try {
            const data = await this.settingsService.load();
            this.form.set({ ...data });

            if (data.channels && data.channels.length > 0) {
                this.channels.set(data.channels);
            } else if (data.telegramChannelId) {
                const ids = data.telegramChannelId.split(',').map((s: string) => s.trim()).filter(Boolean);
                this.channels.set(ids.map((id: string) => ({ id, name: '' })));
            }

            if (data.groups && data.groups.length > 0) {
                this.groups.set(data.groups);
            } else if (data.whatsappGroupId) {
                const ids = data.whatsappGroupId.split(',').map((s: string) => s.trim()).filter(Boolean);
                this.groups.set(ids.map((id: string) => ({ id, name: '' })));
            }
        } catch { /* server may not be running */ }
    }

    // ---- Discovery Actions ----
    async openChannelDiscovery() {
        this.currentSelectionType.set('channel');
        this.selectionTitle.set('בחר ערוץ Telegram (פעילים לאחרונה)');
        this.selectionEmptyText.set('רק ערוצים שהבוט ראה בהם הודעה לאחרונה יופיעו כאן. שלח הודעה בערוץ ונסה שוב.');
        this.showSelection.set(true);
        this.selectionLoading.set(true);
        this.selectionItems.set([]);

        try {
            const recents = await this.settingsService.getRecentTelegramChannels();
            this.selectionItems.set(recents.map(c => ({
                id: c.id,
                name: c.name,
                subtext: c.username ? `@${c.username}` : undefined
            })));
        } catch (err) {
            this.toast.error('שגיאה בטעינת ערוצים');
        } finally {
            this.selectionLoading.set(false);
        }
    }

    async openGroupDiscovery() {
        this.currentSelectionType.set('group');
        this.selectionTitle.set('בחר קבוצת WhatsApp');
        this.selectionEmptyText.set('לא נמצאו קבוצות. וודא ש-WhatsApp מחובר.');
        this.showSelection.set(true);
        this.selectionLoading.set(true);
        this.selectionItems.set([]);

        try {
            const groups = await this.settingsService.getWhatsAppGroups();
            this.selectionItems.set(groups.map(g => ({
                id: g.id,
                name: g.name
            })));
        } catch (err) {
            this.toast.error('שגיאה בטעינת קבוצות');
        } finally {
            this.selectionLoading.set(false);
        }
    }

    onSelection(item: SelectionItem) {
        const type = this.currentSelectionType();
        if (type === 'channel') {
            // Check duplicate
            if (this.channels().some(c => c.id === item.id)) {
                this.toast.warning('הערוץ כבר קיים ברשימה');
                return;
            }
            this.channels.update(c => [...c, { id: item.id, name: item.name }]);
            this.toast.success(`נוסף ערוץ: ${item.name}`);
        } else if (type === 'group') {
            if (this.groups().some(g => g.id === item.id)) {
                this.toast.warning('הקבוצה כבר קיימת ברשימה');
                return;
            }
            this.groups.update(g => [...g, { id: item.id, name: item.name }]);
            this.toast.success(`נוספה קבוצה: ${item.name}`);
        }
        this.showSelection.set(false);
    }

    // ---- CRUD (Existing) ----
    addChannel() {
        this.channels.update(c => [...c, { id: '', name: '' }]);
    }
    // ... rest of CRUD methods ...
    removeChannel(index: number) {
        this.channels.update(c => c.filter((_, i) => i !== index));
    }

    updateChannel(index: number, field: 'id' | 'name', value: string) {
        this.channels.update(c => c.map((item, i) => i === index ? { ...item, [field]: value } : item));
    }

    // ---- Group CRUD ----
    addGroup() {
        this.groups.update(g => [...g, { id: '', name: '' }]);
    }

    removeGroup(index: number) {
        this.groups.update(g => g.filter((_, i) => i !== index));
    }

    updateGroup(index: number, field: 'id' | 'name', value: string) {
        this.groups.update(g => g.map((item, i) => i === index ? { ...item, [field]: value } : item));
    }

    // ---- Save ----
    async save() {
        const current = this.form();

        // We now send the full arrays to the backend
        // (The backend handles migration and storage)
        const cleaned = {
            ...current,
            telegramBotToken: current.telegramBotToken?.trim(),
            channels: this.channels(),
            groups: this.groups(),
            // Legacy fields can be cleared or kept as fallback, but backend prioritizes arrays
        };
        this.form.set(cleaned);
        await this.settingsService.save(cleaned);
        this.toast.success('ההגדרות נשמרו בהצלחה');
    }

    // ---- Footer ----
    insertMarkdown(type: 'bold' | 'italic' | 'strike') {
        const chars: Record<string, string> = { bold: '*', italic: '_', strike: '~' };
        const char = chars[type];
        const current = this.form().footerText;
        this.form.update((f) => ({ ...f, footerText: current + `${char}טקסט${char}` }));
    }

    updateField(field: keyof BridgeSettings, value: any) {
        this.form.update((f) => ({ ...f, [field]: value }));
    }

    // ---- Actions ----
    async hardReset() {
        const confirmed = await this.confirm.confirm({
            title: 'Hard Reset',
            message: 'פעולה זו תמחק את נתוני האימות של WhatsApp ותדרוש סריקת QR מחדש. אתה בטוח?',
            confirmText: 'מחק והתחבר מחדש',
            cancelText: 'ביטול',
            danger: true,
        });
        if (confirmed) {
            await this.settingsService.hardResetWa();
            this.toast.warning('נתוני האימות נמחקו — סרוק QR מחדש');
        }
    }

    async restartBot() {
        this.settingsService.loading.set(true);
        try {
            await this.settingsService.restartTelegram();
            this.toast.success('הבוט הופעל מחדש בהצלחה');
        } catch (err: any) {
            this.toast.error(`שגיאה בהפעלת הבוט: ${err.message || err}`);
        } finally {
            this.settingsService.loading.set(false);
        }
    }
}
