# Master Blaster

A browser-native Three.js arena shooter based on the Master Blaster v2.1 specification.

## Run

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:5173/`.

For local online matches, run the Cloudflare service in a second terminal:

```powershell
npm.cmd run dev:multiplayer
```

## Gameplay configuration

Edit `GAME_CONFIG.js` in the repository root. `headshotDamageMultiplier: 2`
gives double damage; `1.5`, `1.2`, or `1` also work. The client and multiplayer
Worker import this same file. Rebuild/publish the client **and** redeploy the
Worker after changing it. Cached offline clients need to update while online.
The announcement text is `PLAYER_TEXT.js` → `hud.headshot`.

A direct helmet hit shows a red HEADSHOT confirmation just above the crosshair,
with a quick pop, overshoot, streaks and fade. The reticle pulses red with it;
reduced-motion mode uses a steady brief confirmation.
The rule applies across damaging weapon families, including individual shotgun
pellets, beams, aimed melee/flame hits, and explosive contact. Chain lightning
can headshot its aimed first target; subsequent body-directed jumps, ordinary
splash, self-damage, lingering hazards, and zero-damage tools do not get a bonus.
Sticky charges preserve their attachment height until detonation.

Online health and the headshot confirmation come from the server. Client-sent
damage, multiplier, and headshot flags cannot override the server's rules.
This protects the setting, but is not comprehensive anti-cheat: existing
movement/hit proposals and ricochet validation still use client input and
tolerances. Complete trajectory authority would require server simulation.
Offline games run on the player's device and cannot be made tamper-proof.

## Controls

- Move: `WASD`
- Camera/aim: click the arena, then move the mouse
- Fire: left click
- Grapple: `E` or right click
- Jump: `Space`
- Weapons: `1`–`5` or `Q`
- Reload: `R`
- Scoreboard: hold `Tab`
- Pause: `Esc`

Touch controls appear automatically on phones and tablets.

Quick Play and Training simulate the entire match on your device, including bots,
combat and the timer. Pausing freezes all gameplay. Load the game and its assets
online once before playing offline; cached files support subsequent launches and
rematches when browser storage is available. Private and Global Multiplayer need
a live connection.

## Included

- Three.js WebGPU rendering with a WebGL 2 fallback
- Deterministic seeded arena and destructible cover
- Permanent momentum grappling hook
- 47 functionally categorized weapons and five-weapon loadouts
- Deathmatch scoring, respawns, results, and rematch
- Cloudflare Durable Object multiplayer rooms with server-owned health, ammunition, scoring, respawns, and match timing
- Offline Quick Play and Training with local bots, full pause, and no live server connection during matches
- Online private room codes with server-managed bot fill
- Global Multiplayer: live online-player list, favorite players on this browser, discoverable public rounds, and host-controlled bots
- Local accessibility/content preferences and installable PWA shell

## Global Multiplayer

Choose **Global Multiplayer** to see everyone in the lobby and all waiting rounds.
Create a round with player spots and bots, or join an existing one. Player spots
include the host; humans and bots together are limited to 16 fighters.
Star players to keep them at the top of the online list on this browser.

Select weapons directly in the waiting room. Each choice saves immediately.
The host can start with at least two humans, without filling all player spots.
Everyone sees a five-second countdown and can keep choosing weapons until zero.
At zero the server preserves each selected slot and fills only empty slots with
distinct random weapons. New joins close during the countdown; the host can
cancel it. A disconnect cancels the countdown and host duties transfer to the
longest-connected player. Finished rounds return their players to the waiting room.

With the local multiplayer service running, `npm.cmd run test:global-live`
checks presence, discovery, host permissions, countdown, partial loadouts, and
cleanup with separate WebSocket clients.

## Verify

```powershell
npm.cmd test
npm.cmd run check:multiplayer
npm.cmd run build
```

With the Cloudflare service running locally, verify a real two-client room with:

```powershell
npm.cmd run test:multiplayer-live
```

## Deploy

The client is deployed by Cloudflare Pages from the GitHub `main` branch. The multiplayer Worker is routed to `masterblaster.se/api/*` and deploys with:

```powershell
npm.cmd run deploy:multiplayer
```

## Search indexing

The production build includes a descriptive search title, crawlable landing text,
canonical URL, social previews, WebSite/VideoGame JSON-LD, `robots.txt`, and
`sitemap.xml`. Search copy is editable in `PLAYER_TEXT.js`; the installed app name
stays separate from the search title. `npm.cmd run build` verifies these assets.

After deployment, use an owner account in [Google Search Console](https://search.google.com/search-console)
to verify `masterblaster.se`, submit `https://masterblaster.se/sitemap.xml`, then
inspect `https://masterblaster.se/` and request indexing. Submit the same sitemap
in [Bing Webmaster Tools](https://www.bing.com/webmasters/). Ownership verification
requires the account's actual DNS record or verification token; do not invent one.

For participating engines, [IndexNow](https://www.indexnow.org/documentation)
can receive the homepage URL without dashboard sign-in. The generated ownership
key is intentionally served at `https://masterblaster.se/indexnow.txt`. Send a
POST to `https://api.indexnow.org/indexnow` with `host: "masterblaster.se"`,
`key` equal to that file's trimmed contents, `keyLocation` equal to its absolute
URL, and `urlList: ["https://masterblaster.se/"]`. Submit only after deployment
and when content changes. HTTP 200 means received; 202 means key validation is
pending. Neither means indexed. Google still needs the Search Console flow above.

The sitemap is also advertised in robots.txt for automatic discovery. Search
engines decide whether and when to index the game; deployment or submission does
not guarantee inclusion or ranking. See [Google's indexing guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl).
