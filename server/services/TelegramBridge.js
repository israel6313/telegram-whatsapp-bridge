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

        /**
         * Cache for Media Groups (Albums).
         * Map<groupId, { timeout: NodeJS.Timeout, messages: Array<ctx> }>
         */
        this.mediaGroupCache = new Map();
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

        // Filter: only listen to the configured channels
        if (channelIds.length > 0 && !channelIds.includes(chatId)) {
            // Only log if it's NOT a media group part (to avoid spamming logs for every photo in an album)
            // But we don't know if it's an album yet easily without parsing. 
            // We'll log just once per message ID usually.
            // this._log(`⚠️ מתעלם מהודעה: ID לא תואם (רשימה: ${channelIds.join(', ')}, התקבל: ${chatId})`, 'warning');
            return;
        }

        // Check for Media Group (Album)
        const msg = ctx.message || ctx.channelPost;
        if (msg && msg.media_group_id) {
            this._handleMediaGroup(ctx, msg.media_group_id, settings);
            return;
        }

        // Regular single message
        await this._processSingleMessage(ctx, settings);
    }

    /**
     * Buffer media group messages and process them together.
     */
    _handleMediaGroup(ctx, groupId, settings) {
        if (!this.mediaGroupCache.has(groupId)) {
            this.mediaGroupCache.set(groupId, {
                messages: [],
                timeout: null
            });
            this._log(`📦 זוהה אלבום תמונות (ID: ${groupId}), ממתין לשאר החלקים...`, 'info');
        }

        const group = this.mediaGroupCache.get(groupId);

        // Add current message to buffer
        group.messages.push(ctx);

        // Reset timeout (debounce)
        if (group.timeout) clearTimeout(group.timeout);

        group.timeout = setTimeout(() => {
            this.mediaGroupCache.delete(groupId);
            this._processMediaGroup(group.messages, settings);
        }, 2000); // Wait 2 seconds for all parts to arrive
    }

    async _processMediaGroup(ctxList, settings) {
        this._log(`🚀 מעבד אלבום עם ${ctxList.length} פריטים (מוריד במקביל)...`, 'info');

        // Sort by message ID to ensure order
        ctxList.sort((a, b) => {
            const msgA = a.message || a.channelPost;
            const msgB = b.message || b.channelPost;
            return msgA.message_id - msgB.message_id;
        });

        const waGroupId = settings.whatsappGroupId?.trim();
        if (!waGroupId) return;

        // 1. Prepare (Download) All payloads in Parallel
        // This ensures that we have all media ready in memory, so we can send them 
        // as fast as possible to WhatsApp, triggering the "visual grouping".
        const payloadPromises = ctxList.map(ctx => this._buildPayload(ctx, settings));
        const payloads = await Promise.all(payloadPromises);

        this._log(`📦 כל המדיה ירדה (${payloads.filter(Boolean).length} קבצים), שולח ל-WhatsApp...`, 'info');

        // 2. Send Rapidly (Fire & Forget Strategy)
        // We do NOT await the result of each message here, because waiting for WA to ACK 
        // adds a delay (~500ms) that breaks the "visual grouping".
        // Instead, we fire them into the browser queue comfortably apart (100ms) to ensure order,
        // but close enough to be grouped.

        let promiseChain = Promise.resolve();
        const sendPromises = [];

        for (const payload of payloads) {
            if (!payload) continue;

            // Chain the *initiation* of sends to ensure order is submitted to browser in 1->2->3 order
            promiseChain = promiseChain.then(async () => {
                // Dispatch without awaiting the full roundtrip inside the chain lock
                // We trust wwebjs to queue them.
                const p = this._dispatchPayload(waGroupId, payload).catch(err => {
                    this._log(`❌ שגיאה באלבום: ${err.message}`, 'error');
                });
                sendPromises.push(p);

                // Tiny delay to ensure the browser processes the submission order
                await new Promise(r => setTimeout(r, 150));
            });
        }

        // Wait for all to be submitted
        await promiseChain;
        // Optionally wait for them to finish sending (background)
        // await Promise.all(sendPromises); 

        this._log(`✅ אלבום נשלח (תהליך שליחה ברקע)`, 'success');
    }

    // New helper to handle the Send vs Queue decision
    async _dispatchPayload(waGroupId, payload) {
        try {
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

    async _processSingleMessage(ctx, settings) {
        const waGroupId = settings.whatsappGroupId?.trim();
        if (!waGroupId) return;

        const payload = await this._buildPayload(ctx, settings);
        if (payload) {
            await this._dispatchPayload(waGroupId, payload);
        }
    }

    /**
     * Build a normalised payload from a Telegram context.
     * Returns { text, media? } or null.
     */
    async _buildPayload(ctx, settings) {
        const footer = settings.footerText ? `\n\n${settings.footerText}` : '';
        const msg = ctx.message || ctx.channelPost;
        if (!msg) return null;

        // Use new Entity Parser for text/caption
        const caption = msg.caption ? this._parseEntities(msg.caption, msg.caption_entities) + footer : footer;
        const text = msg.text ? this._parseEntities(msg.text, msg.entities) + footer : '';

        // --- Text ---
        if (msg.text) {
            return { text };
        }

        // --- Photo ---
        if (msg.photo) {
            const photo = msg.photo[msg.photo.length - 1]; // highest resolution
            const media = await this._downloadTelegramFile(ctx, photo.file_id, 'image/jpeg');
            return { text: caption, media };
        }

        // --- Document ---
        if (msg.document) {
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
            const media = await this._downloadTelegramFile(
                ctx,
                msg.video.file_id,
                msg.video.mime_type || 'video/mp4',
                msg.video.file_name || 'video.mp4',
            );
            return { text: caption, media };
        }

        // --- Sticker ---
        if (msg.sticker) {
            return { text: `[Sticker] ${msg.sticker.emoji || ''}${footer}` };
        }

        // --- Animation (GIF) ---
        if (msg.animation) {
            const media = await this._downloadTelegramFile(
                ctx,
                msg.animation.file_id,
                'video/mp4',
                'animation.mp4',
            );
            return { text: footer || '', media };
        }

        // --- Audio ---
        if (msg.audio) {
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
     * Parse formatting entities (Bold, Italic, Code, etc.)
     * Telegram Entities: [{ offset, length, type }]
     */
    _parseEntities(text, entities) {
        if (!entities || !entities.length) return text;

        // Convert string to array of characters because JS strings are immutable
        // and UTF-16 split can be tricky, but for simple markers, array split is easiest usually.
        // However, simple slice works fine if we handle indices backwards to avoid shifting.

        // We will insert markers into the string.
        let result = text;

        // Sort entities by offset descending so we can modify string from end to start
        // without messing up the offsets of earlier entities.
        const sorted = [...entities].sort((a, b) => b.offset - a.offset);

        for (const ent of sorted) {
            const { offset, length, type } = ent;
            const start = offset;
            const end = offset + length;

            let prefix = '';
            let suffix = '';

            switch (type) {
                case 'bold':
                    prefix = '*'; suffix = '*';
                    break;
                case 'italic':
                    prefix = '_'; suffix = '_';
                    break;
                case 'strikethrough':
                    prefix = '~'; suffix = '~';
                    break;
                case 'code':
                    prefix = '```'; suffix = '```';
                    break;
                case 'pre':
                    prefix = '```\n'; suffix = '\n```';
                    break;
                case 'spoiler':
                    // WA doesn't support spoilers standardized, maybe simple block?
                    prefix = '|| '; suffix = ' ||'; // generic conventions
                    break;
                // 'text_link' (URL) is usually just clickable in WA, but we can format it if needed.
                // For now, keep as plain text (WA auto-links URLs).
                case 'text_link':
                    // e.g. [text](url) -> WA doesn't support Markdown links properly, only raw URLs.
                    // So we just leave the text as is, or maybe append (url).
                    // decided: Leave as is.
                    break;
                default:
                    continue;
            }

            // Insert suffix first, then prefix
            // Note: JS strings are 16-bit code units. Telegram offsets are usually UTF-16 code units.
            // So slice works perfectly.
            const before = result.slice(0, start);
            const inner = result.slice(start, end);
            const after = result.slice(end);

            result = before + prefix + inner + suffix + after;
        }

        return result;
    }

    _log(message, level = 'info') {
        const entry = { timestamp: new Date().toISOString(), message, category: 'TELEGRAM', level };
        console.log(`[TG] ${message}`);
        if (this.io) this.io.emit('log', entry);
    }
}
