# Group Stories design

The direction is a separate installer-ready SillyTavern extension and repository, for contemporary human ensemble stories. As of v0.2.0, participation with an existing SillyTavern persona is the default for new stories; narrator-only observation remains available. The workspace has cast and per-character profiles, a central transcript, a collapsible scene/directing panel and a direction composer. Play, Pause, Next turn, reply interval and generation/countdown status remain visible. Character cards retain their source scenario/greeting separately from the story-owned scene and opening, with a read-only card viewer.

## Boundaries

`core.js` owns pure session, audience and prompt rules. `engine.js` owns bounded/continuous generation and cancellation. `storage.js` owns browser persistence. `index.js` integrates SillyTavern and renders the workspace. `style.css` scopes the presentation. The repository contains runnable ES modules; no runtime library or build pipeline is needed.

The host API is read through `SillyTavern.getContext()` after APP_READY. ConnectionManagerRequestService constructs the correct prompt format and sends each character's request using its own profile. The extension never changes main connection selection, writes native chats or modifies original cards. It initializes only its own namespaced settings, never calls the global extension loader.

## State and concurrency

An account-scoped IndexedDB stores active and archived sessions. As of v0.1.1, IndexedDB read/write transactions serialize mutations and claim exclusive generation ownership, including over ordinary LAN HTTP. A run lease lasts 12 seconds and renews every 2 seconds. Run commits validate their ownership token and expiry inside the same transaction as the story write, so an expired owner cannot append a late response. Releasing an old owner never deletes its replacement. The schema upgrade retains v0.1.0 stories. BroadcastChannel distributes pause, status and state-refresh messages across views. The optional separate window is another view of the same host origin; it never creates its own independent run. A browser reload restores saved state with generation stopped. This coordinates one browser/account/origin, not different devices.

Every generated response is committed only if the story and its inputs still match the request snapshot. Cancellation marks the run stopped before aborting the provider and late responses are discarded. Provider errors stop with visible status. Generation reads current persisted state before every turn.

Automatic turns wait a configurable 0–300 seconds between contributions (five seconds by default), using abortable waits and a visible countdown. Sending a human contribution pauses the existing run and records a public user event with a snapshot of its author name/avatar, then requests one character reply once run ownership is available. Persona snapshots are story-local; the extension reads but does not switch the host persona. Prompts resolve basic user/character macros and explicitly reserve human actions and dialogue for the human. Old stories retain narrator mode; new optional fields are added without deleting history or changing session format version.

## Privacy and knowledge

Each event captures a recipient list. Public events go to present characters; private influence goes to one character. Each character's prompt filters all history by recipient before inclusion, and includes only that character's identity. The director sees public events only. No summaries or global recall are generated. Shared scene and opening are common foundational information; private facts belong in private directions. Original greetings are shown for reference, with an optional reviewed scene-adaptation request.

## First-version scope

Includes cast selection, per-character and director profiles, scene/opening editing, manual or automatic next speaker, narration/influence/speaking, presence, bounded/unlimited runs, pause, browser-local save/resume, backup import/export, public transcript export and shared-window controls.

Deferred: private conversations between characters, automatic recall/summaries, World Info integration, Studio handoff and auditions. These need further product and privacy design and do not fit the first run engine.

## Verification

Use pure Node tests for audience isolation and run-state invariants. Use the local host at 127.0.0.1:8123 for runtime loading and desktop/mobile UI interactions. Simulated provider replies may verify the workflow but must never be described as real provider verification. Publishing the Git repository is a distinct final step.
