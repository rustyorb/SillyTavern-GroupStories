import { uid } from './core.js';

// Web Locks are HTTPS/localhost only. IndexedDB transactions work on ordinary LAN HTTP.
// Expiring ownership recovers closed/crashed views; fenced story commits reject stale owners.
export function createCoordinator(database, { ttl = 12000, heartbeat = 2000 } = {}) {
    async function transaction(mode, action) {
        const db = await database;
        return new Promise((resolve, reject) => {
            const tx = db.transaction('locks', mode);
            let result, failure;
            const done = value => { result = value; };
            try { action(tx.objectStore('locks'), done); } catch (error) { failure = error; tx.abort(); }
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(failure || tx.error);
            tx.onabort = () => reject(failure || tx.error || new Error('Run coordination failed.'));
        });
    }
    const read = name => transaction('readonly', (store, done) => { const req = store.get(name); req.onsuccess = () => done(req.result); });
    return {
        async request(name, { ifAvailable }, callback) {
            if (!ifAvailable) throw new Error('Run coordination requires an immediate ownership check.');
            const owner = uid();
            const acquired = await transaction('readwrite', (store, done) => {
                const req = store.get(name);
                req.onsuccess = () => {
                    if (req.result && req.result.expires > Date.now()) return done(false);
                    store.put({ name, owner, expires: Date.now() + ttl }, name); done(true);
                };
            });
            if (!acquired) return callback(null);
            const controller = new AbortController();
            const lose = () => controller.abort(new Error('Run ownership expired.'));
            const renew = () => transaction('readwrite', (store, done) => {
                const req = store.get(name);
                req.onsuccess = () => {
                    if (req.result?.owner !== owner || req.result.expires <= Date.now()) return done(false);
                    store.put({ name, owner, expires: Date.now() + ttl }, name); done(true);
                };
            }).then(ok => { if (!ok) lose(); }, lose);
            const timer = setInterval(renew, heartbeat);
            const lock = { name, lease: { name, owner }, signal: controller.signal,
                async assertHeld() {
                    const current = await read(name);
                    if (controller.signal.aborted || current?.owner !== owner || current.expires <= Date.now()) {
                        lose(); throw new Error('This view no longer owns the run. Start it again from the active view.');
                    }
                },
            };
            try { return await callback(lock); }
            finally {
                clearInterval(timer);
                await transaction('readwrite', (store, done) => {
                    const req = store.get(name);
                    req.onsuccess = () => { if (req.result?.owner === owner) store.delete(name); done(); };
                });
            }
        },
        async query() {
            return transaction('readonly', (store, done) => {
                const req = store.getAll();
                req.onsuccess = () => done({ held: req.result.filter(lock => lock.expires > Date.now()), pending: [] });
            });
        },
    };
}
