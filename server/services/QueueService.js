import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = join(__dirname, '..', 'data', 'queue.json');

/**
 * QueueService — persists Telegram messages when WhatsApp is offline,
 * then flushes them once the WA client reconnects.
 */
export class QueueService {
    constructor(io) {
        /** @type {import('socket.io').Server} */
        this.io = io;
        this.queue = [];
        this.isFlushing = false;
    }

    /* ------------------------------------------------------------------ */
    /*  Lifecycle                                                         */
    /* ------------------------------------------------------------------ */

    /** Load saved queue from disk. */
    async init() {
        try {
            await fs.ensureFile(QUEUE_FILE);
            const raw = await fs.readFile(QUEUE_FILE, 'utf-8');
            this.queue = raw ? JSON.parse(raw) : [];
        } catch {
            this.queue = [];
        }
        this._emit('queue:loaded', { count: this.queue.length });
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                        */
    /* ------------------------------------------------------------------ */

    /** Add a message to the queue and persist. */
    async enqueue(message) {
        const entry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            timestamp: new Date().toISOString(),
            retries: 0,
            ...message,
        };
        this.queue.push(entry);
        await this._save();
        this._emit('queue:added', { id: entry.id, count: this.queue.length });
        this._log(`📥 הודעה נוספה לתור (${this.queue.length} בתור)`, 'info');
        return entry;
    }

    /** Remove and return the oldest message. */
    async dequeue() {
        if (this.queue.length === 0) return null;
        const entry = this.queue.shift();
        await this._save();
        this._emit('queue:removed', { id: entry.id, count: this.queue.length });
        return entry;
    }

    /** Flush all queued messages via the provided sender function. */
    async flush(sendFn) {
        if (this.isFlushing || this.queue.length === 0) return;

        this.isFlushing = true;
        this._log(`🔄 מתחיל שליחת ${this.queue.length} הודעות מהתור...`, 'info');

        while (this.queue.length > 0) {
            const entry = this.queue[0];
            try {
                await sendFn(entry);
                this.queue.shift(); // success → remove
                await this._save();
                this._emit('queue:sent', { id: entry.id, remaining: this.queue.length });
                this._log(`✅ הודעה ${entry.id} נשלחה מהתור`, 'success');

                // Small delay between messages to avoid rate-limiting
                await this._sleep(1500);
            } catch (err) {
                entry.retries = (entry.retries || 0) + 1;
                if (entry.retries >= 10) {
                    this.queue.shift(); // give up after 10 retries
                    this._log(`❌ הודעה ${entry.id} נכשלה אחרי 10 ניסיונות — נמחקת`, 'error');
                } else {
                    this._log(`⚠️ ניסיון ${entry.retries}/10 נכשל ל-${entry.id}: ${err.message}`, 'warning');
                    // Exponential back-off (capped at 30s)
                    const delay = Math.min(1000 * 2 ** entry.retries, 30_000);
                    await this._sleep(delay);
                }
                await this._save();
            }
        }

        this.isFlushing = false;
        this._log('✅ תור ההודעות רוקן בהצלחה', 'success');
    }

    /** Return current queue length. */
    get length() {
        return this.queue.length;
    }

    /** Return snapshot of queue. */
    getAll() {
        return [...this.queue];
    }

    /* ------------------------------------------------------------------ */
    /*  Internals                                                         */
    /* ------------------------------------------------------------------ */

    async _save() {
        await fs.ensureFile(QUEUE_FILE);
        await fs.writeJson(QUEUE_FILE, this.queue, { spaces: 2 });
    }

    _emit(event, data) {
        if (this.io) this.io.emit(event, data);
    }

    _log(message, level = 'info') {
        const entry = { timestamp: new Date().toISOString(), message, category: 'QUEUE', level };
        console.log(`[Queue] ${message}`);
        if (this.io) this.io.emit('log', entry);
    }

    _sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }
}
