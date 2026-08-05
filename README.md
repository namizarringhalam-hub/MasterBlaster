# Blaster Battle

A browser-native Three.js MVP based on the Blaster Battle v2.1 specification.

## Run

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:5173/`.

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

- Three.js WebGL 2 arena rendering
- Deterministic seeded arena and destructible cover
- Permanent momentum grappling hook
- 47 functionally categorized weapons and five-weapon loadouts
- Deathmatch scoring, respawns, results, and rematch
- Adaptive bot Training, Quick Play practice, and private room-code setup
- Local accessibility/content preferences and installable PWA shell

## Verify

```powershell
npm.cmd test
npm.cmd run build
```
