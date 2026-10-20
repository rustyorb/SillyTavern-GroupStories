# Verification history

## v0.3.1 — Focused navigation and ensemble scene adaptation — 2026-10-20

Setup has separate Cast & characters, Scene & direction, and Save & export sections. The library and story character settings share a bounded two-column layout; scene fields use their own readable form width. The secondary quick picker is collapsed, the header and spacing are more compact, and fields/placeholders have clearer contrast. Phone layouts use horizontal section navigation and stacked content. Changing sections starts at the top of the selected form.

The adaptation request previously supplied original scenarios/greetings only, leaving sparse cards without useful identity context. It now includes each character's effective description/personality, an explicit required-cast list, equal per-field excerpt limits for every card, and instructions to give every member a concrete role without selecting a protagonist from source length/order. Current scene and shared facts take precedence. Output allowance scales with cast size. The review dialog lists everyone to check before applying. Private character rules, imported reset baselines and conversation history are excluded. This improves input balance and guidance; it cannot guarantee model compliance.

Node verification: **25 tests passed**. The adaptation regression uses a very long source card beside a sparse card, checks equal source limits and effective identity fallback, and confirms private rules/baselines are omitted.

Browser verification: **67 checks passed** on ordinary HTTP mapped only to the dedicated local SillyTavern, using desktop and 390px phone viewports. Checks include section visibility/selection, readable scene width, collapsed secondary picker, mobile content bounds and section scroll position, plus the existing privacy, persona, playback, card editing, backup and coordination flows. The adaptation payload contains both characters' effective identities, including a character with no source setup. No Group Stories runtime errors or unexpected console errors. Provider responses were simulated; real-model adaptation quality and the user's headless instance were not tested.

## v0.3.0 — Story/Setup views and story-local characters — 2026-10-19

The approved design separates conversation and live directing from preparation. Story contains transcript/composer, compact portrait/presence/influence controls and next-speaker selection. Setup contains the larger library browser with name/recent/favorite sorting, persona, profiles, shared scene/facts, character rules and optional local identity edits. Playback controls stay available in either view. The tabs do not start generation or change saved story state.

Every story character has private `storyRules`, effective description/personality/examples, and an `importedIdentity` reset baseline. Saved field edits replace the corresponding prompt fields; the reset baseline is never injected. Shared story facts take precedence, then private character rules, then card identity/examples. The director and scene adaptation receive shared facts but not private rules. Public transcript exports omit private setup, while backups include rules, local edits and baselines. Reset restores only identity fields and preserves rules, profile, presence and history. Existing character snapshots acquire their baseline once; library cards and other stories are not edited.

Node verification: **24 tests passed, 0 failed**. Tests cover recipient-only rule delivery, shared-fact inclusion, priority instructions, removal of contradictory imported text from the effective prompt, library/other-story isolation, reset boundaries, old snapshot upgrades, backup validation, and search/sort behavior, alongside the existing generation/privacy/cancellation cases. Natural-language rules are model guidance, not a deterministic guarantee; manually replacing contradictory text removes those source passages from the request.

Live UI verification: **62 checks passed**, with no Group Stories runtime errors or unexpected console errors. Live validation uses only the dedicated local host, through the ordinary-HTTP hostname mapped to 127.0.0.1, at 1500×1000 and 390×844 viewports. Provider replies and test characters are simulated. The flow checks tab separation, larger filtered/sorted portraits, story-local editing and reset, private/shared prompt assembly, rules changed after chatting starts without history rewriting, backup round-trip, director/adaptation privacy, and existing user/chat/window controls. Host header/resize notices remain recorded separately from extension errors. Browser plugin is unavailable; regular Playwright is used. No real model requests or access to the user's headless instance/phone are involved.

## v0.2.0 — Reply pacing, personas and readable cards — 2026-10-19

