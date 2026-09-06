# Repository workflow

- Treat this directory as the canonical source for Master Blaster.
- After every validated user-requested code or content change, commit only the files changed for that request and push the commit to `origin/main` before reporting completion, unless the user explicitly asks not to publish or the push is blocked.
- Preserve unrelated user changes. Never rewrite published history or force-push.

## Long-running work recovery

- Keep a concise persistent checkpoint for substantial multi-session work, including changed files, verified tests, reviewer findings, blockers and the next unfinished step. Update it at material milestones and before yielding.
- If work becomes unresponsive or stops unexpectedly, inform the user, investigate the relevant evidence, mitigate confirmed causes, then resume from the checkpoint. Do not claim to know why execution stopped without evidence.
- Bound diagnostic processes and keep their output concise; a lost process/session is not a passing test. Do not terminate unrelated processes or restart work the user intentionally paused.
- Use the app's thread recovery monitoring when available and authorized. Disclose that a stopped app or offline computer cannot provide immediate local notification or recovery.
