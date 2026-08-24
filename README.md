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
