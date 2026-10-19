import { addEvent, characterPrompt, chooseSpeaker, directorPrompt } from './core.js';

export class StoryEngine {
    constructor({ store, request, locks, status, channel }) {
        Object.assign(this, { store, request, locks, status, channel });
        this.running = false;
        this.pauseVersion = 0;
        this.controller = null;
        channel.addEventListener('message', ({ data }) => {
            if (data.type === 'pause') this.pause(false);
            if (data.type === 'hello' && this.running) channel.postMessage({ type: 'status', text: this.currentStatus });
        });
    }
    report(text) { this.currentStatus = text; this.status(text); this.channel.postMessage({ type: 'status', text }); }
    pause(broadcast = true) {
        this.pauseVersion++;
        this.stopped = true;
        this.controller?.abort();
        if (broadcast) this.channel.postMessage({ type: 'pause' });
    }
    async run(count) {
        if (this.running) return;
        const pauseVersion = this.pauseVersion;
        if (!this.locks) throw new Error('Story coordination is unavailable. Reload and try again.');
        return this.locks.request('group-stories-generation', { ifAvailable: true }, async lock => {
            if (!lock) { this.status('Already running in another view. Pause works from here.'); return; }
            if (pauseVersion !== this.pauseVersion) return;
            this.running = true; this.stopped = false;
            this.controller = new AbortController();
            const lostOwnership = () => this.pause(false);
            lock.signal?.addEventListener('abort', lostOwnership, { once: true });
            let completed = 0;
            try {
                const initial = await this.store.read();
                const sessionId = initial.id;
                for (; !this.stopped && (count === 0 || completed < count);) {
                    await lock.assertHeld?.();
                    const session = await this.store.read();
                    if (session.id !== sessionId) break;
                    if (!session.scene.trim()) throw new Error('Set the shared scene before starting.');
                    const present = session.cast.filter(c => c.present);
                    if (!present.length) throw new Error('Choose your cast first.');
                    if (present.some(c => !c.profile)) throw new Error('Choose a connection profile for every present character.');
                    let speaker = chooseSpeaker(session);
                    if (!session.nextSpeaker && session.directorProfile) {
                        this.report('Director is choosing the next speaker…');
                        const answer = (await this.request(session.directorProfile, directorPrompt(session), 100, this.controller.signal)).trim().replace(/^['"`\s]+|['"`\s]+$/g, '');
                        speaker = present.find(c => c.id === answer);
                        if (!speaker) throw new Error('The director did not return a valid character id. Choose a speaker manually or try again.');
                    }
                    if (this.stopped) break;
                    await lock.assertHeld?.();
                    this.report(`${speaker.name} is responding…`);
                    const text = await this.request(speaker.profile, characterPrompt(session, speaker), session.maxTokens, this.controller.signal);
                    if (this.stopped || this.controller.signal.aborted) break;
                    if (!text?.trim()) throw new Error(`${speaker.name}'s connection returned an empty response.`);
                    await this.store.update(current => {
                        if (current.id !== sessionId || this.stopped) return;
                        // Any direction/scene/presence change during generation invalidates that response.
                        if (JSON.stringify(current) !== JSON.stringify(session)) throw new Error('The scene or directions changed during this turn. Press Play or Next turn to use the new direction.');
                        addEvent(current, { kind: 'character', text, speaker: speaker.id });
                        current.nextSpeaker = '';
                    }, lock.lease);
                    completed++;
                    this.channel.postMessage({ type: 'changed' });
                    this.report(`Completed ${completed} turn${completed === 1 ? '' : 's'}`);
                    // Allow control events and pending pause messages between requests.
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
                this.report(this.stopped ? 'Paused. Ready when you are.' : `Ready · ${completed} turn${completed === 1 ? '' : 's'} completed`);
            } catch (error) {
                this.report(this.stopped || this.controller.signal.aborted ? 'Paused. Ready when you are.' : `Stopped: ${error.message}`);
            } finally { lock.signal?.removeEventListener('abort', lostOwnership); this.running = false; this.controller = null; }
        });
    }
}
