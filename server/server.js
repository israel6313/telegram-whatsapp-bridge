import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIO } from 'socket.io';
import cors from 'cors';

import { getSettings, updateSettings, getStats, incrementStat } from './db/database.js';
import { QueueService } from './services/QueueService.js';
import { WhatsAppManager } from './services/WhatsAppManager.js';
import { TelegramBridge } from './services/TelegramBridge.js';

const PORT = process.env.PORT || 3000;

/* -------------------------------------------------------------------- */
/*  Express + Socket.io Setup                                           */
/* -------------------------------------------------------------------- */

const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// Serve Static Files (Angular)
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure we point to the correct dist folder (relative to server/server.js)
const clientDistPath = path.join(__dirname, '../client/dist/client/browser');
app.use(express.static(clientDistPath));

// Catch-all route for Angular (SPA) - Must be last!
// We'll add this AFTER the API routes


/* -------------------------------------------------------------------- */
/*  Service Instances                                                   */
/* -------------------------------------------------------------------- */

const queueService = new QueueService(io);
const waManager = new WhatsAppManager(io);
const tgBridge = new TelegramBridge(io, waManager, queueService, getSettings);

/* -------------------------------------------------------------------- */
/*  REST API Routes                                                     */
/* -------------------------------------------------------------------- */

// ---- Settings ----
app.get('/api/settings', async (_req, res) => {
    try {
        const settings = await getSettings();
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const updated = await updateSettings(req.body);
        res.json(updated);
        emitLog('⚙️ הגדרות עודכנו', 'SYSTEM', 'success');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- Stats ----
app.get('/api/stats', async (_req, res) => {
    try {
        const stats = await getStats();
        res.json({ ...stats, queueLength: queueService.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- Queue ----
app.get('/api/queue', (_req, res) => {
    res.json({ queue: queueService.getAll(), length: queueService.length });
});

// ---- WhatsApp status ----
app.get('/api/wa/status', (_req, res) => {
    res.json({ status: waManager.status, qr: waManager.qrDataUrl });
});

// ---- WhatsApp hard reset ----
app.post('/api/wa/hard-reset', async (_req, res) => {
    try {
        await waManager.hardReset();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- Telegram restart ----
app.post('/api/telegram/restart', async (_req, res) => {
    emitLog('🔄 התקבלה בקשה להפעלה מחדש של הבוט...', 'TELEGRAM', 'info');
    try {
        tgBridge.stop();
        await tgBridge.start();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- Discovery ----
app.get('/api/wa/groups', async (_req, res) => {
    try {
        const groups = await waManager.getGroups();
        res.json(groups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/telegram/recents', (_req, res) => {
    try {
        const recents = tgBridge.getRecentChannels();
        res.json(recents);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* -------------------------------------------------------------------- */
/*  Socket.io Events                                                    */
/* -------------------------------------------------------------------- */

io.on('connection', (socket) => {
    console.log(`[IO] Client connected: ${socket.id}`);
    emitLog('🟢 לקוח התחבר לדשבורד', 'SYSTEM', 'info');

    // Send current state to newly connected client
    socket.emit('wa:status', { status: waManager.status });
    socket.emit('queue:update', { count: queueService.length });

    if (waManager.qrDataUrl) {
        socket.emit('wa:qr', { qr: waManager.qrDataUrl });
    }

    socket.on('disconnect', () => {
        console.log(`[IO] Client disconnected: ${socket.id}`);
    });
});

/* -------------------------------------------------------------------- */
/*  WhatsApp Ready → Flush Queue                                        */
/* -------------------------------------------------------------------- */

// Listen for WhatsApp ready events to flush queued messages
io.on('connection', () => { }); // keep-alive

// We hook into the WA manager's ready event via a polling approach
// since the manager emits Socket events, we listen on the IO level
const originalSetStatus = waManager._setStatus.bind(waManager);
waManager._setStatus = function (status) {
    originalSetStatus(status);
    if (status === 'ready') {
        onWhatsAppReady();
    }
};

async function onWhatsAppReady() {
    emitLog('🔗 WhatsApp מחובר — בודק תור הודעות...', 'WHATSAPP', 'success');
    await queueService.flush(async (entry) => {
        await waManager.sendMessage(entry.chatId, entry.text, entry.media || null);
        await incrementStat('totalForwarded');
    });
}

/* -------------------------------------------------------------------- */
/*  Helper                                                              */
/* -------------------------------------------------------------------- */

function emitLog(message, category = 'SYSTEM', level = 'info') {
    const entry = { timestamp: new Date().toISOString(), message, category, level };
    console.log(`[${category}] ${message}`);
    io.emit('log', entry);
}

/* -------------------------------------------------------------------- */
/*  Bootstrap                                                           */
/* -------------------------------------------------------------------- */

/* -------------------------------------------------------------------- */
/*  SPA Fallback (Angular)                                              */
/* -------------------------------------------------------------------- */

app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
    }
    // Serve index.html for any other route
    res.sendFile(path.join(clientDistPath, 'index.html'));
});

async function bootstrap() {
    emitLog('🚀 מפעיל שרת...', 'SYSTEM', 'info');

    // 1. Load queue (fast)
    await queueService.init();

    // 2. Start HTTP Server immediately so UI is accessible
    httpServer.listen(PORT, () => {
        emitLog(`🌐 שרת פועל על http://localhost:${PORT}`, 'SYSTEM', 'success');

        // 3. Start heavy services in background
        startServices();
    });
}

async function startServices() {
    // Initialise WhatsApp client
    // We don't await here to not block other potential startup logic, 
    // but these are async anyway.
    waManager.init().catch(err => {
        emitLog(`❌ שגיאת אתחול WhatsApp: ${err.message}`, 'WHATSAPP', 'error');
    });

    // Start Telegram bot
    tgBridge.start().catch(err => {
        emitLog(`❌ שגיאת הפעלת Telegram: ${err.message}`, 'TELEGRAM', 'error');
    });
}

bootstrap().catch((err) => {
    console.error('Fatal error during bootstrap:', err);
    process.exit(1);
});
