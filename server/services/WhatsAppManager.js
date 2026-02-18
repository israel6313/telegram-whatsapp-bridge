import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import QRCode from 'qrcode';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(__dirname, '..', '.wwebjs_auth');

/**
 * WhatsAppManager — self-healing wrapper around whatsapp-web.js Client.
 * Automatically reconnects on failure & exposes status via Socket.io.
 */
export class WhatsAppManager {
    constructor(io) {
        /** @type {import('socket.io').Server} */
        this.io = io;
        /** @type {import('whatsapp-web.js').Client | null} */
        this.client = null;
        this.status = 'disconnected'; // disconnected | qr | authenticated | ready | error
        this.qrDataUrl = null;
        this._reconnecting = false;
    }

    /* ------------------------------------------------------------------ */
    /*  Lifecycle                                                         */
    /* ------------------------------------------------------------------ */

    /** Create and initialise the WA client. */
    async init() {
        if (this.client) {
            try { await this.client.destroy(); } catch { /* ignore */ }
        }

        this._setStatus('disconnected');
        this._log('🔌 מאתחל WhatsApp Client...', 'info');

        this.client = new Client({
            authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
            },
        });

        this._bindEvents();

        try {
            await this.client.initialize();
        } catch (err) {
            this._log(`❌ שגיאת אתחול: ${err.message}`, 'error');
            this._scheduleReconnect();
        }
    }

    /** Destroy client, delete auth folder, then re-init for a clean login. */
    async hardReset() {
        this._log('🔨 Hard Reset — מוחק נתוני אימות...', 'warning');
        try {
            if (this.client) await this.client.destroy();
        } catch { /* ignore */ }
        this.client = null;

        await fs.remove(AUTH_DIR);
        this._log('🗑️ תיקיית auth נמחקה', 'info');
        await this.init();
    }

    /* ------------------------------------------------------------------ */
    /*  Messaging                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * Send a message (text or media) to a chat.
     * @param {string} chatId  — WhatsApp group/chat JID
     * @param {string} text    — message body
     * @param {object} [media] — { mimetype, data (base64), filename }
     */
    async sendMessage(chatId, text, media = null) {
        if (this.status !== 'ready') {
            throw new Error('WhatsApp לא מחובר');
        }

        if (media) {
            // Proper Base64 MessageMedia creation to prevent "Corrupted Object" errors
            const waMedia = new MessageMedia(
                media.mimetype,
                media.data, // already base64
                media.filename || 'file',
            );
            await this.client.sendMessage(chatId, waMedia, { caption: text || '' });
        } else {
            await this.client.sendMessage(chatId, text);
        }
    }

    /** Whether the client is ready to send. */
    get isReady() {
        return this.status === 'ready';
    }

    /* ------------------------------------------------------------------ */
    /*  Internal event wiring                                             */
    /* ------------------------------------------------------------------ */

    _bindEvents() {
        const c = this.client;

        c.on('qr', async (qr) => {
            this._setStatus('qr');
            this.qrDataUrl = await QRCode.toDataURL(qr);
            this._emit('wa:qr', { qr: this.qrDataUrl });
            this._log('📱 קוד QR נוצר — סרוק עם WhatsApp', 'info');
        });

        c.on('authenticated', () => {
            this._setStatus('authenticated');
            this._log('🔑 אומת בהצלחה', 'success');
        });

        c.on('ready', () => {
            this._setStatus('ready');
            this._log('✅ WhatsApp מוכן לשליחה', 'success');
            this._emit('wa:ready', {});
        });

        c.on('auth_failure', (msg) => {
            this._setStatus('error');
            this._log(`🔒 שגיאת אימות: ${msg}`, 'error');
            this._scheduleReconnect();
        });

        c.on('disconnected', (reason) => {
            this._setStatus('disconnected');
            this._log(`🔌 WhatsApp התנתק: ${reason}`, 'error');
            this._scheduleReconnect();
        });
    }

    /** Attempt automatic reconnection after a delay. */
    _scheduleReconnect() {
        if (this._reconnecting) return;
        this._reconnecting = true;
        this._log('🔄 ניסיון חיבור מחדש בעוד 10 שניות...', 'warning');
        setTimeout(async () => {
            this._reconnecting = false;
            await this.init();
        }, 10_000);
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                           */
    /* ------------------------------------------------------------------ */

    _setStatus(status) {
        this.status = status;
        this._emit('wa:status', { status });
    }

    _emit(event, data) {
        if (this.io) this.io.emit(event, data);
    }

    _log(message, level = 'info') {
        const entry = { timestamp: new Date().toISOString(), message, level };
        console.log(`[WA] ${message}`);
        if (this.io) this.io.emit('log', entry);
    }
}
