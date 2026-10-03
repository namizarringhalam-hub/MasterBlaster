# SEO checkpoint — 2026-09-18

- Request: optimize Master Blaster for search and make it discoverable.
- Changed: PLAYER_TEXT.js, index.html, vite.config.js, public/robots.txt,
  public/sitemap.xml, scripts/prepare-sites.mjs, tests/hosting.mjs, README.md.
- Added descriptive search title and visible landing copy, indexable metadata,
  WebSite/VideoGame JSON-LD, robots instructions and canonical homepage sitemap.
  Both build output layouts include crawler files. No dependencies added.
- Verified: playerText test and production build including hosting assertions pass.
  Live homepage initially returned HTTP 200 without a noindex header; robots.txt
  incorrectly returned the HTML shell before this change.
- Existing graphics/world changes belong to another request and remain unstaged.
- Published SEO commit 513ba8b to origin/main. Verified live homepage has the
  new title, and robots.txt / sitemap.xml return HTTP 200 with text/plain and
  application/xml respectively.
- Follow-up commit 9dea05e published public/indexnow.txt to both build layouts,
  with passing hosting validation and submission instructions. Verified the live
  key matches and is served as text/plain. Submitted homepage to
  https://api.indexnow.org/indexnow: HTTP 202 (received, key validation pending).
- Live browser inspection confirms updated copy, readable layout and menu controls.
  HTTP checks with Googlebot user-agent return 200 for homepage, robots and sitemap,
  with correct content types and no X-Robots-Tag header blocking indexing.
- Initial Search Console sign-in blocker resolved in the follow-up below.
  Bing dashboard remains signed out, but IndexNow submission was accepted.
  No recurring automation was requested or created.

## Google verification follow-up

- User signed into Search Console. Added URL-prefix property https://masterblaster.se/.
- Added the account's actual HTML verification meta tag to index.html.
- Build and hosting checks passed; committed/pushed tag in fec8db4 and confirmed
  the exact verification tag is live on the production homepage.
- Google confirmed "Ownership verified" using the HTML tag. Keep the tag in place.
- Submitted sitemap.xml: Google reports "Success", last read 18 Sept 2026,
  one discovered page and zero videos.
- URL Inspection reports "URL is on Google" and "Page is indexed" for the homepage.
- Requested indexing of the updated page: Google confirmed "Indexing requested"
  and addition to a priority crawl queue. Updated snippets/ranking timing is not
  guaranteed. No duplicate submission needed.
- All setup/submission steps are complete. Future performance/indexing reports
  can be checked in the verified https://masterblaster.se/ Search Console property.

## SEO completion work — 3 October 2026

- Scope: complete the SEO checklist except creator information. Public promotion
  and brand accounts authorized; never use the user's personal identity/details.
  Existing creators remain Sam and Kian; no author bio or personal profiles added.
- Initial live audit: crawler assets/meta/canonical present; normal linked resources
  return 200. Unknown pages and missing JS incorrectly return the homepage/200;
  www serves a duplicate; HTTP /index.html takes two redirects.
- Baseline PageSpeed mobile, Slow 4G / Moto G Power: performance 77,
  FCP 3.5 s, LCP 4.5 s, CLS 0.039, TBT 0 ms. No CrUX field data available.
- Search Console baseline: 1 click, 13 impressions in selected three-month report;
  Links report has 0 external links and 0 internal links recorded.
- In progress: native 404/exact game routes, static linked how-to-play guide with
  FAQ/breadcrumb schema, one homepage H1, WOFF2 conversion and removal of blocking
  CSS requests. Font bytes reduced from 1,323,456 to 464,392 (raw, not page timing).
- Validated: font glyph/metrics preservation; playerText, journeys, matchStartup,
  assetCache and resourcePreparation regressions; guide FAQ/schema consistency;
  unified production build/hosting checks; real Wrangler Pages route checks.
  Browser checked desktop/mobile landing/guide and a real Quick Play match.
- Independent review caught offline guide fallback returning the game; fixed by
  including the stable guide in the release and caching its own navigation page.
