# Global multiplayer implementation

- Approved: global lobby and public waiting room use existing menu aesthetics; five loadout slots preserve choices; only empty slots randomize at the end of a five-second host-triggered countdown.
- Reuse: MatchRoom private-lobby lifecycle, MultiplayerClient reconnect/heartbeat, existing weapon categories and menu CSS.
- Implemented: separate presence/directory Durable Object; public room mode with capacity, host bot settings, authoritative countdown; browser lobby and waiting room; local favorite players.
- Verified: existing regression suite; production build and Worker dry run; live new multiplayer protocol and existing private/quick flows; three new Worker tests including countdown persistence across eviction. Desktop browser verified shared presence, room creation/join, immediate partial-slot edits and synchronized countdown.
- Review fixes: preserve capacity after asynchronous join checks; ignore stale client events; cancel pending joins on navigation; keep countdown visible during weapon scrolling. Browser launch exposed missing HUD mode metadata and a second audio countdown, both corrected; added regression check.
- Final validation: complete 25-step test runner passed, including 18 Worker tests; production build and Worker dry run passed. Two real browsers reached the same match after one five-second countdown; the guest's chosen first weapon stayed and only empty slots were randomized. Verified return to lobby, 390px waiting room and 320px lobby with no horizontal overflow.
- Multiplayer deployed: `cd077667-d325-4775-a48c-fec02b21679e`. The new live multi-client test passed against `https://masterblaster.se`, including test-player departure cleanup.
- Implementation and verification complete. Frontend publication uses the origin/main commit containing this checkpoint. Recovery/release check: confirm that commit is on origin/main and its Cloudflare Pages deployment is successful. Repository was clean at start.
