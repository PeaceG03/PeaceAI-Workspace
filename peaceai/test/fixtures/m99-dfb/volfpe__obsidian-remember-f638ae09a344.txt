// Device id + the per-device append-only event logs
// (<deviceId>-<randomId>.rememberlog).
// These logs are the only scheduling source of truth. IndexedDB is a disposable
// local read index built from them.
// Events are written and read only inside the Remember root folder; logs anywhere
// else are ignored. The root folder setting warns users to move the folder (and the
// logs with it) instead of leaving history behind.

import type { App, TFile } from 'obsidian';
import type { CardEvent, LogEvent, ReviewEvent } from './core/events';
import { randomId } from './core/id';
import { ensureFolder, parentPath } from './vault-folders';

const DEVICE_ID_KEY = 'remember-device-id';
const ACTIVE_LOG_KEY_PREFIX = 'remember-active-log:';
const LOG_EXTENSION = '.rememberlog';
export const MAX_LOG_BYTES = 1024 * 1024;

const appendQueues = new WeakMap<App, Map<string, Promise<void>>>();

/** Device-local (localStorage never syncs). Losing it is harmless: a new log starts, old ones keep being read. */
export function getDeviceId(app: App): string {
	const stored: unknown = app.loadLocalStorage(DEVICE_ID_KEY);
	if (typeof stored === 'string' && stored !== '') return stored;
	const minted = randomId();
	app.saveLocalStorage(DEVICE_ID_KEY, minted);
	return minted;
}

function activeLogStorageKey(rootFolder: string): string {
	return `${ACTIVE_LOG_KEY_PREFIX}${rootFolder}`;
}

function logPath(rootFolder: string, name: string): string {
	return rootFolder === '' ? name : `${rootFolder}/${name}`;
}

function newOwnLogPath(app: App, rootFolder: string): string {
	return logPath(rootFolder, `${getDeviceId(app)}-${randomId()}${LOG_EXTENSION}`);
}

function storedActiveLogPath(app: App, rootFolder: string): string | null {
	const stored: unknown = app.loadLocalStorage(activeLogStorageKey(rootFolder));
	if (typeof stored !== 'string') return null;
	const name = stored.slice(stored.lastIndexOf('/') + 1);
	return parentPath(stored) === rootFolder && name.startsWith(`${getDeviceId(app)}-`) && isLogFile(name)
		? stored
		: null;
}

/** True append via the adapter — no read-modify-write. */
export async function appendEvent(app: App, rootFolder: string, event: CardEvent): Promise<void> {
	await appendLogEvent(app, rootFolder, event);
}

/** Appends a tombstone for a reversible event. The original event remains in the log. */
export async function appendUndoEvent(app: App, rootFolder: string, eventId: string): Promise<void> {
	await appendLogEvent(app, rootFolder, { v: 1, k: 'u', t: new Date().toISOString(), u: eventId });
}

async function appendLogEvent(app: App, rootFolder: string, event: LogEvent): Promise<void> {
	const queues = appendQueues.get(app) ?? new Map<string, Promise<void>>();
	appendQueues.set(app, queues);
	const previous = queues.get(rootFolder) ?? Promise.resolve();
	const next = previous.catch(() => undefined).then(async () => {
		await ensureFolder(app, rootFolder);
		const line = JSON.stringify(event) + '\n';
		const lineBytes = new TextEncoder().encode(line).byteLength;
		let path = storedActiveLogPath(app, rootFolder);
		const stat = path === null ? null : await app.vault.adapter.stat(path);
		if (path === null || stat === null || stat.size + lineBytes > MAX_LOG_BYTES) {
			do path = newOwnLogPath(app, rootFolder);
			while (await app.vault.adapter.exists(path));
			app.saveLocalStorage(activeLogStorageKey(rootFolder), path);
		}
		await app.vault.adapter.append(path, line);
	});
	queues.set(rootFolder, next);
	try {
		await next;
	} finally {
		if (queues.get(rootFolder) === next) queues.delete(rootFolder);
	}
}

