# Cloudflare maintenance — 29 October 2026

## Scope and baseline

- User authorized fixing duplicate Worker CI, pending `www` Pages validation, and the missing legacy favicon while preserving the live game.
- Production Pages commit before this work: `d25101873917cd802e75a413c742d6c4ef49d9a3`, deployment `76780974-089c-47ee-90fd-3779361cd74e`, successful.
- Live multiplayer Worker: `master-blaster-multiplayer`, version `501b8e96-1fc4-4ee9-aa19-ad780ca96e83` (8 October). Both `masterblaster.se/api/*` and `www.masterblaster.se/api/*` belong to it. Do not rename the Worker or reassign these routes.
- Redundant Worker `masterblaster` runs the same repository through Workers Builds, overrides the configured Worker name, and fails when deploying the already-owned API routes. Latest failed build: `60d74ea8-cd67-49a6-8ac2-23e6c45d0a93`.
- Apex Pages custom domain is Active, SSL enabled; `www.masterblaster.se` is Verifying despite its correct proxied CNAME to `masterblaster.pages.dev`. The canonical redirect catches `www` ACME requests and redirects them to an apex 404. Apex Universal SSL expires 19 January 2027.
- Public baseline checks: game shell 200; both API health endpoints return the correct service/protocol; ordinary HTTP/www redirects preserve path and query; `/favicon.ico` is 404.

## Completed repairs

- Favicon agent added a faithful transparent 16/32/48 px ICO and copied it into `dist/client` through `scripts/prepare-hosting.mjs`. No HTML, dependencies, or gameplay changes. Production build/hosting checks and local icon MIME/byte checks passed. Independent structural and visual review accepted it; source and both deployment copies match.
- Redundant Worker **Disable builds** is saved and confirmed checked after reload. No Worker, binding, route or repository connection was removed.
- Canonical redirect rule `18ded9d28c9d4ff1b6f9a2a06db58402` saved and read back with only this appended condition: `and not (http.host eq "www.masterblaster.se" and starts_with(http.request.uri.path, "/.well-known/acme-challenge/"))`.
- Original expression: `http.host in {"masterblaster.se" "www.masterblaster.se"} and (http.host eq "www.masterblaster.se" or not ssl) and not starts_with(http.request.uri.path, "/api/") and http.request.uri.path ne "/api"`.
- Destination `concat("https://masterblaster.se", http.request.uri.path)`, 301 status, Preserve query string, rule order and the other two rules are unchanged.
- Pages Check DNS records requested after the redirect fix. Both domains now show **Active / SSL enabled**. The authenticated Pages API independently confirms `www` domain status, HTTP validation status and verification status are all `active`.
- Independent public regression checks passed: ordinary apex HTTP/www redirects preserve path and query; both API health endpoints and homepage remain healthy. Arbitrary www challenge paths now return 404 without redirect; the actual pending token returns 200 text/plain on both HTTP and HTTPS www. Apex challenge handling is unchanged.
- Favicon commit `444b516` pushed to `origin/main`; production Pages deployment `07e82a9e-26a2-4cb2-ac75-21dea7932182` became Active. A later documentation-only commit records these final results.

## Production verification

- `/favicon.ico`: 200, `image/vnd.microsoft.icon`, 15,086 bytes, three valid sizes; SHA-256 `4fe1ba5c6bcbbccc501313d050681a98767cadbb6a5c1a9a1eec5e37b5eb2fa4` matches the reviewed repository file.
- Homepage and seven referenced JavaScript/font/image/manifest resources: 200 with correct MIME types. Ordinary host/path/query redirects retain their behavior.
- Apex and www `/api/health`: 200 with service `master-blaster-multiplayer`, protocol 1 and arena revision 2.
- Two isolated private WebSockets, one via each hostname, joined the same private lobby with two humans and zero bots. Both ping/pong exchanges succeeded. No public lobby or matchmaking was used.
- Socket harness limitation: close acknowledgments exceeded its five-second bound, so that command exited 1. A separate bounded server-status check confirmed zero active humans and no public directory entry; temporary reconnect reservations are expected. This was not recorded as an entirely passing test command.
- Live multiplayer version remains `501b8e96-1fc4-4ee9-aa19-ad780ca96e83`; no backend deployment or route reassignment occurred.
- Duplicate Worker's Disable builds remains checked after reload and after the favicon push. Its latest build remains the historical failed `60d74ea8-cd67-49a6-8ac2-23e6c45d0a93`; no new build was triggered. Historical failure/name-mismatch notices remain historical and are not instructions to rename the live Worker.
- Independent implementation and production reviewers accepted the icon and verified the public behavior. No outstanding repair remains.

## Preservation and rollback

- Leave unrelated untracked `%SystemDrive%/` untouched.
- Before the 30 October removal, duplicate CI could be restored by switching Disable builds off. That option no longer applies: the redundant Worker has now been deleted. The Pages repository remains connected.
- Record the exact before/after canonical rule before saving. Rollback removes only the added `www` ACME exclusion.

## Redundant Worker removal — 30 October 2026

- User explicitly authorized deleting the redundant `masterblaster` Worker while preserving the live Pages site and multiplayer service.
- Pre-removal API inspection confirms both API routes still belong to `master-blaster-multiplayer`; the account has no Worker custom domains. The three live Durable Object namespace IDs are distinct from the duplicate Worker's three namespaces.
- All four account Workers' relevant bindings were inspected. No other Worker references `masterblaster` or its namespaces. The `masterblaster` Pages project has no service or Durable Object bindings.
- Production Pages deployment `ee32d1eb-9955-4f3e-b2c2-75ebd02a8664`, source `a7a56e3`, reports deploy success. Live multiplayer version remains `501b8e96-1fc4-4ee9-aa19-ad780ca96e83` at 100%.
- Public baseline passed: homepage and favicon 200, correct favicon bytes; both API health endpoints healthy; ordinary redirects preserve path and query.
- Deleted only `/accounts/ac21898cd74d6bd4bfd130f3499d5fa0/workers/scripts/masterblaster` through the authenticated API, without `force`, at 23:21:21 CET. Cloudflare returned HTTP 200 and `success: true`.
- Post-removal API comparison passed: the redundant Worker and its three separate namespaces are absent; all other Workers remain. Both API routes, the three live namespaces and bindings, and the active multiplayer version are unchanged. The Pages deployment remains successful and both custom domains remain active.
- The refreshed Workers & Pages application list confirms only the `masterblaster` Pages site and `master-blaster-multiplayer` Worker remain for this game; the redundant Worker's failed-build entry is gone.
- Independent public checks passed after deletion: homepage, seven referenced assets and favicon return 200; favicon bytes match the repository; apex/www API health and normal redirects are healthy.
- Two private WebSockets, one per hostname, joined the same isolated lobby with two humans and zero bots; both ping/pong checks passed. Close acknowledgments were absent within the bounded 1.5-second wait, as in the earlier test, but a separate status read verified zero active humans and no public directory entry. No public match or gameplay was started.
- No application code or live backend deployment was changed. This documentation update records the completed removal and verification; unrelated untracked files are preserved.