- Promotion: prepared topical directory submissions and captured unedited gameplay.
  Free Play Games form only invokes mailto:; no message sent/delivery confirmed.
  Submitted SDF Lemmy brand registration as MasterBlasterGame without email;
  signup returned to home, but administrator acceptance/account activation unverified.
  Credentials protected locally with Windows DPAPI in ignored temporary files.
  iogames.party requires brand email, gameplay screenshot and a content-use license.
- Access blocker: deployment credentials can list/publish Pages but Cloudflare
  rulesets/settings API returns 403. Dashboard sign-in requested for edge redirects.
  Dedicated brand mailbox preference requested before new public accounts.
- Published 4800350 to origin/main with brand commit identity; production Pages
  deployment succeeded. Live guide/crawler files return 200; missing pages/assets
  now return 404. No user name or personal contact information published.
- Resubmitted sitemap.xml in Search Console on 3 October: successful submission.
  Requested indexing of /how-to-play/: Google confirmed addition to crawl queue.
  Submitted homepage and guide to IndexNow: HTTP 200 accepted. Actual guide
  indexing and backlinks remain unconfirmed; queue acceptance is not indexing.
- First published remeasurement: mobile performance 80, FCP 2.1 s, LCP 4.2 s,
  TBT 190 ms, CLS 0; SEO/accessibility/best-practices each 100. LCP identifies the
  homepage H1, which engine startup unnecessarily recreated after GPU init.
- Follow-up: retain the initial menu DOM/focus during startup, promote existing
  button attributes to one engine handler, preserve later normal menu rendering.
  Exclude the social-only 1,963,583-byte og.png from mandatory offline downloads;
  keep the original social preview live. Startup/navigation/browser match and
  build/hosting checks passed, including focused DOM retention regression.
- Published 920f4b3 and verified production deployment. Second mobile run:
  performance 83, FCP 2.3 s, LCP 3.9 s, TBT 0 ms, CLS 0; desktop FCP 0.5 s,
  LCP 0.8 s, TBT 300 ms. Under-two-second mobile loading is not achieved.
- Final performance work: three compact Inter UI subsets reduce their combined
  first UI downloads from 332,940 to 63,716 bytes; original complete fonts remain
  available via complementary Unicode ranges. Verified all current text coverage,
  exact outlines/advances/vertical metrics/hint programs/copyright metadata. No
  runtime/build dependency added. Regenerate from original WOFF2 with fontTools
  subset: --unicodes=U+0000-00FF,U+2000-206F,U+2161,U+2190,U+2605-2606
  --layout-features=* --glyph-names --notdef-outline --name-IDs=*
  --name-languages=* --hinting --flavor=woff2, output <stem>-latin.woff2.
  Hidden empty-world canvas rendering skipped; CSS also hides canvas behind
  Settings/Credits to avoid stale warmup/match frames. Startup/paused-arena,
  gameplay warmup, cache/offline and complete build/hosting checks passed.
- Submitted canonical game URL as MasterBlasterGame to somethingbig.ai/games;
  site confirmed receipt for editorial review. No email/social/personal details
  submitted. Publication/backlink not yet confirmed; no repeated submissions.
- Prepared docs/seo-redirect-rules.json for Cloudflare Single Redirects. This is
  an unapplied draft: preserve existing zone rules and insert these ordered rules
  rather than replacing an existing ruleset. www duplicate/HTTP alias chains remain.
- Pending: publish final performance changes and remeasure; Cloudflare dashboard
  still signed out.
  Free Proton mailbox signup prepared as masterblastergame@proton.me, awaiting
  action-time terms approval required by browser policy. No paid plan selected
  and no mailbox created. Directory email delivery/submissions await brand contact
  and applicable license approval. Forum application activation remains unknown.
- Published 772ad78; production deploy succeeded. Mobile performance 95,
  FCP 1.7 s, LCP 2.9 s, TBT 90 ms, CLS 0. Desktop paints quickly (FCP 0.5 s,
  LCP 0.7 s) but scores 72 with 880 ms of startup blocking. No CrUX data.
  Final browser checked immediate pre-engine Quick Play click, actual match,
  pause, Settings and Credits after match; no stale canvas, one screen heading.
  Homepage remains indexed; Google confirmed a new homepage recrawl request.
