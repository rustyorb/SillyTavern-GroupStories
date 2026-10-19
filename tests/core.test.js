import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSession, importCharacter, addEvent, characterPrompt, directorPrompt, visibleEvents, chooseSpeaker, validateSession } from '../core.js';
import { StoryEngine } from '../engine.js';

function story() {
    const s = newSession(); s.scene = 'A quiet diner, 2025.';
    s.cast = ['Alice', 'Bea', 'Cole'].map(name => ({ ...importCharacter({ name, avatar: `${name}.png` }), profile: 'local' }));
    return s;
}
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
    const engine = new StoryEngine({ store, request, locks, channel, status: text => reports.push(text) });
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
