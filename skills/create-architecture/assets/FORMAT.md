# FORMAT
> Notation rules for every doc under spec/. Write and read by these rules only. Never invent notation not defined here — define it here first, then use it.

## Principles
1. Primary reader is AI. No background prose, no fillers, no repetition. Decisions and reasons only.
2. One line = one decision/fact. If something is ambiguous, don't write prose — register it as a [?] decision.
3. Short ≠ omitted. Everything needed to decide (decisions, reasons, constraints, open items) must be present.
4. Docs first. Record state changes in STATE.md before reasoning or implementing.
5. Truth order: content → ssot/*.md, progress → STATE.md, change history detail → each SSOT's chg (STATE log is a hint, not truth). Fix mismatches on sight.
6. ssot/ holds outcomes only. No request traces ("user asked", "as discussed"), no interview history, no rationale beyond the decision line's ← reason, no sections beyond the skeleton. Task files are disposable and may carry request context — ssot/ never does.

## ID
| target | form | rules |
|---|---|---|
| SSOT domain | 2-6 uppercase (AUTH, ARCH) | file ssot/<ID>.md |
| decision | <ID>-<n> (AUTH-3) | n is permanent — never reused, even after rejection |
| task | T### (T012) | file tasks/T###.<slug>.md (moved to tasks/done/ at done) · slug=kebab-case · numbering=max existing+1 counting tasks/done/ · never reused |
| review finding | Fn (F3) | scoped to its review doc · n is permanent, never reused |

## Notation
- decision line: `- <ID>-<n> [o|?|x] <content>` + ` ← <reason>` only when there was a trade-off
  e.g. `- AUTH-2 [o] session: JWT 15m + refresh 30d ← minimize mobile re-login`
- [o] decided / [?] open / [x] rejected·deferred
- change kind: + added / ✎ modified / - removed (e.g. `AUTH-2✎`)
- reference: →AUTH-3
- finding line: `- Fn [?|o|x] P1|P2|P3 <where>: <what>` + ` ← <why it matters>`; append ` →T###` once a task exists. P1 = correctness/security risk or blocks every change · P2 = slows every change · P3 = nice to have. A functional bug is a finding whose <what> starts with `bug:`
- acceptance check: `- [ ]` open → `- [v]` done (never mark done with x — [x] means rejected in SSOT)
- rev: rN. +1 per content change, one chg line (`- rN YYMMDD <ID>-n✎ summary`). First write: `- r1 YYMMDD initial`. A ✎ summary MUST keep the old value as `old→new` (e.g. `BM-11✎ limit 100→50`); a `-` summary states what was removed
- date: YYMMDD (260905)
- task st: `todo` → `doing@date.tag` → `done@date`. Stuck: `blocked@date` (one-line reason in the task's ## result). tag = 2-4 chars chosen by the claiming session
- empty value: `-` (never leave a cell blank)
- log·chg: `- YYMMDD text`, one line each, newest on top
- flow: A → B(x|y) → C — order and branches
- commands (verify etc.): backtick code, runnable as-is, no inline commentary

## Skeletons (section order fixed; only (opt) may be omitted; no sections beyond the skeleton)
- ssot: `# <ID> <name>` / `> rN | <one-line purpose>` / `## decisions` / `## flow`(opt) / `## constraints`(opt) / `## chg`
- task: `# T### <title>` / `> st:.. | ssot:<decision IDs, space-separated> | base:<ID>@rev(per referenced domain, space-separated) | dep:T### or -` / `## goal` / `## acceptance` / `## impl notes` / `## result`(filled at done·blocked — empty means untouched)
- ideation: `# IDEATION <slug>` / `> st:.. | <one-line want>` / `## vision` / `## explored` / `## shape` / `## domains` / `## open` — file ideation/<slug>.md, slug=kebab-case
- review: `# REVIEW <slug>` / `> st:.. | scope:<paths or all> | at:<git sha7 or -> | base:ARCH@rev` / `## summary` / `## findings` / `## notes` — file review/<slug>.md, slug=kebab-case (recommended `<scope>-<YYMMDD>`)
- STATE: `## cfg` / `## ideation`(opt) / `## ssot` / `## review`(opt) / `## tasks` / `## next` / `## log`

## State rules
- STATE ssot row `id|rev|tasked|pending|[?]`: rev=current, tasked=rev consumed into tasks, pending=unconsumed delta summary (`AUTH-5+ AUTH-2✎`), [?]=open decision count. tasked < rev ⇒ create-task target.
- tasked=0 (new domain) ⇒ pending is always `all`, meaning everything up to the current rev. Later changes are absorbed into `all`.
- STATE tasks row's ssot cell holds domains only (`ARCH BM`) — decision IDs live in the task file's quote line.
- doing·done tasks are immutable. Exception: the implementing session updating its own task's st·checks·result. Content changes become a new task.
- STATE tasks table holds remaining work only (todo·doing·blocked). At done: set st `done@date` in the file, move it to tasks/done/, delete the STATE row, leave one log line. A dep absent from the table is satisfied iff tasks/done/ holds that task's file.
- Planning changes go only through update-ssot(rev+1) → STATE pending → create-task. Never edit tasks directly.
- ideation st: `open@date` → `ready@date` → `converted@date` (in the quote line + STATE ideation row `id|st`). Explored items reuse [o]/[x]/[?]. A domains line converted into a SSOT gets `→<ID>`; the doc becomes converted when every [o] domain has one.
- review st: `open@date` → `ready@date` → `converted@date` (in the quote line + STATE review row `id|st`). Findings start as [?]; the user adopts [o] / rejects [x] ← reason. A [o] finding turned into a task gets `→T###`; the doc becomes converted when every [o] finding has one (no [o] at all ⇒ converted at once).
- review-sourced tasks: ssot = the ARCH decisions the change enforces, `-` if none; base = ARCH@rev always; first impl-notes line `- from review/<slug> Fn`; acceptance keeps behavior unchanged (existing tests still pass). They never move ssot rev/tasked/pending.
- STATE next: 1-3 lines. Every skill updates next on exit.
- STATE log: delete beyond 20 lines — detailed history lives in each SSOT's chg and in task files.

## Language
- Every spec/ doc is written in English. Code, identifiers, and paths stay as-is.
- cfg.lang = the user's language: interviews, confirmations, and reports happen in it. cfg.docs = doc language (default en).
- Sole exception: spec/NARRATIVE.md (written by create-narrative) is a human-facing prose doc in the user's language — FORMAT notation does not apply to it. It is a derived view of ssot/: it never introduces decisions, and on conflict ssot/ wins.
