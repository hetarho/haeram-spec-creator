# Changelog

## 0.6.0

- Add `vibe loop`: serial fresh Claude/Codex sessions, single-unit results, one preflight/report/tag, bounded retries and work/time limits, stop markers, detached hosts and persistent logs/session IDs.
- Add `vibe ci wait` and `vibe push --wait-ci`: CLI-owned waiting with backoff, authenticated gh/token API or public HTML, exact commit checks, bounded no-run handling and workflow path filters. No anonymous API polling.
- Add standalone `vibe brief` and scoped FORMAT excerpts; summarize STATE and test output, retain full check logs and persist the task-start diff base.
- Default to task checks, one batch gate before a code push and CI after push; understand ARCH task/batch/CI decision sub-lines and flag missing tiers as review hints.
- Keep task commits while batching solo pushes/reports; retain strict remote claims with other sessions. Allow small bug/wording/style fixes without a task file under explicit size and policy limits.
- Shorten common skills and load work-group/pair details only when needed. Preserve the existing work runner and installer lock format for both agents.
