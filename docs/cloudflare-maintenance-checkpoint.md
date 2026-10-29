# Cloudflare maintenance — 29 October 2026

## Scope and baseline

- User authorized fixing duplicate Worker CI, pending `www` Pages validation, and the missing legacy favicon while preserving the live game.
- Production Pages commit before this work: `d25101873917cd802e75a413c742d6c4ef49d9a3`, deployment `76780974-089c-47ee-90fd-3779361cd74e`, successful.
- Live multiplayer Worker: `master-blaster-multiplayer`, version `501b8e96-1fc4-4ee9-aa19-ad780ca96e83` (8 October). Both `masterblaster.se/api/*` and `www.masterblaster.se/api/*` belong to it. Do not rename the Worker or reassign these routes.
- Redundant Worker `masterblaster` runs the same repository through Workers Builds, overrides the configured Worker name, and fails when deploying the already-owned API routes. Latest failed build: `60d74ea8-cd67-49a6-8ac2-23e6c45d0a93`.
- Apex Pages custom domain is Active, SSL enabled; `www.masterblaster.se` is Verifying despite its correct proxied CNAME to `masterblaster.pages.dev`. The canonical redirect catches `www` ACME requests and redirects them to an apex 404. Apex Universal SSL expires 19 January 2027.
- Public baseline checks: game shell 200; both API health endpoints return the correct service/protocol; ordinary HTTP/www redirects preserve path and query; `/favicon.ico` is 404.

## Work in progress

- Favicon agent added a faithful transparent 16/32/48 px ICO and copied it into `dist/client` through `scripts/prepare-hosting.mjs`. No HTML, dependencies, or gameplay changes. Production build/hosting checks and local icon MIME/byte checks passed. Independent structural and visual review accepted it; source and both deployment copies match.
- Redundant Worker **Disable builds** is saved and confirmed checked after reload. No Worker, binding, route or repository connection was removed.
- Canonical redirect rule `18ded9d28c9d4ff1b6f9a2a06db58402` saved and read back with only this appended condition: `and not (http.host eq "www.masterblaster.se" and starts_with(http.request.uri.path, "/.well-known/acme-challenge/"))`.
- Original expression: `http.host in {"masterblaster.se" "www.masterblaster.se"} and (http.host eq "www.masterblaster.se" or not ssl) and not starts_with(http.request.uri.path, "/api/") and http.request.uri.path ne "/api"`.
- Destination `concat("https://masterblaster.se", http.request.uri.path)`, 301 status, Preserve query string, rule order and the other two rules are unchanged.
- Pages Check DNS records requested after the redirect fix; Cloudflare confirms records are being rechecked. Await Active status.
- Independent public regression checks passed: ordinary apex HTTP/www redirects preserve path and query; both API health endpoints and homepage remain healthy. Arbitrary www challenge paths now return 404 without redirect; the actual pending token returns 200 text/plain on both HTTP and HTTPS www. Apex challenge handling is unchanged.
- Publishing the reviewed favicon and this checkpoint to `origin/main`. Remaining verification: successful Pages deployment, no new duplicate Worker build, public favicon bytes, private multiplayer smoke check, and final domain activation. Record final evidence here.

## Preservation and rollback

- Leave unrelated untracked `%SystemDrive%/` untouched.
- Duplicate CI can be restored by switching Disable builds off in the redundant Worker's Settings → Builds. Do not disconnect the Pages repository.
- Record the exact before/after canonical rule before saving. Rollback removes only the added `www` ACME exclusion.