/** Every review log inside the root folder. */
export function listLogFiles(app: App, rootFolder: string): TFile[] {
	return app.vault
		.getFiles()
		.filter((file) => isLogFile(file.name) && parentPath(file.path) === rootFolder);
}

export interface ReviewLogFile {
	path: string;
	size: number;
	mtime: number;
}

/** Review logs known to the vault, plus a newly-created active log before indexing catches up. */
export async function listReviewLogFiles(app: App, rootFolder: string): Promise<ReviewLogFile[]> {
	const paths = new Set(listLogFiles(app, rootFolder).map((file) => file.path));
	if (rootFolder === '' || (await app.vault.adapter.exists(rootFolder))) {
		const listed = await app.vault.adapter.list(rootFolder);
		for (const path of listed.files) {
			const name = path.slice(path.lastIndexOf('/') + 1);
			if (parentPath(path) === rootFolder && isLogFile(name)) paths.add(path);
		}
	}
	const active = storedActiveLogPath(app, rootFolder);
	if (active !== null && (await app.vault.adapter.exists(active))) paths.add(active);
	const files: ReviewLogFile[] = [];
	for (const path of paths) {
		const stat = await app.vault.adapter.stat(path);
		if (stat?.type === 'file') files.push({ path, size: stat.size, mtime: stat.mtime });
	}
	return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function readReviewLogFile(app: App, path: string): Promise<string> {
	return app.vault.adapter.read(path);
}

/** Active reviews across every device's log. Undo tombstones are applied independent of file order. */
export async function readEvents(app: App, rootFolder: string): Promise<ReviewEvent[]> {
	return (await readCardEvents(app, rootFolder)).filter((event): event is ReviewEvent => event.k === 'r');
}

/** Active reviews and temporary card actions across every device's log. */
export async function readCardEvents(app: App, rootFolder: string): Promise<CardEvent[]> {
	const seenEvents = new Set<string>();
	const events: CardEvent[] = [];
	const undone = new Set<string>();
	const paths = new Set((await listReviewLogFiles(app, rootFolder)).map((file) => file.path));
	for (const path of paths) {
		let content: string;
		try {
			content = await app.vault.adapter.read(path);
		} catch (error) {
			console.warn(`Remember: cannot read ${path}; skipping it`, error);
			continue;
		}
		for (const line of content.split('\n')) {
			if (line.trim() === '') continue;
			const event = parseLogEventLine(line);
			if (!event) {
				console.warn(`Remember: skipping bad log line in ${path}: ${line}`);
				continue;
			}
			if (event.k === 'u') {
				undone.add(event.u);
				continue;
			}
			if (seenEvents.has(event.i)) continue;
			seenEvents.add(event.i);
			events.push(event);
		}
	}
	return events.filter((event) => !undone.has(event.i));
}

function isLogFile(name: string): boolean {
	return name.endsWith(LOG_EXTENSION);
}

export function parseLogEventLine(line: string): LogEvent | null {
	try {
		const value: unknown = JSON.parse(line);
		if (typeof value !== 'object' || value === null) return null;
		const { v, k, i, t, c, s, r, dr, x, u } = value as Record<string, unknown>;
		if (v !== 1) return null;
		if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) return null;
		if (k === 'u') {
			if (typeof u !== 'string' || u === '') return null;
			return { v, k, t, u };
		}
		if (typeof i !== 'string' || i === '') return null;
		if (typeof c !== 'string' || c === '') return null;
		if (k === 'b') {
			if (typeof x !== 'string' || Number.isNaN(Date.parse(x))) return null;
			return { v, k, i, t, c, x };
		}
		if (k !== 'r') return null;
		if (typeof s !== 'number' || !Number.isInteger(s) || s < 0) return null;
		if (typeof dr !== 'number' || !Number.isFinite(dr) || dr <= 0 || dr > 1) return null;
		if (r === 1 || r === 2 || r === 3 || r === 4) return { v, k, i, t, c, s, r, dr };
		return null;
	} catch {
		return null;
	}
}
