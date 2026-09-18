# PBR texture coverage — 2026-09-18

- Complete albedo, normal, roughness, metalness and AO maps now cover lit game materials in world, player, mecha and combat visuals. Unlit effects retain their intended materials.
- Existing procedural textures pack AO/roughness/metalness into RGB; arena maps retain arena ownership, with one module-lifetime detail set shared by fighters/projectiles/small scenery.
- Armor shader samples ORM alongside authored finish attributes. Projected UVs repair custom armor/shrouds; cover housing emission uses independent UV1.
- Verified: 992 material uses with valid map color spaces and noncollapsed UVs; mecha checks; graphics checks; production build and hosting check. WebGPU fighter and arena renders inspected, no reported renderer errors.
- Full npm test passed, including all 21 bounded checks and 15 worker tests. Exact staged source also passed the 992-use PBR check independently of unrelated working edits. Implementation/validation complete; publication target: origin/main.
- Preserve pre-existing dust edits in world.js, graphics browser/review/pool tests and graphics-checkpoint.md. Original world.js snapshot is in the system temp directory as master-blaster-pbr-world-before.js.
