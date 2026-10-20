import { IDENTITY_FIELDS, resetStoryIdentity } from './core.js';

const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};
export function sortLibrary(characters, order = 'name', search = '', timestamp = c => Date.parse(c.create_date) || 0) {
    const query = search.trim().toLocaleLowerCase();
    const favorite = c => c.fav === true || c.fav === 'true' || c.data?.extensions?.fav === true;
    return characters.filter(c => String(c.name).toLocaleLowerCase().includes(query)).slice().sort((a, b) => {
        const name = String(a.name).localeCompare(String(b.name));
        if (order === 'reverse') return -name;
        if (order === 'recent') return (timestamp(b) - timestamp(a)) || name;
        if (order === 'favorites') return Number(favorite(b)) - Number(favorite(a)) || name;
        return name;
    });
}

export function createPreparation({ root, getSession, context, change, inspect, addCharacter, notify, saved }) {
    const drafts = new Map(); const expanded = new Set(); let currentStory;
    const browser = node('section', 'gs-library-browser');
    browser.innerHTML = `<h2>Browse your library</h2><div class="gs-library-tools"><input type="search" data-library-search placeholder="Search characters…" aria-label="Search character library"><select data-library-sort aria-label="Sort character library"><option value="name">Name A–Z</option><option value="reverse">Name Z–A</option><option value="recent">Recently added</option><option value="favorites">Favorites first</option></select></div><div class="gs-library-grid" data-library-grid></div>`;
    root.querySelector('[data-cast]').before(browser, node('h2', 'gs-cast-title', 'In this story'));
    const search = browser.querySelector('[data-library-search]'); const sort = browser.querySelector('[data-library-sort]');
    search.addEventListener('input', renderLibrary); sort.addEventListener('change', renderLibrary);
    const guarded = callback => async () => { try { await callback(); } catch (error) { notify(error); } };
    function renderLibrary() {
        const session = getSession(); if (!session) return;
        const grid = browser.querySelector('[data-library-grid]'); grid.replaceChildren();
        const timestamp = card => card.create_date ? Number(context().timestampToMoment(card.create_date).valueOf()) || 0 : 0;
        const cards = sortLibrary(context().characters, sort.value, search.value, timestamp);
        if (!cards.length) grid.append(node('p', 'gs-muted', 'No characters match this search.'));
        for (const card of cards) {
            const tile = node('article', 'gs-library-tile'); tile.dataset.avatar = card.avatar;
            const details = node('button', 'gs-library-portrait'); details.type = 'button';
            details.setAttribute('aria-label', `Read library card for ${card.name}`);
            const image = node('img'); image.src = context().getThumbnailUrl('avatar', card.avatar); image.alt = ''; image.loading = 'lazy';
            details.append(image, node('strong', '', card.name)); details.addEventListener('click', guarded(() => inspect(card.avatar)));
            const added = session.cast.some(c => c.avatar === card.avatar);
            const add = node('button', '', added ? 'In cast' : '+ Add'); add.type = 'button'; add.disabled = added;
            add.setAttribute('aria-label', `${added ? 'Already added' : 'Add'} ${card.name} ${added ? '' : 'to cast'}`.trim());
            add.addEventListener('click', guarded(() => addCharacter(card.avatar)));
            tile.append(details, add); grid.append(tile);
        }
    }
    function editor(character) {
        const session = getSession();
        if (currentStory !== session.id) { drafts.clear(); expanded.clear(); currentStory = session.id; }
        const draft = drafts.get(character.id) || {};
        const wrapper = node('div', 'gs-character-setup');
        const label = node('label', '', 'For this story…');
        const rules = node('textarea'); rules.rows = 3; rules.maxLength = 24000;
        rules.setAttribute('aria-label', `For this story — ${character.name}`);
        rules.placeholder = 'We have never met. Keep their voice and personality, but remove the established relationship for this story.';
        rules.value = draft.storyRules ?? character.storyRules;
        label.append(rules); wrapper.append(label, node('small', 'gs-muted', 'Only this character receives these rules. Put facts everyone should know in Shared story facts.'));
        const edits = node('details', 'gs-local-edits');
        edits.open = expanded.has(character.id);
        edits.append(node('summary', '', 'Edit this story’s character'));
        edits.addEventListener('toggle', () => { if (edits.open) expanded.add(character.id); else expanded.delete(character.id); });
        edits.append(node('p', 'gs-muted', 'Optional. Edit the story copy to remove conflicting passages. Your library card stays unchanged.'));
        const inputs = { storyRules: rules };
        for (const [key, title] of [['description', 'Description'], ['personality', 'Personality'], ['examples', 'Example dialogue / voice']]) {
            const fieldLabel = node('label', '', title); const input = node('textarea'); input.rows = key === 'description' ? 5 : 3;
            input.value = draft[key] ?? character[key]; input.setAttribute('aria-label', `${character.name} story ${key}`);
            fieldLabel.append(input); edits.append(fieldLabel); inputs[key] = input;
        }
        const imported = node('details', 'gs-imported-identity'); imported.append(node('summary', '', 'Imported version (for comparison)'));
        for (const key of IDENTITY_FIELDS) imported.append(node('h4', '', key), node('p', 'gs-card-text', character.importedIdentity[key] || 'Not supplied.'));
        edits.append(imported); wrapper.append(edits);
        const save = node('button', 'gs-primary', drafts.has(character.id) ? 'Save character setup · unsaved' : 'Save character setup'); save.type = 'button';
        save.setAttribute('aria-label', `Save ${character.name} story setup`);
        const reset = node('button', 'gs-link', 'Reset card edits'); reset.type = 'button';
        reset.setAttribute('aria-label', `Reset ${character.name} card edits`);
        for (const [key, input] of Object.entries(inputs)) {
            input.dataset.prepCharacter = character.id; input.dataset.prepField = key;
            input.addEventListener('input', () => {
            drafts.set(character.id, Object.fromEntries(Object.entries(inputs).map(([key, field]) => [key, field.value])));
            save.textContent = 'Save character setup · unsaved';
            });
        }
        save.addEventListener('click', guarded(async () => {
            const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
            if (values.storyRules.length > 24000) throw new Error('Keep character rules under 24,000 characters.');
            await change(s => { const c = s.cast.find(c => c.id === character.id); if (!c) throw new Error('Character is no longer in this story.'); Object.assign(c, values); });
            drafts.delete(character.id);
            saved(`${character.name}'s story setup saved. Applies to the next reply.`);
        }));
        reset.addEventListener('click', guarded(async () => {
            drafts.delete(character.id);
            await change(s => { const c = s.cast.find(c => c.id === character.id); if (c) resetStoryIdentity(c); });
            saved(`${character.name}'s card edits reset. Saved story rules are unchanged.`);
        }));
        wrapper.append(save, reset); return wrapper;
    }
    return { renderLibrary, editor };
}
