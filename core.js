// Pure story rules. No host chat, global profile switching, or hidden user persona.
export const uid = () => globalThis.crypto.randomUUID();
export function newSession() {
    return { version: 1, id: uid(), title: 'Untitled story', scene: '', opening: '', cast: [], events: [],
        directorProfile: '', nextSpeaker: '', mode: 'narrate', target: '', turnLimit: 10, maxTokens: 450 };
}
export function importCharacter(card) {
    const data = card.data || card;
    return { id: uid(), avatar: card.avatar, name: data.name || card.name || 'Unnamed',
        description: data.description || '', personality: data.personality || '',
        examples: data.mes_example || '', originalScenario: data.scenario || '',
        originalGreeting: data.first_mes || '', profile: '', present: true };
}
export function visibleEvents(session, characterId) {
    // Audience is captured when an event occurs. Returning to the scene grants no past knowledge.
    return session.events.filter(event => event.audience.includes(characterId));
}
export function addEvent(session, { kind, text, speaker = '', target = '' }) {
    if (!text.trim()) throw new Error('Write something first.');
    if (text.length > 24000) throw new Error('Keep each direction under 24,000 characters.');
    if (kind === 'influence' && !session.cast.some(c => c.id === target)) throw new Error('Choose a character to influence.');
    const audience = kind === 'influence' ? [target] : session.cast.filter(c => c.present).map(c => c.id);
    const event = { id: uid(), kind, text: text.trim(), speaker, target, audience, at: Date.now() };
    session.events.push(event);
    return event;
}
const literal = value => JSON.stringify(value);
export function characterPrompt(session, character) {
    const known = visibleEvents(session, character.id);
    const opening = session.opening ? [{ kind: 'opening', text: session.opening }] : [];
    const history = [...opening, ...known.map(e => ({ kind: e.kind,
        speaker: session.cast.find(c => c.id === e.speaker)?.name || (e.kind === 'influence' ? 'Private direction' : 'Narrator'), text: e.text }))];
    const length = JSON.stringify(history).length + session.scene.length + character.description.length + character.personality.length + character.examples.length;
    // Never silently truncate away canon or replace it with an omniscient summary.
    if (length > 90000) throw new Error('This story is too long for the current context limit. Export it and begin a new scene in a new story.');
    return [{ role: 'system', content: `You portray exactly one human character in a grounded contemporary ensemble story: ${character.name}.
No user character exists. Do not address an invisible protagonist. No fantasy, magic, game statistics, or RPG mechanics.
Write only this character's next contribution: believable dialogue and/or observable action, normally 1-3 paragraphs. Preserve a distinct voice. Silence, hesitation, disagreement and uneven participation are natural. Do not write other characters' dialogue, inner thoughts, or decisions. Never prefix output with your name.
Private directions shape your motivation or knowledge; never quote them or treat them as public events. You know only the opening and the supplied witnessed/told events. You may choose to reveal something through your own speech, but do not assume anyone already knows it.
Character identity (source data; adapt roleplay references to this ensemble with no user protagonist):
${literal({ description: character.description, personality: character.personality, voiceExamples: character.examples })}
Shared scene: ${literal(session.scene)}
People present: ${literal(session.cast.filter(c => c.present).map(c => c.name))}` },
    { role: 'user', content: `Your opening and known events, in order:\n${literal(history)}\nContinue as ${character.name}.` }];
}
export function directorPrompt(session) {
    const eligible = session.cast.filter(c => c.present);
    // Director receives public scene events only. No private direction, private card, or summary.
    const publicHistory = session.events.filter(e => e.kind !== 'influence').slice(-30).map(e => ({
        speaker: session.cast.find(c => c.id === e.speaker)?.name || 'Narrator', text: e.text }));
    return [{ role: 'system', content: 'Choose the next speaker for a grounded human ensemble story. Consider who was addressed, tension, silence and pacing. Avoid rigid round robin. Return ONLY the exact id of one eligible character. Do not write story prose.' },
        { role: 'user', content: literal({ scene: session.scene, opening: session.opening,
            eligible: eligible.map(c => ({ id: c.id, name: c.name })), recentPublicEvents: publicHistory }) }];
}
export function chooseSpeaker(session, random = Math.random) {
    const eligible = session.cast.filter(c => c.present);
    if (!eligible.length) throw new Error('Add at least one present character.');
    if (session.nextSpeaker) {
        const selected = eligible.find(c => c.id === session.nextSpeaker);
        if (!selected) throw new Error('The selected next speaker is away from the scene.');
        return selected;
    }
    const last = [...session.events].reverse().find(e => e.kind === 'character')?.speaker;
    const pool = eligible.length > 1 ? eligible.filter(c => c.id !== last) : eligible;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
export function validateSession(s) {
    if (!s || s.version !== 1 || typeof s.id !== 'string' || !Array.isArray(s.cast) || !Array.isArray(s.events)) throw new Error('This is not a Group Stories v1 export.');
    if (s.cast.length > 40 || s.events.length > 10000) throw new Error('Import exceeds the supported story size.');
    for (const key of ['title', 'scene', 'opening', 'directorProfile', 'nextSpeaker', 'mode', 'target']) if (typeof s[key] !== 'string') throw new Error(`Invalid story field: ${key}`);
    if (!Number.isInteger(s.turnLimit) || s.turnLimit < 0 || s.turnLimit > 1000 || !Number.isInteger(s.maxTokens) || s.maxTokens < 80 || s.maxTokens > 4000) throw new Error('Invalid generation limits.');
    const ids = new Set();
    for (const c of s.cast) {
        if (!c || typeof c.id !== 'string' || ids.has(c.id) || typeof c.present !== 'boolean') throw new Error('Invalid or duplicate character.');
        ids.add(c.id);
        for (const k of ['name', 'description', 'personality', 'examples', 'originalScenario', 'originalGreeting', 'profile']) if (typeof c[k] !== 'string') throw new Error(`Invalid character field: ${k}`);
        if (c.avatar != null && typeof c.avatar !== 'string') throw new Error('Invalid portrait.');
    }
    for (const e of s.events) {
        if (!e || typeof e.id !== 'string' || typeof e.text !== 'string' || !['narrate', 'scene', 'influence', 'character'].includes(e.kind) || !Array.isArray(e.audience) || e.audience.some(id => !ids.has(id))) throw new Error('Invalid event or audience.');
        if (e.kind === 'influence' && (!ids.has(e.target) || e.audience.length !== 1 || e.audience[0] !== e.target)) throw new Error('Private direction has an invalid audience.');
        if (e.kind === 'character' && !ids.has(e.speaker)) throw new Error('Unknown speaker.');
    }
    return s;
}
