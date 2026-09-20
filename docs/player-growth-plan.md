# Master Blaster: first player-growth experiment

Prepared 20 September 2026. Default: organic promotion, no advertising spend.
Status: campaign drafts prepared; no posts, outreach, listings or ads published.

## What we know

- The SEO checkpoint records successful Google ownership verification, sitemap
  submission and homepage indexing on 18 September. Repeating that setup is not
  the next priority. Current search performance has not been inspected.
- The game offers browser play, momentum grappling, destructible towers, 47
  weapons, private rooms and bot-filled online matches. These claims come from
  README.md and PLAYER_TEXT.js; this campaign task did not retest gameplay.
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
| Days 3–5 | Share clips on the owner's existing social accounts and one suitable playtesting community. | Use the drafts below; adapt to each community's current rules and reply to feedback. |
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

### Playtest post

Title: Master Blaster — a free browser shooter with grappling and destructible towers

I'm working on Master Blaster, a browser arena shooter where you can grapple
across the map and blast towers apart. Choose a five-weapon loadout from 47
weapons, join online Quick Play, or share a private room code with friends.
Online rooms use bots to fill empty slots; Training lets you practice against bots.

Play free: https://masterblaster.se/

I'd love feedback on two things: how quickly the grappling hook makes sense,
and whether your first match makes you want a rematch. If you hit a problem,
please include your browser and device.

Use this only from the developer's account; adjust the first-person wording if
someone else publishes it. Adapt title, flair and structure to the community.

### Clip concepts

1. **"The floor is optional."** Start mid-grapple, show an airborne attack, end
   on the landing. Caption: "Free browser arena shooter · masterblaster.se".
2. **"That tower was cover. Was."** Show intact cover, its destruction and the
   effect on the fight in one continuous sequence.
3. **"Bring a friend. Pick five weapons."** Show contrasting weapons and a
   private match. End with "Create a private room and share the code".

Use actual captured gameplay. These are shot lists, not completed video assets.

## Distribution priorities and constraints

1. Start with existing social accounts and relevant playtesting communities.
   r/playmygame is a candidate, but read the current rules before posting. Its
   moderators explicitly enforce participation requirements; do not treat it as
   a link-drop channel. [Moderator guidance](https://www.reddit.com/r/playmygame/comments/1m61887/)
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

Confirm preferred channels and budget, capture the three gameplay clips, and
inspect available analytics. Publishing from the owner's accounts or contacting
creators needs an explicit instruction to publish/send. No spending is authorized.
