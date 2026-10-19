# v0.1.0 verification — 2026-10-19

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

The repository has not yet been published. Extension installer cloning/updating from a remote Git URL remains unverified until publication. Firefox, Safari, remote server deployments, multi-account switching and cross-device storage were not tested. Browser-local storage and first-version feature limits are documented in README.md.
