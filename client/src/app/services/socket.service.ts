import { Injectable, signal, computed } from '@angular/core';
import { io, Socket } from 'socket.io-client';

export interface LogEntry {
    timestamp: string;
    message: string;
    category?: string;
    level: 'info' | 'success' | 'error' | 'warning';
}

export interface WaStatus {
    status: string;
}

@Injectable({ providedIn: 'root' })
export class SocketService {
    private socket: Socket;

    /** Reactive signals — zoneless, no overhead */
    readonly logs = signal<LogEntry[]>([]);
    readonly waStatus = signal<string>('disconnected');
    readonly qrCode = signal<string | null>(null);
    readonly queueCount = signal<number>(0);
    readonly connected = signal<boolean>(false);

    /** Derived signals */
    readonly isReady = computed(() => this.waStatus() === 'ready');

    constructor() {
        this.socket = io('http://localhost:3000', {
            transports: ['websocket', 'polling'],
        });

        this.socket.on('connect', () => {
            this.connected.set(true);
            this.addLog({ timestamp: new Date().toISOString(), message: '🟢 מחובר לשרת', level: 'success' });
        });

        this.socket.on('disconnect', () => {
            this.connected.set(false);
            this.addLog({ timestamp: new Date().toISOString(), message: '🔴 התנתק מהשרת', level: 'error' });
        });

        this.socket.on('log', (entry: LogEntry) => {
            this.addLog(entry);
        });

        this.socket.on('wa:status', (data: WaStatus) => {
            this.waStatus.set(data.status);
        });

        this.socket.on('wa:qr', (data: { qr: string }) => {
            this.qrCode.set(data.qr);
        });

        this.socket.on('wa:ready', () => {
            this.qrCode.set(null);
        });

        this.socket.on('queue:added', (data: { count: number }) => {
            this.queueCount.set(data.count);
        });

        this.socket.on('queue:removed', (data: { count: number }) => {
            this.queueCount.set(data.count);
        });

        this.socket.on('queue:sent', (data: { remaining: number }) => {
            this.queueCount.set(data.remaining);
        });

        this.socket.on('queue:loaded', (data: { count: number }) => {
            this.queueCount.set(data.count);
        });

        this.socket.on('queue:update', (data: { count: number }) => {
            this.queueCount.set(data.count);
        });
    }

    private addLog(entry: LogEntry) {
        this.logs.update((prev) => {
            const next = [...prev, entry];
            return next.length > 500 ? next.slice(-500) : next; // cap at 500
        });
    }

    clearLogs() {
        this.logs.set([]);
    }
}
