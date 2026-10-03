# Master Blaster: first player-growth experiment

Prepared 20 September 2026. Default: organic promotion, no advertising spend.
Revised 4 October 2026. Status: the user accepted the community target list;
the generic post and its assets below await content review before outreach.
Existing approved directory work is recorded in seo-checkpoint.md. Use brand
accounts only. See [the current target list and post register](community-outreach-targets.md).

## What we know

- The SEO checkpoint records successful Google ownership verification, sitemap
  submission and homepage indexing on 18 September. Repeating that setup is not
  the next priority. Current search performance has not been inspected.
- The game offers browser play, momentum grappling, destructible towers, 47
  weapons, local bot modes, private rooms and Global Multiplayer. These claims
  come from README.md and PLAYER_TEXT.js; this campaign task did not retest gameplay.
- No analytics integration was found in the inspected client sources. Hosting
  analytics may exist separately; traffic, retention and acquisition are unknown.

## Positioning

**Grapple across the arena. Bring the towers down. Play free in your browser.**

Lead with the movement and destruction in real gameplay footage. Treat weapon
count as supporting detail. Show the game immediately, then end with the URL.
Never imply bot-filled matches are all human players.

## Two-week experiment

| When | Action | Deliverable / decision |
| --- | --- | --- |
| Days 1–2 | Record three real 15–25 second gameplay clips: grapple escape, tower destruction, weapon surprise. | One clear moment per clip; readable captions and masterblaster.se at the end. |
| Days 1–2 | Check existing hosting analytics and Search Console. | Record baseline visits, search clicks and available referrals; confirm what is actually measured. |
| Days 3–5 | After content approval, share approved material through brand accounts in eligible communities. | Adapt to each community's current rules and record published permalinks for daily feedback checks. |
| Days 6–7 | Run one advertised 30-minute play session at an owner-chosen time. | Concentrate players into the same session; share a private room code after creating the room. |
| Days 8–10 | Publish two new clips based on the strongest initial hook. | Compare visits and player feedback, not just views. |
| Days 11–14 | Review results and assess one portal release. | Repeat the source that produced players; fix repeated launch or gameplay friction first. |

Working goal: recruit the first 20 people who provide useful play feedback.
This is an experiment target, not a traffic forecast. If there is already a
larger active audience, replace it with a target based on the measured baseline.

## Ready-to-use copy

### Short social caption

Grapple across the arena. Bring the towers down.

Master Blaster is a free browser arena shooter with destructible towers and
47 weapons. Play online or bring friends into a private room.

Play: https://masterblaster.se/

### Generic feedback post — awaiting user review

Title: Master Blaster — free browser arena shooter with grappling and destructible towers

We're working on Master Blaster, a free browser arena shooter where you can
grapple across the map, blast towers apart and choose a five-weapon loadout from
47 weapons. It's being built with AI-assisted coding.

Try Quick Play or Training against bots, invite friends through a Private Room,
or find/create a game in Global Multiplayer. No download is needed.

**Play:** https://masterblaster.se/
**Controls and game modes:** https://masterblaster.se/how-to-play/

We'd love feedback, especially on:

- Does the grappling hook feel intuitive, and can you build up speed comfortably?
- Are opponents, weapon effects and destructible cover easy to read during a fight?
- What would you change first to make you want another match?

If something breaks or runs poorly, please include your device and browser,
what happened, and which game mode you tried. Thanks for giving it a go!

### Exact assets and links for this draft

- Playable game: https://masterblaster.se/ (canonical URL, no tracking parameters).
- Controls/game-mode guide: https://masterblaster.se/how-to-play/.
- One image attachment: public/press/gameplay.png, available at
  https://masterblaster.se/press/gameplay.png. This is the user's chosen 191559.png
  unchanged: 960 × 540 PNG, 804,703 bytes, SHA-256
  b6643b10fcf5a4bc91cedf626478863809ebe8e4e308309cbbf87cea5f1e91a6.