- New stories select the active SillyTavern persona; existing stories retain narrator-only participation until a persona is selected. Profiles come from the host's persona names/descriptions and are copied into the story without changing the host selection.
- `Chat as me` posts a public human contribution with an immutable author name/avatar snapshot. `Send & reply` pauses any existing automatic run, saves the contribution and requests one character response. The human is excluded from automatic speaker selection. Prompts explicitly reserve the human's speech, actions and thoughts for the human, and expand basic `{{user}}` / `{{char}}` references.
- Automatic replies wait a configurable 0–300 seconds between turns, with a visible countdown and a five-second default. Next turn and the first response begin immediately. Pause interrupts the wait and releases ownership even if a provider ignores cancellation. Changing direction during a wait is read before the next request.
- Clicking a cast member's portrait/name or `View character card` opens a read-only view of the story's card snapshot. Description, personality, examples, source setup/greeting and available creator/card instructions are shown as text. Import reads a full native character when the library uses shallow loading. The original card is not modified.
- New fields are added to existing stories/backups without changing their ids, history or observer mode. User messages and persona metadata round-trip through the existing v1 backup format.

Node verification: **19 tests passed**, covering persona prompts and macro expansion, immutable author identity, user-event audience filtering, old backup defaults, interval placement, immediate countdown cancellation and cancellation of an indefinitely pending provider request, alongside all prior privacy and ownership tests.

The live UI suite passed **47 checks** on the dedicated local host through an ordinary HTTP hostname mapped to 127.0.0.1, at desktop and 390px mobile widths, with no Group Stories runtime errors or unexplained console errors. It covers readable card contents and lack of editable fields, persona selection without switching the host persona, actual countdown timing, stable controls/draft text across countdown ticks, sending during a countdown, persona context in the outgoing prompt, reload persistence, mobile card reading and narrator-mode availability, alongside the earlier portrait/launcher/privacy/storage flows. Providers and temporary personas/characters are simulated in the isolated browser only. No real provider request or access to the user's headless machine/phone was performed.

## v0.1.2 — Native launchers and portrait picker — 2026-10-19

Group Stories now has a native-styled top-bar launcher with a group-of-people icon, placed beside Creative Studio's feather when present. The wand entry uses SillyTavern's standard menu row and Font Awesome icon. No settings drawer was added. Both launchers open the same workspace, and keyboard activation works on the top-bar icon.

The library picker uses SillyTavern's existing Select2 widget and `getThumbnailUrl('avatar', avatar)` to display names and portraits in search results and the selected value. Search works at desktop and mobile viewport widths. Character names are rendered as text nodes, and thumbnail paths come from the host helper.

Verification uses the local SillyTavern only, through the ordinary-HTTP test hostname mapped to 127.0.0.1. All **37 UI checks passed**, covering native launcher appearance and keyboard access, actual wand-menu opening, portrait search and selection, mobile selection without horizontal overflow, and the existing generation/privacy/storage workflows. All **13 engine tests passed**. No Group Stories runtime errors or unexplained console errors were recorded. Browser plugin was not available; regular Playwright was used. Provider replies were simulated; no real model requests were made.

## v0.1.1 — LAN HTTP compatibility — 2026-10-19

The v0.1.0 startup failure was reproduced at `http://group-stories-lan.test:8123/`, mapped by Chromium only to the dedicated local server at 127.0.0.1. The browser reported `isSecureContext === false`, `navigator.locks === undefined` and `crypto.randomUUID === undefined`; no workspace mounted. This reproduces the browser restrictions of ordinary LAN HTTP without touching another SillyTavern instance or changing server/network configuration.

Version 0.1.1 removes both dependencies. IndexedDB transactions serialize story edits, and a database ownership lease coordinates generation. IDs use `crypto.getRandomValues` where `randomUUID` is unavailable. A schema upgrade adds run coordination without replacing saved stories. A turn is saved only if the same database transaction confirms that the requesting view still owns an unexpired run lease.

- Node tests: **13 passed**, including UUID generation without the secure-context API.
- Ordinary HTTP browser checks: **30 passed**, including the full story flow, two-view exclusivity and pause, desktop/mobile layout, 100 concurrent edits, v0.1.0 story migration, stale-owner rejection, and replacement-owner recovery.
- Localhost regression checks: **29 passed**, covering the same flow and coordination behavior in the browser's secure localhost context.
- No Group Stories runtime errors or unexplained console errors. The HTTP run recorded Chromium's ignored host Cross-Origin-Opener-Policy header notice and an existing SillyTavern autocomplete resize error from `scripts/power-user.js:3133`; these are retained separately in the test results, rather than reported as a clean host console.
- Real phone hardware and the user's headless machine were not accessed. Provider replies remained simulated in the isolated browser; no real provider generation was performed.

