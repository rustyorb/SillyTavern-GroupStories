const { chromium } = require(process.env.GROUP_STORIES_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const out = path.resolve(process.env.GROUP_STORIES_UI_OUTPUT || 'work/live-ui');
// This hostname resolves only to the local test server, but is an insecure browser origin like LAN HTTP.
const lan = process.env.GROUP_STORIES_TEST_LAN === '1';
const base = lan ? 'http://group-stories-lan.test:8123/' : 'http://127.0.0.1:8123/';
fs.mkdirSync(out, { recursive: true });
const results = [];
const errors = [];
const hostNotices = [];
const check = (name, value) => { assert.ok(value, name); results.push(name); console.log('PASS', name); };
(async () => {
    const browser = await chromium.launch({ headless: true, args: lan ? ['--host-resolver-rules=MAP group-stories-lan.test 127.0.0.1', '--no-proxy-server'] : [] });
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
    await ctx.route('**/thumbnail**', route => {
        if (route.request().url().includes('gs-test-')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') });
        return route.continue();
    });
    async function setup(page) {
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => {
            // Host resize code walks stale autocomplete widgets; retain its exact stack separately.
            if (error.message.includes('cannot call methods on autocomplete prior to initialization') && error.stack?.includes('/scripts/power-user.js:3133:')) hostNotices.push(error.stack);
            else errors.push(error.stack || error.message);
        });
        page.on('console', message => {
            if (message.type() !== 'error') return;
            if (lan && message.text().startsWith('The Cross-Origin-Opener-Policy header has been ignored')) hostNotices.push(message.text());
            else errors.push(message.text());
        });
        await page.goto(base + '?group-stories=1');
        await page.locator('#group-stories-workspace').waitFor({ state: 'visible' });
        await page.evaluate(() => {
            const c = SillyTavern.getContext();
            c.characters.push({ name: 'Mira', avatar: 'gs-test-mira.png', description: 'A reserved nurse, 31, practical and observant.', personality: 'Wry, patient, dislikes being cornered.', first_mes: 'Unadapted source greeting.' },
                { name: 'Jonah', avatar: 'gs-test-jonah.png', description: 'A restaurant manager, 34, grew up with Mira.', personality: 'Talks around uncomfortable subjects.' });
            const service = c.ConnectionManagerRequestService;
            service.getSupportedProfiles = () => [{ id: 'gs-test-a', name: 'Simulated · character A' }, { id: 'gs-test-b', name: 'Simulated · character B' }];
            service.constructPrompt = messages => messages;
            window.gsCalls = [];
            service.sendRequest = async (profile, messages, tokens, custom) => {
                gsCalls.push({ profile, messages, tokens });
                if (window.gsHold) return new Promise(resolve => { window.gsResolve = resolve; });
                if (messages[0].content.startsWith('Choose the next speaker')) return { content: JSON.parse(messages[1].content).eligible[0].id };
                if (messages[0].content.startsWith('Adapt character')) return { content: 'A diner in 2025, just before closing. Mira and Jonah are meeting after years apart.' };
                const mira = messages[0].content.includes('ensemble story: Mira.');
                return { content: mira ? 'Mira sets her cup down carefully. “You still take the late shift?”' : 'Jonah glances at the empty booths. “Someone has to lock up.”' };
            };
        });
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    }
    try {
        const p = await ctx.newPage(); await setup(p);
        if (lan) check('LAN HTTP works with secure context, Web Locks and randomUUID all unavailable', await p.evaluate(() => !isSecureContext && !navigator.locks && !crypto.randomUUID));
        check('Local host identity and nonblank workspace', await p.title() === 'SillyTavern' && await p.locator('.gs-empty').isVisible());
        await p.screenshot({ path: path.join(out, 'group-stories-empty.png') });
        await p.locator('[data-library]').selectOption('gs-test-mira.png'); await p.getByRole('button', { name: '+ Add to cast' }).click();
        await p.locator('[data-library]').selectOption('gs-test-jonah.png'); await p.getByRole('button', { name: '+ Add to cast' }).click();
        await p.getByLabel('Mira connection profile').selectOption('gs-test-a');
        await p.getByLabel('Jonah connection profile').selectOption('gs-test-b');
        await p.getByLabel('Story title').fill('After closing'); await p.getByLabel('Story title').press('Tab');
        await p.locator('[data-field=scene]').fill('A diner in 2025. Two old friends meet after a long silence.'); await p.locator('[data-field=scene]').press('Tab');
        await p.locator('[data-field=opening]').fill('The rain has finally stopped. Jonah turns the sign to CLOSED.'); await p.locator('[data-field=opening]').press('Tab');
        await p.locator('[data-field=mode]').selectOption('influence');
        await p.locator('[data-field=target]').selectOption({ label: 'Mira' });
        await p.getByLabel('Your direction').fill('You lost your job this morning; Jonah does not know.');
        await p.getByRole('button', { name: 'Add direction' }).click();
        check('Private direction labeled in human transcript', await p.locator('.gs-private').count() === 1);
        await p.locator('[data-field=nextSpeaker]').selectOption({ label: 'Mira' });
        await p.getByRole('button', { name: 'Next turn' }).click();
        await p.locator('[data-status]').filter({ hasText: '1 turn completed' }).waitFor();
        await p.locator('[data-field=nextSpeaker]').selectOption({ label: 'Jonah' });
        await p.getByRole('button', { name: 'Next turn' }).click();
        await p.waitForFunction(() => gsCalls.length === 2);
        await p.locator('[data-status]').filter({ hasText: '1 turn completed' }).waitFor();
        const calls = await p.evaluate(() => gsCalls);
        check('Per-character profiles route independently', calls[0].profile === 'gs-test-a' && calls[1].profile === 'gs-test-b');
        check('Real UI private directions reach recipient prompt only', JSON.stringify(calls[0]).includes('lost your job') && !JSON.stringify(calls[1]).includes('lost your job'));
        check('Card greeting is not auto-inserted', !(await p.locator('[data-transcript]').innerText()).includes('Unadapted source greeting'));
        await p.locator('[data-field=mode]').selectOption('narrate');
        await p.getByLabel('Your direction').fill('A delivery driver knocks on the locked door.'); await p.getByRole('button', { name: 'Add direction' }).click();
        await p.screenshot({ path: path.join(out, 'group-stories-desktop.png') });
        const popupPromise = p.waitForEvent('popup');
        await p.getByRole('button', { name: 'Window' }).click();
        const peer = await popupPromise; await setup(peer);
        check('Second view shares saved story and transcript', await peer.getByLabel('Story title').inputValue() === 'After closing' && (await peer.locator('[data-transcript]').innerText()).includes('delivery driver'));
        await p.evaluate(() => { window.gsHold = true; });
        await p.getByRole('button', { name: 'Next turn' }).click();
        await p.waitForFunction(() => Boolean(window.gsResolve));
        const before = await peer.evaluate(() => gsCalls.length);
        await peer.getByRole('button', { name: 'Next turn' }).click();
        await peer.locator('[data-status]').filter({ hasText: 'Already running' }).waitFor();
        check('Database coordination blocks duplicate generation from another view', await peer.evaluate(() => gsCalls.length) === before);
        const eventCount = await p.locator('.gs-event').count();
        await peer.getByRole('button', { name: 'Pause' }).click();
        await p.waitForTimeout(100); await p.evaluate(() => { gsResolve({ content: 'SHOULD_NEVER_APPEAR' }); gsHold = false; });
        await p.locator('[data-status]').filter({ hasText: 'Paused.' }).waitFor();
        check('Pause in second view discards late response in owner view', await p.locator('.gs-event').count() === eventCount && !(await p.locator('[data-transcript]').innerText()).includes('SHOULD_NEVER_APPEAR'));
        await p.reload(); await p.locator('#group-stories-workspace').waitFor({ state: 'visible' });
        check('Reload restores story with generation stopped', await p.getByLabel('Story title').inputValue() === 'After closing' && await p.locator('.gs-event').count() === eventCount);
        // Export contains full backup; public export excludes private direction.
        await p.getByText('Save & export', { exact: true }).click();
        const [backup] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Export story backup' }).click()]);
        await backup.saveAs(path.join(out, 'ui-test-backup.json'));
        const parsed = JSON.parse(fs.readFileSync(path.join(out, 'ui-test-backup.json'), 'utf8'));
        check('Backup export preserves audience and private directions', parsed.events.some(e => e.kind === 'influence' && e.audience.length === 1));
        const [publicText] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Export public transcript' }).click()]);
        await publicText.saveAs(path.join(out, 'ui-test-transcript.txt'));
        check('Public transcript export excludes private directions', !fs.readFileSync(path.join(out, 'ui-test-transcript.txt'), 'utf8').includes('lost your job'));
        await p.getByRole('button', { name: 'New story', exact: true }).click();
        await p.locator('.gs-empty').waitFor();
        await p.getByRole('button', { name: 'Saved stories', exact: true }).click();
        await p.locator('.gs-saved').filter({ hasText: 'After closing' }).first().waitFor();
        check('Saved story archive lists no duplicate entries', await p.locator('.gs-saved').filter({ hasText: 'After closing' }).count() === 1);
        await p.locator('.gs-saved').filter({ hasText: 'After closing' }).click();
        await p.locator('.gs-dialog').waitFor({ state: 'detached' });
        check('Saved story resumes with transcript', await p.locator('.gs-event').count() === eventCount);
        await p.getByRole('button', { name: 'New story', exact: true }).click();
        await p.locator('.gs-empty').waitFor();
        await p.locator('[data-import]').setInputFiles(path.join(out, 'ui-test-backup.json'));
        await p.locator('.gs-private').waitFor();
        check('Backup import restores story and private audience', await p.getByLabel('Story title').inputValue() === 'After closing' && await p.locator('.gs-event').count() === eventCount);
        await setup(p);
        await p.locator('[data-field=directorProfile]').selectOption('gs-test-a');
        await p.locator('[data-field=turnLimit]').fill('2'); await p.locator('[data-field=turnLimit]').press('Tab');
        await p.getByRole('button', { name: 'Play', exact: false }).click();
        await p.locator('[data-status]').filter({ hasText: '2 turns completed' }).waitFor();
        check('Bounded Play with director performs two speaker choices and two character turns', await p.evaluate(() => gsCalls.length) === 4);
        check('Director requests exclude private directions', await p.evaluate(() => gsCalls.filter(c => c.messages[0].content.startsWith('Choose the next speaker')).every(c => !JSON.stringify(c).includes('lost your job'))));
        const sceneBefore = await p.locator('[data-field=scene]').inputValue();
        await p.getByRole('button', { name: 'Adapt original setups' }).click();
        await p.getByRole('button', { name: 'Use this scene' }).waitFor();
        check('Adapted scene waits for review before changing shared state', await p.locator('[data-field=scene]').inputValue() === sceneBefore);
        await p.locator('.gs-dialog textarea').fill('A diner in 2025, fifteen minutes after closing. Two old friends have unfinished business.');
        await p.getByRole('button', { name: 'Use this scene' }).click();
        await p.locator('.gs-dialog').waitFor({ state: 'detached' });
        check('Reviewed adaptation becomes a shared scene change', (await p.locator('[data-field=scene]').inputValue()).includes('unfinished business') && (await p.locator('.gs-event').last().innerText()).includes('SCENE CHANGE'));
        const jonah = p.locator('.gs-person').filter({ hasText: 'Jonah' });
        await jonah.getByRole('button', { name: 'Leave scene' }).click();
        await jonah.getByRole('button', { name: 'Return to scene' }).waitFor();
        await p.locator('[data-field=mode]').selectOption('narrate');
        await p.getByLabel('Your direction').fill('Mira hides an envelope under the counter.'); await p.getByRole('button', { name: 'Add direction' }).click();
        await jonah.getByRole('button', { name: 'Return to scene' }).click();
        await p.locator('[data-field=nextSpeaker]').selectOption({ label: 'Jonah' });
        const callsBeforePresence = await p.evaluate(() => gsCalls.length);
        await p.getByRole('button', { name: 'Next turn' }).click();
        await p.waitForFunction(count => gsCalls.length > count, callsBeforePresence);
        await p.locator('[data-status]').filter({ hasText: '1 turn completed' }).waitFor();
        check('Returning character does not receive events missed while away', !(await p.evaluate(() => JSON.stringify(gsCalls.at(-1)))).includes('hides an envelope'));
        await p.locator('[data-field=mode]').selectOption('speak');
        await p.locator('[data-field=target]').selectOption({ label: 'Mira' });
        const callsBeforeManual = await p.evaluate(() => gsCalls.length);
        await p.getByLabel('Your direction').fill('“I wanted to tell you something,” Mira says.'); await p.getByRole('button', { name: 'Add direction' }).click();
        await p.locator('.gs-event').last().filter({ hasText: 'wanted to tell you' }).waitFor();
        check('Speak as character records a contribution without a model request', await p.evaluate(() => gsCalls.length) === callsBeforeManual);
        await p.screenshot({ path: path.join(out, 'group-stories-desktop.png') });
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(100);
        check('Mobile workspace is visible', await p.locator('#group-stories-workspace').isVisible());
        check('Mobile workspace fills the viewport height', await p.locator('#group-stories-workspace').evaluate(e => e.getBoundingClientRect().height > 800));
        check('Mobile workspace stays within viewport width', await p.locator('#group-stories-workspace').evaluate(e => e.scrollWidth <= 390));
        await p.screenshot({ path: path.join(out, 'group-stories-mobile.png') });
        const concurrency = await p.evaluate(async () => {
            const { createStore } = await import('/scripts/extensions/third-party/group-stories/storage.js');
            const { createCoordinator } = await import('/scripts/extensions/third-party/group-stories/coordinator.js');
            const store = createStore('isolated-coordination-check'); await store.init();
            const legacy = structuredClone(await store.read()); legacy.title = 'A story from v0.1.0';
            await new Promise((resolve, reject) => {
                const request = indexedDB.open('group-stories-v1-isolated-migration-check', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('stories');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const tx = request.result.transaction('stories', 'readwrite');
                    tx.objectStore('stories').put(legacy, 'active');
                    tx.oncomplete = () => { request.result.close(); resolve(); };
                    tx.onerror = () => reject(tx.error);
                };
            });
            const migrated = createStore('isolated-migration-check'); await migrated.init();
            const migration = (await migrated.read()).id === legacy.id && (await migrated.read()).title === legacy.title;
            const peerStore = createStore('isolated-coordination-check'); await peerStore.init();
            await store.update(s => { s.counter = 0; });
            await Promise.all(Array.from({ length: 100 }, (_, i) => (i % 2 ? peerStore : store).update(s => { s.counter++; })));
            const atomic = (await store.read()).counter === 100;
            const a = createCoordinator(store.database, { ttl: 150, heartbeat: 100000 });
            const b = createCoordinator(store.database, { ttl: 150, heartbeat: 100000 });
            let oldLock, release, started;
            const ready = new Promise(resolve => { started = resolve; });
            const first = a.request('test-run', { ifAvailable: true }, async lock => {
                oldLock = lock; started(); await new Promise(resolve => { release = resolve; });
            });
            await ready;
            let blocked = false;
            await b.request('test-run', { ifAvailable: true }, lock => { blocked = lock === null; });
            await new Promise(resolve => setTimeout(resolve, 200));
            let fenced = false, recovered = false;
            await b.request('test-run', { ifAvailable: true }, async lock => {
                if (!lock) throw new Error('Expired owner was not recoverable.');
                try { await store.update(s => { s.title = 'STALE_OWNER_WRITE'; }, oldLock.lease); }
                catch (error) { fenced = error.message.includes('no longer owns'); }
                release(); await first;
                await lock.assertHeld();
                await peerStore.update(s => { s.title = 'NEW_OWNER_WRITE'; }, lock.lease);
                recovered = (await store.read()).title === 'NEW_OWNER_WRITE';
            });
            return { migration, atomic, blocked, fenced, recovered };
        });
        check('100 simultaneous database edits retain every update', concurrency.atomic);
        check('Database upgrade preserves stories saved by v0.1.0', concurrency.migration);
        check('Database ownership is exclusive across independent coordinators', concurrency.blocked);
        check('Expired owner cannot commit a late response', concurrency.fenced);
        check('Expired owner releases without deleting replacement owner and recovery succeeds', concurrency.recovered);
        if (errors.length) console.log('BROWSER ERRORS', JSON.stringify(errors));
        check('No Group Stories runtime errors or unexplained console errors', errors.length === 0);
        fs.writeFileSync(path.join(out, 'ui-check-results.json'), JSON.stringify({ results, errors, hostNotices }, null, 2));
        await peer.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
