# FORMAT
> Notation rules for every doc under spec/. Write and read by these rules only. Never invent notation not defined here — define it here first, then use it.

## Principles
1. Primary reader is AI. No background prose, no fillers, no repetition. Decisions and reasons only.
2. One line = one decision/fact. If something is ambiguous, don't write prose — register it as a [?] decision.
3. Short ≠ omitted. Everything needed to decide (decisions, reasons, constraints, open items) must be present.
4. Docs first. Record state changes in STATE.md before reasoning or implementing.
5. Truth order: content → ssot/*.md, progress → STATE.md, change history detail → each SSOT's chg (STATE log is a hint, not truth). Fix mismatches on sight.

## ID
| target | form | rules |
|---|---|---|
| SSOT domain | 2-6 uppercase (AUTH, ARCH) | file ssot/<ID>.md |
| decision | <ID>-<n> (AUTH-3) | n is permanent — never reused, even after rejection |
| task | T### (T012) | file tasks/T###.<slug>.md · slug=kebab-case · numbering=max existing+1 · never reused |

## Notation
- decision line: `- <ID>-<n> [o|?|x] <content>` + ` ← <reason>` only when there was a trade-off
  e.g. `- AUTH-2 [o] session: JWT 15m + refresh 30d ← minimize mobile re-login`
- [o] decided / [?] open / [x] rejected·deferred
- change kind: + added / ✎ modified / - removed (e.g. `AUTH-2✎`)
- reference: →AUTH-3
- acceptance check: `- [ ]` open → `- [v]` done (never mark done with x — [x] means rejected in SSOT)
- rev: rN. +1 per content change, one chg line (`- rN YYMMDD <ID>-n✎ summary`). First write: `- r1 YYMMDD initial`
- date: YYMMDD (260905)
- task st: `todo` → `doing@date.tag` → `done@date`. Stuck: `blocked@date` (one-line reason in the task's ## result). tag = 2-4 chars chosen by the claiming session
- empty value: `-` (never leave a cell blank)
- log·chg: `- YYMMDD text`, one line each, newest on top
- flow: A → B(x|y) → C — order and branches
- commands (verify etc.): backtick code, runnable as-is, no inline commentary

## Skeletons (section order fixed; only (opt) may be omitted)
- ssot: `# <ID> <name>` / `> rN | <one-line purpose>` / `## decisions` / `## flow`(opt) / `## constraints`(opt) / `## chg`
- task: `# T### <title>` / `> st:.. | ssot:<decision IDs, space-separated> | base:<ID>@rev(per referenced domain, space-separated) | dep:T### or -` / `## goal` / `## acceptance` / `## impl notes` / `## result`(filled at done·blocked — empty means untouched)
- STATE: `## cfg` / `## ssot` / `## tasks` / `## next` / `## log`

## State rules
- STATE ssot row `id|rev|tasked|pending|[?]`: rev=current, tasked=rev consumed into tasks, pending=unconsumed delta summary (`AUTH-5+ AUTH-2✎`), [?]=open decision count. tasked < rev ⇒ create-task target.
- tasked=0 (new domain) ⇒ pending is always `all`, meaning everything up to the current rev. Later changes are absorbed into `all`.
- STATE tasks row's ssot cell holds domains only (`ARCH BM`) — decision IDs live in the task file's quote line.
- doing·done tasks are immutable. Exception: the implementing session updating its own task's st·checks·result. Content changes become a new task.
- Planning changes go only through update-ssot(rev+1) → STATE pending → create-task. Never edit tasks directly.
- STATE next: 1-3 lines. Every skill updates next on exit.
- STATE log: delete beyond 20 lines — detailed history lives in each SSOT's chg and in task files.

## Language
- Every spec/ doc is written in English. Code, identifiers, and paths stay as-is.
- cfg.lang = the user's language: interviews, confirmations, and reports happen in it. cfg.docs = doc language (default en).
- Sole exception: spec/NARRATIVE.md (written by create-narrative) is a human-facing prose doc in the user's language — FORMAT notation does not apply to it. It is a derived view of ssot/: it never introduces decisions, and on conflict ssot/ wins.
