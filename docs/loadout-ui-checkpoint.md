# Loadout UI simplification — 2026-10-08

- Published in 89465a1: question-circle Controls help modal beside Equipped weapons, with OK and Escape dismissal; START moved into the top-right setup header above its match summary, with the bottom launch strip removed.
- Implemented follow-up: remove saved-set management, naming, default selection and Remove weapon. Save set beneath the move controls replaces the selected one of three numbered sets; selecting an empty destination keeps the current weapons. Existing saved weapon orders survive migration.
- Last equipped loadout persists across setup modes and complete global lobby selections. Partial global random-slot selections retain the previous complete kit. Retired default settings and preset names are removed on settings load.
- Changed: PLAYER_TEXT.js; src/gameData.js, globalMultiplayer.js, loadoutArmory.css, main.js, styles.css; tests/globalMultiplayer.test.mjs, playerText.test.mjs, setupEditor.test.mjs, smoke.mjs; this checkpoint.
- Verified: setupEditor, globalMultiplayer, playerText, multiplayerProtocol, smoke and matchStartup checks; production build and hosting checks; diff whitespace check. Independent review found no outstanding issues. Saved-set guards reject duplicate, missing and inherited weapon IDs.
- Browser limitation: available CUA browsers expose no tab muting control, so game content was not loaded in them. Visual browser QA remains unperformed; temporary blank tabs were closed.
- Next unfinished step: commit only follow-up files, push origin/main, and verify the live release on masterblaster.se. Preserve unrelated changes and never publish a Sites copy.