- Caption: "Master Blaster's neon arena."
- Alt text: "Master Blaster arena with tall towers and platforms outlined in
  yellow, cyan and magenta beneath a dark sky."
- No video or additional image is part of this review package. The screenshot
  shows an arena view; do not label it as an explosion, grapple or headshot scene.

All three public URLs returned HTTP 200 on 4 October 2026; the image returned
image/png with the expected 804,703-byte length. Gameplay/mode claims were checked
against current PLAYER_TEXT.js and README.md; no new performance claims are made.

This is brand-account copy, without personal names/details or creator information.
Do not publish it until the user has reviewed it. After approval, adapt title,
flair, length and attachment placement to each community's rules. r/WebGames may
require the direct game-link submission with allowed contextual comments instead
of this full body. AI-builder communities need specific verified workflow detail;
r/vibecoding requires the user's own writing. Target-list acceptance does not
resolve the eligibility checks recorded in community-outreach-targets.md.

### Clip concepts

1. **"The floor is optional."** Start mid-grapple, show an airborne attack, end
   on the landing. Caption: "Free browser arena shooter · masterblaster.se".
2. **"That tower was cover. Was."** Show intact cover, its destruction and the
   effect on the fight in one continuous sequence.
3. **"Bring a friend. Pick five weapons."** Show contrasting weapons and a
   private match. End with "Create a private room and share the code".

Use actual captured gameplay. These are shot lists, not completed video assets.

## Distribution priorities and constraints

1. The user accepted [the community list](community-outreach-targets.md) and
   requested the generic post for review. Publication and other new outreach
   remain pending content review. Recheck each target's eligibility and current
   rules before acting. Use brand accounts and truthful affiliation.
2. Consider itch.io as the first portal experiment. It supports uploaded HTML5
   games, but requires relative asset paths. This project currently uses
   root-relative assets and same-origin multiplayer endpoints, so the production
   build must not be assumed upload-ready. Test loading, pointer lock, audio and
   multiplayer in the actual embedded build before release.
   [HTML5 publishing guide](https://itch.io/docs/creators/html5)
3. Assess CrazyGames after the first playtest feedback. It has a submission
   process and multiplayer requirements; acceptance and audience are not
   guaranteed. Review the SDK and hosting requirements before estimating work.
   [Publishing documentation](https://docs.crazygames.com/)
   · [Multiplayer requirements](https://docs.crazygames.com/requirements/multiplayer/)

Portal players and visits to masterblaster.se are different outcomes. Decide
whether success means more people playing anywhere or more visits to the site.

## Measurement

Record each post's date, channel, URL, clip concept, views, link clicks, referred
visits and feedback in a simple log. Mark unavailable measurements as unknown.
The published-post register in community-outreach-targets.md is the source for
daily activity monitoring; record exact permalinks only after verified publication.
The ACTIVE daily 09:00 Europe/Stockholm follow-up checks each registered post,
reports new feedback with links and identifies where the user should engage.
Read and summarize replies; do not publish responses without user authorization.
Local checks require the computer on and app running; missed access is not proof
that a post has no activity.

Optional tagged link for a social post:

https://masterblaster.se/?utm_source=social&utm_medium=organic&utm_campaign=first_players&utm_content=grapple

Replace source with the actual platform and content with the clip name. These
parameters do not collect data by themselves: verify the analytics tool reports
them before relying on campaign attribution.

The useful funnel is visit → successful match start → completed match → rematch.
These gameplay events are a proposed next implementation, not existing verified
metrics. Until measured, do not equate a page visit with a player or a return visit
with a completed match. Compare source quality before choosing paid promotion.

## Next unfinished step

Have the user review the generic feedback post and exact asset/link package above.
Keep new outreach pending that review, then apply approved wording under each
eligible community's rules and record each successful publication for daily checks.
No spending or use of personal accounts is authorized.
