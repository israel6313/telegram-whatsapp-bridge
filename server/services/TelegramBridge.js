import { Telegraf } from 'telegraf';

/**
 * TelegramBridge — listens to a Telegram channel via Telegraf
 * and forwards messages (text / photo / video / document) to WhatsApp.
 */
export class TelegramBridge {
    /**
     * @param {object}               io       Socket.io server
     * @param {import('./WhatsAppManager.js').WhatsAppManager} waManager
     * @param {import('./QueueService.js').QueueService}       queueService
     * @param {Function}             getSettings  async fn returning current settings
     */
    constructor(io, waManager, queueService, getSettings) {
        this.io = io;
        this.wa = waManager;
        this.queue = queueService;
        this.getSettings = getSettings;
        /** @type {Telegraf | null} */
        this.bot = null;
    }

    /* ------------------------------------------------------------------ */
    /*  Lifecycle                                                         */
    /* ------------------------------------------------------------------ */

    /** Launch the Telegraf bot. */
    async start() {
        const settings = await this.getSettings();
        const token = settings.telegramBotToken?.trim();

        if (!token) {
            this._log('⚠️ Telegram Bot Token לא הוגדר — הבוט לא יופעל', 'warning');
            return;
        }

        // Stop existing bot if running
        if (this.bot) {
            try { this.bot.stop(); } catch { /* ignore */ }
            this.bot = null;
        }

        try {
            this._log(`🔄 מתחיל חיבור ל-Telegram... (Token length: ${token.length})`, 'info');
            this.bot = new Telegraf(token);

            // Handle all message types (groups/private)
            this.bot.on('message', (ctx) => this._handleMessage(ctx));

            // Handle channel posts (REQUIRED for Channels)
            this.bot.on('channel_post', (ctx) => this._handleMessage(ctx));

            // Error handling
            this.bot.catch((err) => {
                this._log(`❌ שגיאת Telegraf: ${err.message}`, 'error');
            });

            await this.bot.launch();
            const botInfo = await this.bot.telegram.getMe();
            this._log(`🤖 Telegram Bot הופעל בהצלחה: @${botInfo.username}`, 'success');

        } catch (err) {
            this._log(`❌ שגיאה בהפעלת הבוט: ${err.message}`, 'error');
            this.bot = null;
        }

        // Graceful stop
        process.once('SIGINT', () => this.bot?.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot?.stop('SIGTERM'));
    }