- Additional startup cleanup: remove unused capabilities probe that creates a
  second WebGL context; yield via existing scheduler at renderer/environment
  preparation boundaries. Native PMREM generation still runs synchronously.
  Lighting, startup, gameplay warmup, resource preparation and production build
  checks passed; early Training click reaches setup after startup. Next: publish
  this cleanup and record the final speed measurement, then report remaining
  access/approval/publication blockers without claiming backlinks or indexing.
- Published 24ce7d3; Cloudflare production deployment succeeded. Last mobile
  measurement: performance 91, FCP 1.8 s, LCP 3.0 s, TBT 0 ms, CLS 0.
  Last desktop: performance 82, FCP 0.5 s, LCP 0.7 s, TBT 400 ms, CLS 0,
  interactive at 1.2 s. SEO/accessibility/best-practices each 100 in both tests.
  https://pagespeed.web.dev/analysis/https-masterblaster-se/zwzvkfl8f9?form_factor=mobile
  Scores vary (previous mobile 95); no field-data or universal under-2s claim.
- All implemented source changes validated/pushed; final tree clean before this
  record. Guide canonical/meta/one-H1/live navigation checked; original Sam/Kian
  credits untouched. No new creator bio or personal identity/contact published.
- iogames.party draft filled with game URL and factual 147-character/long copy;
  screenshot captured. No form submitted; brand email and license approval needed.
  Free Play Games mailto request remains unsent. Something Big editorial receipt
  is the only confirmed directory submission; no published backlink confirmed.
- Unfinished external steps: user signs into the existing Cloudflare Edge tab;
  inspect/merge/apply the three draft redirects and verify all schemes/hosts/aliases
  terminate in one hop. User approves free Proton terms (signup already prepared)
  before mailbox creation; if it requests a human challenge, hand off to user.
  Complete permitted email/forum/directory workflows after any required license
  acceptance, keep brand identity only, record actual publication URLs/results.

## Redirects and brand contact follow-up — 3 October 2026

