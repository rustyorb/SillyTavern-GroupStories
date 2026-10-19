import { newSession } from './core.js';

export function createStore(account) {
    // IndexedDB survives reloads; account-specific database prevents cross-account story access in a shared browser.
    const database = new Promise((resolve, reject) => {
        const request = indexedDB.open(`group-stories-v1-${account}`, 2);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('stories')) request.result.createObjectStore('stories');
            if (!request.result.objectStoreNames.contains('locks')) request.result.createObjectStore('locks');
        };
        request.onsuccess = () => {
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Close other Group Stories tabs once, then reload to finish the storage update.'));
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
    // One read/write transaction serializes read-edit-save across tabs, including over LAN HTTP.
    async function update(edit, lease) {
        const db = await database;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['stories', 'locks'], 'readwrite');
            let failure;
            const fail = error => { failure = error; tx.abort(); };
            const mutate = () => {
                const request = tx.objectStore('stories').get('active');
                request.onsuccess = () => {
                    try {
                        const current = request.result;
                        const replacement = edit(current);
                        if (replacement?.then) throw new Error('Story edits must be synchronous.');
                        tx.objectStore('stories').put(replacement || current, 'active');
                    } catch (error) { fail(error); }
                };
            };
            if (lease) {
                const check = tx.objectStore('locks').get(lease.name);
                check.onsuccess = () => {
                    if (check.result?.owner !== lease.owner || check.result.expires <= Date.now()) fail(new Error('This view no longer owns the run. Its late response was discarded.'));
                    else mutate();
                };
            } else mutate();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(failure || tx.error);
            tx.onabort = () => reject(failure || tx.error || new Error('Story save was interrupted.'));
        });
    }
    return {
        read, update, database,
        async init() { await update(current => current || newSession()); },
        async list() { const all = (await access('readonly', s => s.getAll())).filter(x => x?.id); return [...new Map(all.map(s => [s.id, s])).values()]; },
        async archive() { const value = await read(); await access('readwrite', s => s.put(value, value.id)); },
        async load(id) { const value = await access('readonly', s => s.get(id)); if (!value) throw new Error('Story not found.'); await this.update(() => value); },
    };
}