    /** Stop the bot. */
    stop() {
        if (this.bot) {
            this.bot.stop();
            this.bot = null;
            this._log('🛑 Telegram Bot הופסק', 'info');
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Message handling                                                  */
    /* ------------------------------------------------------------------ */

    async _handleMessage(ctx) {
        const settings = await this.getSettings();
        // Parse configured channels (comma-separated support)
        const channelIds = (settings.telegramChannelId || '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);

        const chatId = String(ctx.chat.id);
        const chatTitle = ctx.chat.title || 'Private Chat';

        // Debug log: Print every message the bot hears
        this._log(`👂 התקבלה הודעה מ-ID: ${chatId} (${chatTitle})`, 'info');

        // Filter: only listen to the configured channels
        // If no channels are configured, we might want to ignore everything or allow everything. 
        // Current logic: if channels ARE configured, check if this is one of them.
        if (channelIds.length > 0 && !channelIds.includes(chatId)) {
            this._log(`⚠️ מתעלם מהודעה: ID לא תואם (רשימה: ${channelIds.join(', ')}, התקבל: ${chatId})`, 'warning');
            return;
        }

        const waGroupId = settings.whatsappGroupId?.trim();
        if (!waGroupId) {
            this._log('⚠️ WhatsApp Group ID לא הוגדר', 'warning');
            return;
        }

        try {
            const payload = await this._buildPayload(ctx, settings);
            if (!payload) {
                this._log('⚠️ סוג הודעה לא נתמך או ללא תוכן', 'warning');
                return;
            }

            if (this.wa.isReady) {
                await this._sendToWhatsApp(waGroupId, payload);
                this._log(`📤 הודעה הועברה ל-WhatsApp`, 'success');
            } else {
                await this.queue.enqueue({ chatId: waGroupId, ...payload });
                this._log('📥 WhatsApp לא מחובר — ההודעה נוספה לתור', 'warning');
            }
        } catch (err) {
            this._log(`❌ שגיאה בהעברת הודעה: ${err.message}`, 'error');
        }
    }

    /**
     * Build a normalised payload from a Telegram context.
     * Returns { text, media? } or null.
     */
    async _buildPayload(ctx, settings) {
        const footer = settings.footerText ? `\n\n${settings.footerText}` : '';
        // In channel_post events, the message is in ctx.channelPost, not ctx.message
        const msg = ctx.message || ctx.channelPost;

        if (!msg) return null;

        // --- Text ---
        if (msg.text) {
            return { text: this._convertFormatting(msg.text) + footer };
        }

        // --- Photo ---
        if (msg.photo) {
            const photo = msg.photo[msg.photo.length - 1]; // highest resolution
            const caption = msg.caption ? this._convertFormatting(msg.caption) + footer : footer;
            const media = await this._downloadTelegramFile(ctx, photo.file_id, 'image/jpeg');
            return { text: caption, media };
        }

        // --- Document ---
        if (msg.document) {
            const caption = msg.caption ? this._convertFormatting(msg.caption) + footer : footer;
            const media = await this._downloadTelegramFile(
                ctx,
                msg.document.file_id,
                msg.document.mime_type || 'application/octet-stream',
                msg.document.file_name,
            );
            return { text: caption, media };
        }

        // --- Video ---
        if (msg.video) {
            const caption = msg.caption ? this._convertFormatting(msg.caption) + footer : footer;
            const media = await this._downloadTelegramFile(
                ctx,
                msg.video.file_id,
                msg.video.mime_type || 'video/mp4',
                msg.video.file_name || 'video.mp4',
            );
            return { text: caption, media };
        }

        // --- Sticker / Animation (GIF) ---
        if (msg.sticker) {
            return { text: `[Sticker] ${msg.sticker.emoji || ''}${footer}` };
        }

        if (msg.animation) {
            const media = await this._downloadTelegramFile(
                ctx,
                msg.animation.file_id,
                'video/mp4',
                'animation.mp4',
            );
            return { text: footer || '', media };
        }

        // --- Audio (Music) ---
        if (msg.audio) {
            const caption = msg.caption ? this._convertFormatting(msg.caption) + footer : footer;
            const media = await this._downloadTelegramFile(
                ctx,
                msg.audio.file_id,
                msg.audio.mime_type || 'audio/mpeg',
                msg.audio.file_name || 'audio.mp3',
            );
            return { text: caption, media };
        }

        // --- Voice Note ---
        if (msg.voice) {
            const caption = msg.caption ? this._convertFormatting(msg.caption) + footer : footer;
            const media = await this._downloadTelegramFile(
                ctx,
                msg.voice.file_id,
                msg.voice.mime_type || 'audio/ogg',
                'voice.ogg',
            );
            return { text: caption, media };
        }

        return null; // unsupported type
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Download a file from Telegram and return it as a Base64 media object.
     * This avoids the "Corrupted Object" error in WA by converting Buffer → Base64.
     */
    async _downloadTelegramFile(ctx, fileId, mimetype, filename) {
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const res = await fetch(fileLink.href);
        const buffer = Buffer.from(await res.arrayBuffer());

        return {
            mimetype,
            data: buffer.toString('base64'),
            filename: filename || 'file',
        };
    }

    /**
     * Send a payload to WhatsApp.
     */
    async _sendToWhatsApp(chatId, payload) {
        await this.wa.sendMessage(chatId, payload.text, payload.media || null);
    }

    /**
     * Convert Telegram HTML/Markdown formatting to WhatsApp markdown.
     * Telegram: <b>, <i>, <s>  →  WhatsApp: *, _, ~
     */
    _convertFormatting(text) {
        if (!text) return '';
        return text
            .replace(/<b>(.*?)<\/b>/g, '*$1*')
            .replace(/<i>(.*?)<\/i>/g, '_$1_')
            .replace(/<s>(.*?)<\/s>/g, '~$1~')
            .replace(/<code>(.*?)<\/code>/g, '```$1```')
            .replace(/<[^>]+>/g, ''); // strip remaining HTML
    }

    _log(message, level = 'info') {
        const entry = { timestamp: new Date().toISOString(), message, category: 'TELEGRAM', level };
        console.log(`[TG] ${message}`);
        if (this.io) this.io.emit('log', entry);
    }
}
