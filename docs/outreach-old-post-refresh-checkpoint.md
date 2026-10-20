# Existing Master Blaster post refresh — 20 October 2026

The user explicitly requested current images and verified feature/improvement updates for older posts wherever editable. This supersedes the previous instruction to preserve old post copy merely to avoid a package refresh. It does not authorize duplicate posts, moderation evasion, publisher messages, new credentials without the required handoff, or changes to historical reviews/ratings. Current General feedback Page was freshly read at sequence357; its approved story, privacy limits and staged-action captions remain the source.

## Current compatible media result

The four undated aliases now use fresh native current-game captures with the original embed aspect ratios: action images1068×735 and menus2560×1440 (16:9). The approved wide20October source package remains unchanged. Independent review accepted the settled real-combat action captures and complete menus, including all five Quick Play slots and the full weapon card. Build and hosting checks pass. Commitc5c9e88 is pushed. Four normal public HTTP200 downloads hash-matched the source files at19:38Stockholm. The existing Three.js browser still displayed cached wide images after native hard refresh; displayed forum refresh remains unverified. Do not confuse deployed byte verification with refreshed platform/browser caches.

The development-only capture helper now waits for32 actual scene renders while holding the sampled combat/camera state. No production gameplay, visuals, startup or LCP code changed. See [capture evidence](outreach-forum-compatible-capture.md) and [independent review](outreach-old-post-refresh-review.md).

Existing post prose has not been edited: HTML5 and IndieDB require brand login, GameDev.net requires manual editing, Three.js requires human-finalized prose, and Resources rehosts its image behind owner/publisher access. No duplicate posts or publisher messages were sent.

## Historical visual verification correction

Commit052e3d5 reached production; all four aliases were downloaded through the ordinary browser and hash-matched the20Octsources. However, visual QA found that Three.js retains fixed old img dimensions/style (rocket690x474 for original1068x735) while the new source is3394x1269. That stretches the new image. HTML5 also retained cached originals despite regular reload. Public media delivery alone is not a completed or acceptable forum-image refresh.

Restored all four undated aliases to the archived originals while preparing direct current-game captures at the original aspect ratios (actions1068x735, menus1280x720). No dated source was changed. This correction supersedes the initial deployment outcome below; do not report a completed live image refresh until compatible captures are deployed and visually verified. Existing post prose remains unedited pending actual access.

## Historical initial media attempt and access outcomes

- The initial wide-image alias attempt was reverted, then superseded by the compatible captures in the current result above. Original aliases are archived, unchanged, under public/press/archive/pre-refresh-2026-10-20/. The approved dated source package remains unchanged. Current replacements were captured20October; they did not appear in earlier publications at their original dates.
- HTML5 Game Devs topic76464/comment375862 directly embeds all four aliases. It is signed out and cannot yet be edited. Original tagged play/guide anchors and feedback request remain intact. Brand username prepared in tab1966654590, password blank, login handoff marked. No duplicate post or comment.
- SlowDen's existing cover metadata points to the rocket alias; its iframe uses the live game. No self-service description/cover editor exposed. It does not show a normal screenshot gallery. Social/image caches may retain the prior cover.
- IndieDB is signed out; inline screenshots are platform-hosted copies and are not affected by alias refresh. Existing profile93095 and gallery2995101–2995105 retained. Exact current description/image edit is prepared, but not saved; brand login handoff1966654684. See the IndieDB record below.
- Three.js Resources rehosts its screenshot in S3. Claim/login exists, but the anonymous original submission established no brand account and current terms prohibit automated registration. Publisher/claim access is required; no duplicate submission/account or contact message.
- GameDev.net project460 requires user-performed edits under its automated-access rules. Three.js topic95005 requires human-finalized prose; no generated update was published there. Existing public URLs and user-final text preserved.
- PaperCroft's card uses og.png, which is unchanged. Preserve its historical 6 October review, score and votes; no owner editor exposed. Newsletter issue666 is an editor-owned historical title/link placement with no screenshot to replace. No editor email/resend.
- Removed Reddit entries are left unchanged under the existing removal hold. Pending directory submissions are not duplicated or resubmitted. This task does not establish any new placement/backlink.

## Media mapping and validation

| Alias after /press/ | Source after /press/ | Archived original SHA-256 |
| --- | --- | --- |
| action-rockets.png | action-rockets-forum-2026-10-20.png | c0413c7bb9b46a688dddfd82c42219bdcb9df9ef50c674fe7ed055f7f78268d9 |
| action-grenades.png | action-grenades-forum-2026-10-20.png | b6905479028031c6c45b60fcfd64835067e69d77e7c844cad9f64a56273f94a1 |
| home-menu.jpg | home-menu-forum-2026-10-20.jpg | 53aa7796ce421ec84040fa349b1f522cee8f0a943e74cc92f2790b903fd2b265 |
| quick-play.jpg | quick-play-forum-2026-10-20.jpg | 54c33e0a95f15669a5873558c0bd605c9bae11b4cde6c772be344bc98370b8ef |

All four aliases hash-match their compatible dated sources. The action files are about1.2MB each; menu files are about0.2MB each. No-cache response rules apply only to these four mutable aliases; dated assets keep their existing behavior. Third-party caches/proxies are outside our control. No production gameplay code, initial-page asset reference, LCP implementation or offline resource set changed. npm run build including hosting checks passed. Deployment and public media verification remain separate checks.

## Prepared HTML5 update — not saved

Keep the original post, clickable tagged game/guide links, feedback questions and first-person tone. Update its renderer label from Three.js/WebGL to Three.js WebGPU with a WebGL 2 fallback, then add this dated paragraph where ordinary generated prose is allowed:

> 20 October update: The game has revised arena lighting, materials and effects, menu and input fixes, and settings that apply and save as you change them. The screenshots below now show the current version, captured on 20 October. The two action shots use staged starting positions/loadouts with live AI combat against 15 bots. I'd love feedback on movement, grappling, weapons and what would make you want another match.

If useful, clarify offline rather than announce it as new: Quick Play/Training can work after preparation shows Available offline while browser resources remain saved; multiplayer needs a connection. Do not label the existing47 weapons, five slots,15bot limit or multiplayer modes as new. Actual later changes are settings31bdc3c (9Oct), UI/input b03404e (11Oct), graphics2034887 (12Oct). No FPS, reliable sub-two-second load, first-visit-offline or physical-phone claim.

## Evidence and recovery

- [Independent source/rules review](outreach-old-post-refresh-review.md).
- [IndieDB original-field evidence and prepared HTML](outreach-old-post-refresh-indiedb.md).
- [SlowDen, Resources and PaperCroft access/image sources](outreach-old-post-refresh-directories.md).
- Ignored local HTML5 login screenshot: .wrangler/tmp/outreach/html5-signin-handoff-2026-10-20.png. No after-edit proof exists because no forum text edit has been saved.

Next: validate/deploy the media change, verify current alias delivery and the HTML5 rendered images, reconcile exact results into the existing tracker, and continue actual edits after existing brand logins. VibeTopList is live with all four images; retain Vibecode's user password/signup handoff and Pixel's authentication failure, weekly Friday09:00 schedule and all unrelated user changes. No second automation.

Final validation: npm run build/hosting and git diff --check pass. Four deployed assets match the compatible source SHA-256 values in the capture record; responses currently expose Cache-Control:max-age=14400 despite the intended exact no-cache rules, so do not promise immediate third-party/browser refresh. No cache/security setting was changed to force the result. Main tracker19 and targets8 record the actual outcome. Next: finish HTML5/IndieDB edits once brand login is available; user/manual publisher edits remain separate.
