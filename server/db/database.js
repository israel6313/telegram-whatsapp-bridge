import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSONFilePreset } from 'lowdb/node';
import fs from 'fs-extra';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// Default database schema
const defaultData = {
    settings: {
        telegramBotToken: '',
        telegramChannelId: '',
        whatsappGroupId: '',
        footerText: '',
        autoRetry: true,
        retryIntervalMs: 5000,
        maxRetries: 10,
    },
    queue: [],
    stats: {
        totalForwarded: 0,
        totalQueued: 0,
        totalErrors: 0,
        lastActivity: null,
    },
};

let db = null;

/**
 * Initialize (or return existing) lowdb instance.
 */
export async function getDb() {
    if (db) return db;

    await fs.ensureDir(DATA_DIR);
    const dbPath = join(DATA_DIR, 'db.json');
    db = await JSONFilePreset(dbPath, defaultData);

    // Make sure every key exists even when upgrading from older schema
    db.data = { ...defaultData, ...db.data };
    await db.write();

    return db;
}

/**
 * Get current settings object.
 */
export async function getSettings() {
    const db = await getDb();
    return db.data.settings;
}

/**
 * Merge partial updates into settings.
 */
export async function updateSettings(partial) {
    const db = await getDb();
    db.data.settings = { ...db.data.settings, ...partial };
    await db.write();
    return db.data.settings;
}

/**
 * Increment a stats counter.
 */
export async function incrementStat(key, amount = 1) {
    const db = await getDb();
    if (typeof db.data.stats[key] === 'number') {
        db.data.stats[key] += amount;
    }
    db.data.stats.lastActivity = new Date().toISOString();
    await db.write();
}

/**
 * Get current stats object.
 */
export async function getStats() {
    const db = await getDb();
    return db.data.stats;
}
