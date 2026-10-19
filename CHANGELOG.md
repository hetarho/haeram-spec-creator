# Changelog

## 0.7.0

- One brief assembler for `vibe brief` (standalone) and `work brief` (work groups, runner, `vibe loop`): the task; the current rules of each cited domain (STATE cfg `brief: domain`, the default) or only the cited decisions (`brief: cited`); what they require (`→!`) or delegate to (`→=`), transitively; decisions that reference a cited one; the global rules (cfg `always`, default every ARCH decision); the flow·constraints of each domain it draws from; chg lines after a stale base; the inbox lines about it. Whole blocks, never cut to a size.
- Reference kinds in FORMAT: `→!` requires, `→=` canonical, `→~` related, `→` unclassified (every existing reference). Unclassified references are followed one hop from a block the task depends on and listed beyond it; `/` lists, `–` ranges, whole-domain `→ID` and bare IDs are parsed. Existing SSOTs are not reclassified.
- `vibe brief` takes `T###`, `ID-n` (with referrers), `ID` and `ID@rev` (history since rev), `--ref <commit>` and `--deep`; it prints markdown ending in an `end … chars:N` line (`--json` for data) and exits 1 when incomplete. Provenance: source (working tree with HEAD and dirty spec files, or one commit), domain path·rev·sha256, block path·lines·sha256.
- `decisionBlocks` keeps every line up to the next top-level bullet or heading (unindented tables and continuation lines were dropped before).
- lint: broken typed references are errors, broken unclassified ones and canonical cycles warnings, the unclassified count a review hint; cfg `always` entries must exist and cfg `brief` is `domain` or `cited`.
- create-task cites every decision a task's implementation must obey, so a project can move to `brief: cited` (measured on a 13-SSOT project: `cited` answered 13 of 25 policy questions on existing tasks, `domain` all 25).
- Skills read decisions through the brief; completeness is per block and per brief (`end` line, complete:yes) instead of "the doc's `## chg` is visible". Built-in adapters pass the brief to the model as markdown; adapter payloads keep the JSON shape.

## 0.6.0

- Add `vibe loop`: serial fresh Claude/Codex sessions, single-unit results, one preflight/report/tag, bounded retries and work/time limits, stop markers, detached hosts and persistent logs/session IDs.
- Add `vibe ci wait` and `vibe push --wait-ci`: CLI-owned waiting with backoff, authenticated gh/token API or public HTML, exact commit checks, bounded no-run handling and workflow path filters. No anonymous API polling.
- Add standalone `vibe brief` and scoped FORMAT excerpts; summarize STATE and test output, retain full check logs and persist the task-start diff base.
- Default to task checks, one batch gate before a code push and CI after push; understand ARCH task/batch/CI decision sub-lines and flag missing tiers as review hints.
- Keep task commits while batching solo pushes/reports; retain strict remote claims with other sessions. Allow small bug/wording/style fixes without a task file under explicit size and policy limits.
- Shorten common skills and load work-group/pair details only when needed. Preserve the existing work runner and installer lock format for both agents.
