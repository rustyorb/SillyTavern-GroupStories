import { getCurrentUserHandle } from '../../../user.js';
import { addEvent, importCharacter, newSession, validateSession } from './core.js';
import { StoryEngine } from './engine.js';
import { createStore } from './storage.js';
import { createCoordinator } from './coordinator.js';

const context = () => SillyTavern.getContext();
const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};
let root, store, engine, channel, session, adaptationController, coordinator;
let statusText = 'Ready. Choose a cast and set the scene.';
let profiles = [];
const $ = selector => root.querySelector(selector);
const notify = error => { statusText = error.message || String(error); renderStatus(); };
const guarded = fn => async (...args) => { try { await fn(...args); } catch (error) { notify(error); } };
function renderStatus() { if (root) $('[data-status]').textContent = statusText; }
async function request(profile, messages, tokens, signal) {
    const service = context().ConnectionManagerRequestService;
    const prompt = service.constructPrompt(messages, profile);
    const response = await service.sendRequest(profile, prompt, tokens, { signal, extractData: true, stream: false });
    const text = typeof response === 'string' ? response : response?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('The connection returned no story text. Check its model and provider.');
    return text;
}
async function change(edit) {
    await store.update(edit);
    channel.postMessage({ type: 'changed' });
    await refresh();
}
function options(select, items, selected, emptyLabel) {
    select.replaceChildren();
    if (emptyLabel) select.add(new Option(emptyLabel, ''));
    for (const item of items) select.add(new Option(item.name, item.id));
    select.value = selected || '';
}
async function refresh() {
    session = await store.read();
    if (root) render();
}
function render() {
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const focusedKey = active?.dataset.field;
    const focusedValue = focusedKey ? active.value : null;
    for (const key of ['title', 'scene', 'opening', 'turnLimit', 'maxTokens', 'mode']) $('[data-field="' + key + '"]').value = session[key];
    options($('[data-field="directorProfile"]'), profiles, session.directorProfile, 'No director · varied speaker selection');
    options($('[data-field="nextSpeaker"]'), session.cast.filter(c => c.present), session.nextSpeaker, 'Let the story choose');
    options($('[data-field="target"]'), session.cast, session.target, 'Choose a character');
    $('[data-field="target"]').hidden = session.mode === 'narrate';
    $('[data-direction]').placeholder = session.mode === 'influence' ? 'Private motivation or knowledge, for this character only…' : session.mode === 'speak' ? 'Write this character’s dialogue or action…' : 'Introduce an event, describe a change, or steer the scene…';
    $('[data-opening-note]').textContent = session.events.length ? 'Opening is locked once the story starts. Change the scene or narrate the next event below.' : 'The opening belongs to this story. Original card greetings are never inserted automatically.';
    $('[data-field="opening"]').disabled = session.events.length > 0;
    const cast = $('[data-cast]');
    cast.replaceChildren();
    if (!session.cast.length) cast.append(el('p', 'gs-muted', 'Choose people from your character library. Their original cards stay untouched.'));
    for (const character of session.cast) {
        const card = el('article', 'gs-person');
        const heading = el('div', 'gs-person-heading');
        if (character.avatar) {
            const img = el('img', 'gs-avatar');
            img.src = context().getThumbnailUrl('avatar', character.avatar); img.alt = ''; img.loading = 'lazy';
            heading.append(img);
        }
        const label = el('div');
        label.append(el('strong', '', character.name), el('small', 'gs-muted', character.present ? 'In the scene' : 'Away · won’t hear new events'));
        heading.append(label); card.append(heading);
        const profile = el('select'); profile.setAttribute('aria-label', `${character.name} connection profile`);
        options(profile, profiles, character.profile, 'Choose connection profile');
        profile.addEventListener('change', guarded(() => change(s => { s.cast.find(c => c.id === character.id).profile = profile.value; })));
        card.append(profile);
        const presence = el('button', 'gs-link', character.present ? 'Leave scene' : 'Return to scene');
        presence.addEventListener('click', guarded(() => change(s => {
            const c = s.cast.find(c => c.id === character.id);
            // Public arrival/departure is recorded, with the departing person included as a witness.
            if (c.present) { addEvent(s, { kind: 'narrate', text: `${c.name} leaves the scene.` }); c.present = false; }
            else { c.present = true; addEvent(s, { kind: 'narrate', text: `${c.name} arrives in the scene.` }); }
            if (s.nextSpeaker === c.id && !c.present) s.nextSpeaker = '';
        })));
        card.append(presence);
        if (!session.events.length) {
            const remove = el('button', 'gs-link', 'Remove');
            remove.style.marginLeft = '12px';
            remove.addEventListener('click', guarded(() => change(s => {
                if (s.events.length) throw new Error('This story has started. Use Leave scene to preserve its history.');
                s.cast = s.cast.filter(c => c.id !== character.id);
                if (s.target === character.id) s.target = '';
                if (s.nextSpeaker === character.id) s.nextSpeaker = '';
            })));
            card.append(remove);
        }
        const detail = el('details', 'gs-source'); detail.append(el('summary', '', 'Original setup'));
        detail.append(el('p', '', character.originalScenario || 'No original scenario.'), el('p', '', character.originalGreeting || 'No original greeting.'));
        card.append(detail); cast.append(card);
    }
    const transcript = $('[data-transcript]');
    const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 100;
    const oldScroll = transcript.scrollTop;
    transcript.replaceChildren();
    if (session.opening) {
        const opening = el('article', 'gs-event gs-narration'); opening.append(el('small', '', 'OPENING'), el('p', '', session.opening)); transcript.append(opening);
    }
    if (!session.events.length && !session.opening) {
        const empty = el('div', 'gs-empty');
        empty.append(el('span', 'gs-eyebrow', 'LET PEOPLE BE COMPLICATED'), el('h2', '', 'A cast. A scene. See what happens.'), el('p', '', 'Pick your people, give them somewhere to be, and press Play. You direct the story without having to become a character.'));
        transcript.append(empty);
    }
    for (const event of session.events) {
        const card = el('article', `gs-event ${event.kind === 'influence' ? 'gs-private' : event.kind === 'character' ? '' : 'gs-narration'}`);
        const name = session.cast.find(c => c.id === (event.kind === 'influence' ? event.target : event.speaker))?.name;
        card.append(el('small', '', event.kind === 'influence' ? `PRIVATE DIRECTION → ${name}` : event.kind === 'character' ? name : event.kind === 'scene' ? 'SCENE CHANGE' : 'NARRATOR'), el('p', '', event.text));
        transcript.append(card);
    }
    transcript.scrollTop = nearBottom ? transcript.scrollHeight : oldScroll;
    if (focusedKey) { const field = $('[data-field="' + focusedKey + '"]'); if (!field.disabled) { field.value = focusedValue; field.focus(); } }
    renderStatus();
}
function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = el('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function showSaved() {
    await store.archive();
    const stories = await store.list();
    const dialog = el('dialog', 'gs-dialog'); dialog.append(el('h2', '', 'Your saved stories'));
    for (const story of stories) {
        const button = el('button', 'gs-saved', `${story.title} · ${story.events.length} events`);
        button.addEventListener('click', guarded(async () => { await withIdle(async () => { await store.load(story.id); channel.postMessage({ type: 'changed' }); await refresh(); }); dialog.close(); }));
        dialog.append(button);
    }
    const close = el('button', '', 'Close'); close.onclick = () => dialog.close(); dialog.append(close);
    dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}