To repeat the insecure-origin test, set `GROUP_STORIES_TEST_LAN=1` and run `tests/live-ui.cjs` with Playwright available. The hostname mapping still sends all requests only to the local test server. The test does not disable browser security or override `isSecureContext`.

## v0.1.0 — 2026-10-19

## Environment

Windows, Node.js 22+, Chromium through Playwright, SillyTavern 1.19.0 release at **http://127.0.0.1:8123/** only. Browser plugin was not available in the skill inventory; regular Playwright was used. Desktop viewport: 1500 × 1000. Mobile viewport: 390 × 844.

The actual extension was installed in the local host's per-user extensions directory. The real host loader, APP_READY lifecycle, character library UI, IndexedDB, Web Locks, BroadcastChannel, window creation and import/export controls were exercised. Runtime modules have no build step or third-party dependency.

## Automated engine checks

`npm test`: **12 passed, 0 failed**.

- Private directions reach only their recipient, including across later public turns.
- The director receives no private directions.
- An absent character receives no missed public events after returning.
- Original greetings/scenarios and other character cards are not injected into character prompts.
- Manual speaker choice, presence and immediate-repeat avoidance work.
- Malformed private audiences and invalid run limits are rejected on import.
- A bounded run commits exactly its requested number of turns with the selected profiles.
- Pause discards a late response even if cancellation is ignored.
- Another view cannot acquire an active generation lock and can pause its owner.
- New directions invalidate a stale in-flight response.
- Invalid director output and empty character output stop without appending a turn.
- Pause before a deferred lock grant prevents generation from starting.

`node --check index.js` and `git diff --check` passed.

## Local host UI checks

**24 checks passed**, with no page runtime errors or console errors:

1. Correct local host identity and meaningful workspace content.
2. Private direction clearly labeled in the human transcript.
3. Each character routes to the selected profile.
4. Private content is present only in the intended character's request.
5. Original card greeting is not inserted into the transcript.
6. Window button opens a second view sharing story and transcript.
7. Actual browser Web Lock blocks a duplicate run from the second view.
8. Pause in the second view discards the owner's late response.
9. Reload restores saved story with generation stopped.
10. Backup includes private audience lists.
11. Public transcript omits private directions.
12. Saved story list contains no duplicate active/archive entry.
13. Archived story resumes with its transcript.
14. Backup import restores story and private direction.
15. Bounded Play uses two director choices and two character turns.
16. Director prompts contain no private directions.
17. Adapted premise remains a draft until reviewed.
18. Applying the edited draft creates a shared scene change.
19. Returning character's next prompt excludes an event missed while away.
20. Speak as character appends a contribution without a request.
21. Mobile workspace is visible.
22. Mobile workspace fills the viewport height.
23. Mobile workspace does not overflow the viewport width.
24. No runtime or console errors during the flow.

Screenshot review identified and corrected a mobile height collapse. The final check requires the workspace to fill the mobile viewport, not merely exist in the DOM. Profile refresh now rerenders all profile choices immediately.

## Boundaries of the evidence

Provider replies and test profiles were simulated **inside the isolated test browser only**. No real model request, credential entry, paid generation or GPU inference was performed. Native request-service signatures and text-completion prompt construction were verified against local host source. Actual provider compatibility, model context limits and creative quality remain to be tested with the user's selected connections.

The repository is published publicly at https://github.com/rustyorb/SillyTavern-GroupStories with `main` as its default branch. A fresh HTTPS clone succeeded, contained the manifest and all runtime modules, and passed all 12 engine tests without installing dependencies or building. The README screenshot is included in the repository. The actual SillyTavern installer UI was not exercised against this remote, to avoid installing a duplicate of the already loaded local extension. Firefox, Safari, remote server deployments, multi-account switching and cross-device storage were not tested. Browser-local storage and first-version feature limits are documented in README.md.
