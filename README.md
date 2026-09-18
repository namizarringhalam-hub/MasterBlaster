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

## Included

- Three.js WebGPU rendering with a WebGL 2 fallback
- Deterministic seeded arena and destructible cover
- Permanent momentum grappling hook
- 47 functionally categorized weapons and five-weapon loadouts
- Deathmatch scoring, respawns, results, and rematch
- Cloudflare Durable Object multiplayer rooms with server-owned health, ammunition, scoring, respawns, and match timing
- Online Quick Play and private room codes with server-managed bot fill; offline adaptive-bot Training
- Local accessibility/content preferences and installable PWA shell

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