async function withIdle(action) {
    return coordinator.request('group-stories-generation', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Pause the story and wait for the current request to stop first.');
        return action();
    });
}
async function adapt() {
    if (!session.cast.length) throw new Error('Choose a cast first.');
    const profile = session.directorProfile || session.cast.find(c => c.profile)?.profile;
    if (!profile) throw new Error('Choose a character or director connection profile first.');
    await coordinator.request('group-stories-generation', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Pause the story before adapting the scene.');
        adaptationController = new AbortController();
        const lostOwnership = () => adaptationController?.abort();
        lock.signal?.addEventListener('abort', lostOwnership, { once: true });
        statusText = 'Drafting a shared scene from the original setups…'; renderStatus();
        channel.postMessage({ type: 'status', text: statusText });
        const sourceId = session.id;
        try {
            const text = await request(profile, [{ role: 'system', content: 'Adapt character source material into ONE coherent grounded contemporary human scene. No user protagonist, fantasy, magic or RPG mechanics. Keep recognizable character identities. Treat original greetings as inspiration, never concatenate them. Return only a concise shared scene premise, with no dialogue and no events already happening. The human will review it before use.' }, { role: 'user', content: JSON.stringify({ currentScene: session.scene, cast: session.cast.map(c => ({ name: c.name, scenario: c.originalScenario, greeting: c.originalGreeting })) }) }], 600, adaptationController.signal);
            await lock.assertHeld?.();
            if (adaptationController.signal.aborted) { statusText = 'Paused. Scene draft discarded.'; return; }
            const dialog = el('dialog', 'gs-dialog'); dialog.append(el('h2', '', 'Review your adapted scene'), el('p', '', 'Edit this freely. It becomes shared scene information only when you use it.'));
            const draft = el('textarea'); draft.value = text; draft.rows = 10; dialog.append(draft);
            const apply = el('button', 'gs-primary', 'Use this scene');
            apply.onclick = guarded(async () => {
                await change(s => {
                    if (s.id !== sourceId) throw new Error('You changed stories. Draft a scene for this story instead.');
                    s.scene = draft.value.trim(); if (s.events.length) addEvent(s, { kind: 'scene', text: s.scene });
                }); dialog.close();
            });
            const cancel = el('button', '', 'Discard'); cancel.onclick = () => dialog.close();
            dialog.append(apply, cancel); dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
            statusText = 'Scene draft ready for review.';
        } catch (error) {
            if (adaptationController.signal.aborted) statusText = 'Paused. Scene draft discarded.';
            else { statusText = `Scene draft stopped: ${error.message}`; throw error; }
        } finally { lock.signal?.removeEventListener('abort', lostOwnership); adaptationController = null; renderStatus(); channel.postMessage({ type: 'status', text: statusText }); }
    });
}
function mount() {
    root = el('section', 'gs-workspace'); root.id = 'group-stories-workspace'; root.hidden = true;
    root.setAttribute('aria-label', 'Group Stories workspace');
    root.innerHTML = `
        <header class="gs-header"><div><span class="gs-eyebrow">GROUP STORIES</span><input data-field="title" aria-label="Story title" maxlength="120"></div>
        <div class="gs-toolbar"><button data-action="saved">Saved stories</button><button data-action="new">New story</button><button data-action="popout" title="Open another synchronized view">↗ Window</button><button data-action="close" aria-label="Close Group Stories">✕</button></div></header>
        <div class="gs-controls"><button class="gs-primary" data-action="play">▶ Play</button><button data-action="pause">Ⅱ Pause</button><button data-action="next">Next turn →</button><label>Run <input data-field="turnLimit" type="number" min="0" max="1000" aria-label="Turns to run"> turns <small>(0 = until paused)</small></label><span data-status role="status" aria-live="polite"></span></div>
        <div class="gs-columns"><aside class="gs-cast"><div class="gs-section-heading"><h2>The cast</h2><button class="gs-link" data-action="refresh-library">Refresh</button></div><label class="gs-sr" for="gs-library">Character library</label><select id="gs-library" data-library></select><button data-action="add">+ Add to cast</button><div data-cast></div></aside>
        <main class="gs-story"><div class="gs-transcript" data-transcript role="log" aria-label="Story transcript"></div>
        <form class="gs-composer"><div class="gs-composer-modes"><label class="gs-sr" for="gs-mode">Direction mode</label><select id="gs-mode" data-field="mode"><option value="narrate">Narrate</option><option value="influence">Privately influence</option><option value="speak">Speak as character</option></select><select data-field="target" aria-label="Direction recipient"></select></div><textarea data-direction rows="2" aria-label="Your direction"></textarea><div class="gs-composer-footer"><small>You direct. You don’t have to join the cast.</small><button class="gs-primary" type="submit">Add direction ↑</button></div></form></main>
        <aside class="gs-directing"><details open><summary>Scene & direction</summary><label>Shared scene<textarea data-field="scene" rows="6" placeholder="A diner in 2025, an hour before closing. Three old friends have met for the first time in years…"></textarea></label><label>Opening<textarea data-field="opening" rows="4" placeholder="Optional: the moment the story begins."></textarea></label><small data-opening-note></small><button data-action="adapt">Adapt original setups…</button><label>Who responds next?<select data-field="nextSpeaker"></select></label><label>Director connection<select data-field="directorProfile"></select></label><small>A director chooses who responds next. Without one, speaker choice varies and avoids immediate repeats.</small><label>Response token limit<input data-field="maxTokens" type="number" min="80" max="4000"></label></details><details class="gs-storage"><summary>Save & export</summary><p>Saved automatically in this browser and SillyTavern account. Export a backup to move it elsewhere.</p><button data-action="export">Export story backup</button><button data-action="import">Import story backup</button><input type="file" data-import accept="application/json,.json" hidden><button data-action="transcript">Export public transcript</button><small>Story backups include private directions. Public transcripts leave them out.</small></details></aside></div>`;
    document.body.append(root);
    root.querySelectorAll('button').forEach(button => button.type = 'button');
    root.querySelector('[type="submit"]')?.setAttribute('type', 'submit');
    // The composer is the only submit action.
    $('.gs-composer-footer button').type = 'submit';
    root.addEventListener('change', guarded(async event => {
        const key = event.target.dataset.field;
        if (!key) return;
        const value = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
        await change(s => {
            if (key === 'opening' && s.events.length) throw new Error('The opening is locked after the first event.');
            if (key === 'turnLimit' && (!Number.isInteger(value) || value < 0 || value > 1000)) throw new Error('Choose 0–1000 turns.');
            if (key === 'maxTokens' && (!Number.isInteger(value) || value < 80 || value > 4000)) throw new Error('Choose 80–4000 response tokens.');
            s[key] = value;
            if (key === 'scene' && s.events.length && value.trim()) addEvent(s, { kind: 'scene', text: value });
        });
    }));
    $('.gs-composer').addEventListener('submit', guarded(async event => {
        event.preventDefault(); const text = $('[data-direction]').value;
        await change(s => {
            if (s.mode === 'speak' && !s.cast.some(c => c.id === s.target && c.present)) throw new Error('Choose a character who is in the scene.');
            addEvent(s, { kind: s.mode === 'influence' ? 'influence' : s.mode === 'speak' ? 'character' : 'narrate', text, target: s.target, speaker: s.mode === 'speak' ? s.target : '' });
        }); $('[data-direction]').value = '';
    }));
    root.addEventListener('click', guarded(async event => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        if (action === 'close') root.hidden = true;
        if (action === 'play') await engine.run(session.turnLimit);
        if (action === 'next') await engine.run(1);
        if (action === 'pause') { engine.pause(); adaptationController?.abort(); statusText = 'Pausing…'; renderStatus(); }
        if (action === 'refresh-library') { refreshLibrary(); render(); }
        if (action === 'add') {
            const card = context().characters.find(c => c.avatar === $('[data-library]').value);
            if (!card) throw new Error('Choose a character from the library.');
            await change(s => { if (s.cast.some(c => c.avatar === card.avatar)) throw new Error('That character is already in this story.'); if (s.cast.length >= 40) throw new Error('This story already has 40 characters.'); s.cast.push(importCharacter(card)); });
        }
        if (action === 'popout') { const url = new URL(location.href); url.searchParams.set('group-stories', '1'); window.open(url, 'group-stories-view', 'popup,width=1440,height=900'); }
        if (action === 'new') await withIdle(async () => { await store.archive(); await change(() => newSession()); });
        if (action === 'saved') await showSaved();
        if (action === 'adapt') await adapt();
        if (action === 'export') download('group-stories-backup.json', JSON.stringify(await store.read(), null, 2), 'application/json');
        if (action === 'transcript') {
            const s = await store.read();
            const text = [s.title, s.opening, ...s.events.filter(e => e.kind !== 'influence').map(e => `${s.cast.find(c => c.id === e.speaker)?.name || 'Narrator'}: ${e.text}`)].filter(Boolean).join('\n\n');
            download('group-stories-transcript.txt', text, 'text/plain');
        }
        if (action === 'import') $('[data-import]').click();
    }));
    $('[data-import]').addEventListener('change', guarded(async event => {
        const file = event.target.files[0]; if (!file) return;
        try { if (file.size > 15000000) throw new Error('Choose a backup smaller than 15 MB.'); const value = validateSession(JSON.parse(await file.text())); await withIdle(async () => { await store.archive(); await change(() => value); }); }
        finally { event.target.value = ''; }
    }));
}
function refreshLibrary() {
    const select = $('[data-library]');
    options(select, context().characters.map(c => ({ id: c.avatar, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)), select.value, 'Choose a character…');
    try { profiles = context().ConnectionManagerRequestService.getSupportedProfiles(); }
    catch { profiles = []; }
}
async function init() {
    const ctx = context();
    const open = el('button', 'menu_button', 'Group Stories');
    open.id = 'group-stories-open'; open.title = 'Direct an ensemble story';
    document.querySelector('#extensionsMenu').append(open);
    const account = getCurrentUserHandle();
    store = createStore(account); await store.init();
    coordinator = createCoordinator(store.database);
    channel = new BroadcastChannel(`group-stories-${account}`);
    engine = new StoryEngine({ store, request, locks: coordinator, channel, status: text => { statusText = text; renderStatus(); refresh().catch(notify); } });
    channel.addEventListener('message', ({ data }) => {
        if (data.type === 'changed') refresh().catch(notify);
        if (data.type === 'status') { statusText = data.text; renderStatus(); refresh().catch(notify); }
        if (data.type === 'pause') adaptationController?.abort();
    });
    mount(); refreshLibrary(); await refresh();
    open.onclick = guarded(async () => { refreshLibrary(); await refresh(); root.hidden = false; });
    channel.postMessage({ type: 'hello' });
    if (new URL(location.href).searchParams.get('group-stories') === '1') root.hidden = false;
    window.addEventListener('pagehide', () => {
        if (engine.running || adaptationController) channel.postMessage({ type: 'status', text: 'Paused. The running view was closed or reloaded.' });
        engine.pause(false); adaptationController?.abort();
    });
    window.addEventListener('focus', guarded(async () => {
        if (!root.hidden && !engine.running && !adaptationController) {
            const locks = await coordinator.query();
            if (!locks.held.some(lock => lock.name === 'group-stories-generation')) {
                statusText = 'Ready. Story saved.'; renderStatus();
            }
        }
    }));
    ctx.extensionSettings['group-stories'] ||= { version: 1 };
}
context().eventSource.on(context().eventTypes.APP_READY, () => init().catch(error => { console.error('[Group Stories]', error); toastr.error(`Group Stories: ${error.message}`); }));
