import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uid, newSession, importCharacter, addEvent, characterPrompt, directorPrompt, visibleEvents, chooseSpeaker, validateSession, speakerName, upgradeSession } from '../core.js';
import { StoryEngine } from '../engine.js';

function story() {
    const s = newSession(); s.scene = 'A quiet diner, 2025.';
    s.cast = ['Alice', 'Bea', 'Cole'].map(name => ({ ...importCharacter({ name, avatar: `${name}.png` }), profile: 'local' }));
    return s;
}
test('IDs remain unique v4 UUIDs when insecure HTTP does not expose randomUUID', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
    try {
        Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
        const ids = Array.from({ length: 100 }, uid);
        assert.equal(new Set(ids).size, 100);
        for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
        if (descriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor);
        else delete globalThis.crypto.randomUUID;
    }
});
test('private knowledge is absent from other character prompts and director, across subsequent public turns', () => {
    const s = story(); const [a, b] = s.cast;
    addEvent(s, { kind: 'influence', target: a.id, text: 'SECRET: you lost your job this morning.' });
    addEvent(s, { kind: 'character', speaker: a.id, text: 'Coffee, please.' });
    assert.match(JSON.stringify(characterPrompt(s, a)), /lost your job/);
    assert.doesNotMatch(JSON.stringify(characterPrompt(s, b)), /lost your job/);
    assert.doesNotMatch(JSON.stringify(directorPrompt(s)), /lost your job/);
    assert.equal(visibleEvents(s, b.id).length, 1);
});
test('an absent character does not acquire events retroactively; private directions can still reach them', () => {
    const s = story(); const b = s.cast[1]; b.present = false;
    addEvent(s, { kind: 'narrate', text: 'Alice admits taking the money.' });
    addEvent(s, { kind: 'influence', target: b.id, text: 'You feel uneasy outside.' });
    b.present = true;
    const prompt = JSON.stringify(characterPrompt(s, b));
    assert.doesNotMatch(prompt, /admits taking/); assert.match(prompt, /uneasy outside/);
});
test('import preserves source setup separately and does not inject greeting, scenario or another card into prompts', () => {
    const s = story(); s.cast[0].originalGreeting = 'Hello {{user}}, WIZARD_GREETING';
    s.cast[0].originalScenario = 'WIZARD_SCENARIO'; s.cast[1].description = 'OTHER_CARD_SECRET';
    const prompt = JSON.stringify(characterPrompt(s, s.cast[0]));
    assert.doesNotMatch(prompt, /WIZARD_|OTHER_CARD_SECRET/);
    assert.equal(validateSession(JSON.parse(JSON.stringify(s))).id, s.id);
});
test('manual choice and absence are respected; automatic selection avoids immediate repeat', () => {
    const s = story(); const a = s.cast[0];
    addEvent(s, { kind: 'character', speaker: a.id, text: 'Hello.' });
    assert.notEqual(chooseSpeaker(s, () => 0).id, a.id);
    s.nextSpeaker = a.id; assert.equal(chooseSpeaker(s).id, a.id);
    a.present = false; assert.throws(() => chooseSpeaker(s), /away/);
});
test('malformed private audience and generation limits are rejected on import', () => {
    const s = story(); addEvent(s, { kind: 'influence', target: s.cast[0].id, text: 'Private.' });
    s.events[0].audience.push(s.cast[1].id); assert.throws(() => validateSession(s), /audience/);
    const t = story(); t.turnLimit = -1; assert.throws(() => validateSession(t), /limits/);
});
function harness(request) {
    let state = story(); const listeners = []; const reports = [];
    const store = { read: async () => structuredClone(state), update: async edit => { const copy = structuredClone(state); const result = edit(copy); state = result || copy; } };
    let held = false;
    const locks = { request: async (name, options, callback) => { if (held) return callback(null); held = true; try { return await callback({ name }); } finally { held = false; } } };
    const channel = { addEventListener: (_, cb) => listeners.push(cb), postMessage: data => { for (const callback of listeners) callback({ data }); } };
    const engine = new StoryEngine({ store, request, locks, channel, status: text => reports.push(text), wait: async () => {} });
    return { engine, store, locks, channel, reports, get state() { return state; } };
}
test('bounded run commits exactly the requested turns and honors character profiles', async () => {
    const used = []; const h = harness(async profile => { used.push(profile); return 'A measured reply.'; });
    await h.engine.run(2); assert.equal(h.state.events.length, 2); assert.deepEqual(used, ['local', 'local']); assert.equal(h.engine.running, false);
});
test('pause discards a late response even if provider ignores cancellation', async () => {
    let resolve, started; const ready = new Promise(r => { started = r; });
    const h = harness(async () => { started(); return new Promise(r => { resolve = r; }); });
    const run = h.engine.run(0); await ready; h.engine.pause(); resolve('Late response'); await run;
    assert.equal(h.state.events.length, 0); assert.match(h.reports.at(-1), /Paused/);
});
test('a second view cannot start a second loop, and can pause the owner', async () => {
    let resolve, started; const ready = new Promise(r => { started = r; }); let calls = 0;
    const h = harness(async () => { calls++; started(); return new Promise(r => { resolve = r; }); });
    const peer = new StoryEngine({ store: h.store, locks: h.locks, channel: h.channel, request: async () => { calls++; return 'Duplicate'; }, status: () => {} });
    const run = h.engine.run(0); await ready; await peer.run(1); assert.equal(calls, 1);
    peer.pause(); resolve('Late response'); await run; assert.equal(h.state.events.length, 0);
});
test('directions arriving during generation invalidate the stale response', async () => {
    let resolve, started; const ready = new Promise(r => { started = r; });
    const h = harness(async () => { started(); return new Promise(r => { resolve = r; }); });
    const run = h.engine.run(1); await ready;
    await h.store.update(s => { addEvent(s, { kind: 'narrate', text: 'A phone rings.' }); });
    resolve('Stale response'); await run;
    assert.equal(h.state.events.length, 1); assert.match(h.reports.at(-1), /changed during this turn/);
});
test('invalid director output stops without generating a character turn', async () => {
    let calls = 0; const h = harness(async () => { calls++; return '{}'; });
    await h.store.update(s => { s.directorProfile = 'director'; }); await h.engine.run(1);
    assert.equal(calls, 1); assert.equal(h.state.events.length, 0); assert.match(h.reports.at(-1), /valid character id/);
});
test('empty provider output stops visibly without appending a turn', async () => {
    const h = harness(async () => ''); await h.engine.run(1);
    assert.equal(h.state.events.length, 0); assert.match(h.reports.at(-1), /empty response/);
});
test('pause before an asynchronous lock grant prevents that run from starting', async () => {
    let grant; let calls = 0; const h = harness(async () => { calls++; return 'Unexpected'; });
    h.engine.locks = { request: (name, options, callback) => new Promise(resolve => { grant = () => resolve(callback({ name })); }) };
    const pending = h.engine.run(1); h.engine.pause(); grant(); await pending;
    assert.equal(calls, 0); assert.equal(h.state.events.length, 0);
});
test('persona participates in character context, macros resolve, and director never chooses the human', () => {
    const s = story(); s.participant = { id: 'alex.png', name: 'Alex', avatar: 'alex.png', description: 'A documentary photographer.' };
    s.cast[0].description = '{{char}} went to college with {{user}}.';
    addEvent(s, { kind: 'user', text: 'Can we talk about last summer?' });
    const prompt = JSON.stringify(characterPrompt(s, s.cast[0]));
    assert.match(prompt, /Alice went to college with Alex/); assert.match(prompt, /documentary photographer/);
    assert.match(prompt, /Never write their dialogue/); assert.match(prompt, /Can we talk/);
    assert.doesNotMatch(prompt, /No user character exists/);
    const director = JSON.parse(directorPrompt(s)[1].content);
    assert.equal(director.humanParticipant, 'Alex'); assert.ok(director.eligible.every(c => c.id !== 'alex.png'));
    assert.equal(director.recentPublicEvents[0].speaker, 'Alex');
});
test('human message identities persist when switching persona and absent characters do not hear them', () => {
    const s = story(); s.participant = { id: 'a', name: 'Alex', avatar: '', description: '' }; s.cast[1].present = false;
    const event = addEvent(s, { kind: 'user', text: 'Please keep the envelope safe.' });
    s.participant = { id: 'b', name: 'Blair', avatar: '', description: '' };
    assert.equal(speakerName(s, event), 'Alex'); assert.equal(event.persona.id, 'a');
    assert.equal(visibleEvents(s, s.cast[1].id).length, 0);
    assert.equal(validateSession(JSON.parse(JSON.stringify(s))).events[0].persona.name, 'Alex');
});
test('old backups retain observer mode and receive safe pacing defaults', () => {
    const s = story(); s.mode = 'narrate'; delete s.replyDelay; delete s.participant;
    validateSession(s); assert.equal(s.replyDelay, 5); assert.equal(s.participant, null); assert.equal(s.mode, 'narrate');
    assert.equal(upgradeSession(s).id, s.id);
    s.replyDelay = -1; assert.throws(() => validateSession(s), /delay/);
    const t = story(); assert.throws(() => addEvent(t, { kind: 'user', text: 'Hello.' }), /persona/);
});
test('reply timer waits between turns, not before Next turn or after the final turn', async () => {
    let calls = 0; const waited = []; const h = harness(async () => { calls++; return 'A reply.'; });
    h.engine.wait = async ms => { if (ms > 50) { assert.equal(calls, 1); waited.push(ms); } };
    await h.store.update(s => { s.replyDelay = 2; }); await h.engine.run(2);
    assert.deepEqual(waited, [1000, 1000]); assert.equal(calls, 2); assert.ok(h.reports.some(s => /Next reply in 2s/.test(s)));
});
test('pause during a long reply timer releases immediately without starting another request', async () => {
    let entered; const waiting = new Promise(resolve => { entered = resolve; }); let calls = 0;
    const h = harness(async () => { calls++; return 'A reply.'; });
    h.engine.wait = ms => { if (ms > 50) { entered(); return new Promise(() => {}); } return Promise.resolve(); };
    await h.store.update(s => { s.replyDelay = 300; });
    const run = h.engine.run(0); await waiting; h.engine.pause(); await run;
    assert.equal(calls, 1); assert.equal(h.state.events.length, 1); assert.equal(h.engine.running, false);
});
test('pause releases run ownership even when a provider never resolves', async () => {
    let entered; const started = new Promise(resolve => { entered = resolve; });
    const h = harness(async () => { entered(); return new Promise(() => {}); });
    const run = h.engine.run(1); await started; h.engine.pause(); await run;
    assert.equal(h.engine.running, false); assert.equal(h.state.events.length, 0);
});
