import { newSession } from './core.js';

export function createStore(account) {
    // IndexedDB survives reloads; account-specific database prevents cross-account story access in a shared browser.
    const database = new Promise((resolve, reject) => {
        const request = indexedDB.open(`group-stories-v1-${account}`, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('stories');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    async function access(mode, action) {
        const db = await database;
        return new Promise((resolve, reject) => {
            const tx = db.transaction('stories', mode);
            const req = action(tx.objectStore('stories'));
            tx.oncomplete = () => resolve(req.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Story save was interrupted.'));
        });
    }
    const read = () => access('readonly', s => s.get('active'));
    const write = value => access('readwrite', s => s.put(value, 'active'));
    return {
        read,
        async init() { await navigator.locks.request('group-stories-state', async () => { if (!await read()) await write(newSession()); }); },
        async update(edit) {
            return navigator.locks.request('group-stories-state', async () => {
                const value = await read();
                const replacement = edit(value);
                await write(replacement || value);
            });
        },
        async list() { const all = (await access('readonly', s => s.getAll())).filter(x => x?.id); return [...new Map(all.map(s => [s.id, s])).values()]; },
        async archive() { const value = await read(); await access('readwrite', s => s.put(value, value.id)); },
        async load(id) { const value = await access('readonly', s => s.get(id)); if (!value) throw new Error('Story not found.'); await this.update(() => value); },
    };
}