- User signed into Cloudflare. No existing Single Redirect rules were present.
  Deployed the three ordered rules from docs/seo-redirect-rules.json: homepage
  alias (2f376eae724742e3aaa3d86958c1e482), guide aliases
  (961ba515e63f4eb0b56fa074aa31d76c), canonical host/HTTPS
  (18ded9d28c9d4ff1b6f9a2a06db58402). All are active, 301, query preserved.
  General normalization explicitly excludes /api and /api/* to preserve POST
  and WebSocket multiplayer requests from already-open www/offline clients.
- Independent live verification: 42/42 checks passed at 20:03 UTC. Public HTTP,
  www and page aliases reach the canonical HTTPS apex URL in exactly one 301;
  encoded queries preserved. Canonical pages/crawler files/favicon return 200,
  missing pages/assets 404. Both HTTPS /api/health hosts return JSON/200 directly.
  Evidence retained in ignored .wrangler/tmp/seo/redirects-after.json.
- User explicitly approved free Proton signup and completed the CAPTCHA.
  Created masterblastergame@proton.me on Free, without personal contact details
  or a paid plan. Credentials remain DPAPI-protected in an ignored local file.
- Sent factual game suggestion to info@freeplaygames.com from this brand mailbox.
  Proton confirmed "Message sent." Subject: "Game suggestion: Master Blaster".
  It includes canonical game/guide URLs and real game features, signed only
  MasterBlasterGame. Recipient delivery/publication/backlink remain unconfirmed.
- iogames.party draft now includes the brand email. Its text/screenshot license
  is still unapproved; no form submission. User requested a more lively real
  gameplay screenshot (explosion/grapple action); capture/preparation in progress.
- Next unfinished steps: finish heading-font subsets and validate/publish;
  capture/review/upload real action screenshot; request the directory's specific
  content license approval after the complete draft is reviewable. Forum activation,
  published backlinks, actual guide indexing and mobile LCP under 2 s remain open.
- Follow-up Search Console inspection confirms /how-to-play/ is indexed: "URL
  is on Google", successful Googlebot smartphone crawl on 3 October at 21:03:17,
  canonical = inspected URL, one valid breadcrumb item. Fresh sitemap detail:
  last read 03/10/2026, "Sitemap processed successfully", two discovered pages.
  No indexing requests repeated. Something Big public listing still lacks the
  submitted game; editorial receipt remains pending publication. Forum brand
  login did not establish an authenticated session; activation remains unverified.
- Heading fonts: Barlow Condensed normal/italic 900 subsets reduce first heading
  transfers from 66,708 to 41,800 bytes (24,908 saved). Retain complete originals
  via complementary Unicode ranges. Exact glyphs, outlines, advances, vertical
  metrics, hint programs/tables, supported Unicode and licensing metadata checked.
  Use the same fontTools subset options recorded for Inter above, keeping original
  timestamps. Focused startup, build/hosting and real local Quick Play/pause/menu
  browser checks passed. Source changes not yet published or remeasured.
- Prepared public/press/gameplay.jpg: real unedited 1280x720 gameplay capture,
  brand player/seed only, robot actively grappling through the neon arena. No
  confirmed simultaneous explosion/headshot captured; do not claim one. Browser
  pointer-lock limitation prevented mouse aiming/firing in this capture session.
  Screenshot copied byte-for-byte into both hosting layouts and excluded from
  mandatory offline downloads. Final build/hosting and asset-cache checks passed.
- Published 47a5865 to origin/main. Cloudflare production deployment
  a7199f2d-257f-4afd-873c-88ec8155a77b; live homepage references both new Barlow
  subsets, each served byte-identical to tested source. Public press JPEG returns
  image/jpeg/200 and exact 104,090 bytes. No multiplayer worker changes.
- Fresh single mobile PageSpeed run after publication: performance 94, SEO 100,
  accessibility 100, best practices 100; FCP 1.7 s, LCP 2.9 s, TBT 80 ms,
  CLS 0, Speed Index 2.7 s. Slow 4G/Moto G Power, 3 October 22:22 GMT+2;
  no field data. https://pagespeed.web.dev/analysis/https-masterblaster-se/uoqpqm6yj4?form_factor=mobile
  Under-2-second mobile LCP remains unmet; no broad loading-time guarantee.
- iogames.party draft is complete: factual short/long copy, canonical game URL,
  brand email and imported gameplay.jpg attachment (JPEG, 104.1 KB). Reciprocal
  prioritization unchecked. Awaiting the user's specific approval for submission
  and non-exclusive royalty-free worldwide text/screenshot license; no Submit
  action performed. Keep draft tab marked for handoff, brand mailbox deliverable.
- Remaining: directory license/submission approval; actual editorial publication
  and quality backlinks; verified forum activation/post; improved mobile LCP.
  More dramatic explosion/headshot screenshot not achieved with browser pointer
  lock blocked; current screenshot shows genuine grapple action. Creator bio
  intentionally skipped. Google indexing/sitemap and canonical redirects complete.

## Directory approval and replacement screenshot — 3 October 2026

- User explicitly approved the iogames.party listing and its non-exclusive
  royalty-free worldwide text/screenshot content license. No further license
  confirmation is needed. Form remains unsubmitted while replacing the image.
- User rejected the first screenshot and then requested using their own image.
  Latest message contains no accessible image attachment; next step is receive
  that image, inspect it, replace the old Airtable attachment, submit the approved
  draft and verify its receipt. Do not submit the rejected existing attachment.
- Explored actual engine captures with combat, grapple lines and rocket effects;
  staged candidates remain ignored local artifacts, unpublished and unattached.
  Do not describe them as earned headshots or unstaged live gameplay.
- Fixed the graphics review harness's startup diagnostic race: boost-pad metrics
  use an empty list while startMatch asynchronously prepares the world. Focused
  syntax/null/ready checks passed; existing in-app browser reached ready with
  draw calls and zero errors after reloading. No product gameplay changes.
- Temporary capture tab closed, viewport override reset, owned dev server stopped.
  Approved listing draft preserved for handoff. Remaining external work: user image
  and submission receipt; editorial publication/quality backlinks; forum activation;
  mobile LCP under 2 seconds (last measured 2.9 s). Creator bio intentionally skipped.
- User supplied 191559.png and explicitly selected it as the replacement. Copied
  its bytes unchanged to public/press/gameplay.png and removed the rejected JPEG.
  PNG is a genuine unedited arena canvas from the bot-combat session, 16:9,
  with no visible usernames/chat. Production build and hosting checks passed.
  Next: wait for this public asset to deploy, replace the draft attachment and
  submit under the already approved license; verify Airtable's receipt.
