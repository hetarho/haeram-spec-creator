# FORMAT
> Notation rules for every doc under spec/. Write and read by these rules only. Never invent notation not defined here — define it here first, then use it.

## Principles
1. Primary reader is AI. No background prose, no fillers, no repetition. Decisions and reasons only.
2. One decision = one policy unit: a rule that can be read, applied and verified on its own. Split when two policies can change independently; keep together what must change together. Structure conditions as sub-lines or a table — never by joining them into one longer line. Removing line breaks is not concision.
3. Short ≠ omitted. Always keep: compatibility rules, failure conditions, security·billing·data-retention rules, numbers with their units, negations (no·never·only·must not), and the reason behind a non-obvious decision. Cut only what does not constrain the current implementation.
4. Docs first. Record state changes before reasoning or implementing: standalone/planning → STATE.md; a bound work-group worker → the work CLI runtime. Workers never edit STATE or SSOT.
5. Truth order: current rules → each SSOT's decisions·flow·constraints, progress → STATE.md for standalone or the work board for a work group, change history → each SSOT's chg (STATE log is a hint, not truth), past work → tasks/done/ (history, never a current rule). Fix mismatches in the owning workspace.
6. ssot/ holds outcomes only. Out: request traces ("user asked", "as discussed", who approved when), interview history, discarded alternatives beyond their one [x] line, past-bug narration, praise and filler, detail already owned by code or by another doc (reference it instead). In: the rule in force now, its conditions and exceptions, and the reason wherever a trade-off was made. Task files are disposable and may carry request context — ssot/ never does.
7. Scope exclusion ≠ rejected decision. A boundary that still holds ("free plan cannot export") is a live [o] decision written negatively. [x] means the decision is not in force any more.

## ID
| target | form | rules |
|---|---|---|
| SSOT domain | 2-6 uppercase (AUTH, ARCH) | file ssot/<ID>.md |
| decision | <ID>-<n> (AUTH-3) | n is permanent — never reused, even after rejection or after the decision is split |
| task | T### (T012) | file tasks/T###.<slug>.md (moved to tasks/done/ at done) · slug=kebab-case · numbering=max existing+1 counting tasks/done/ · never reused |
| review finding | Fn (F3) | scoped to its review doc · n is permanent, never reused |

## Notation
- decision line: `- <ID>-<n> [o|?|x] <content>` + ` ← <reason>` only when there was a trade-off
  e.g. `- AUTH-2 [o] session: JWT 15m + refresh 30d ← minimize mobile re-login`
- decision block = the decision line plus the indented (2 spaces) sub-lines under it — sub-bullets or a table — carrying conditions, exceptions, enumerated values. Sub-lines have no ID of their own: the block is one decision, revised and referenced as one. Use them when the conditions do not fit one readable line; two reasons (` ← ` twice) or three or more ` · ` groups mean two decisions, not one long one.
  e.g. `- AUTH-4 [o] rate limit per account ← abuse without blocking shared offices`
       `  - login 5/min, password reset 3/hour`
       `  - over limit ⇒ 429 + retry-after, never a silent drop`
- [o] decided / [?] open / [x] rejected·not in force
- change kind: + added / ✎ modified / - removed (e.g. `AUTH-2✎`)
- reference: →AUTH-3
- finding line: `- Fn [?|o|x] P1|P2|P3 <where>: <what>` + ` ← <why it matters>`; append ` →T###` once a task exists. P1 = correctness/security risk or blocks every change · P2 = slows every change · P3 = nice to have. A functional bug is a finding whose <what> starts with `bug:`
- acceptance check: `- [ ]` open → `- [v]` done (never mark done with x — [x] means rejected in SSOT)
- rev: rN. +1 per policy change, one chg line (`- rN YYMMDD <ID>-n✎ summary`). First write: `- r1 YYMMDD initial`. A ✎ summary MUST keep the old value as `old→new` (e.g. `BM-11✎ limit 100→50`); a `-` summary states what was removed. Wording-only editing (doc-review) is not a policy change: no rev, no chg line.
- chg lines are never deleted or folded away — an unconsumed delta and an in-flight task's freshness check both read them. A summary may be shortened, but its `<ID>-n` marks and `old→new` values stay.
- date: YYMMDD (260905). Inside a decision a date appears only as measurement provenance (`measured 260903: 424 of 572`), never as who decided when.
- task st: `todo` → `doing@date.tag` → `done@date`. Stuck: `blocked@date` (one-line reason in the task's ## result). tag = 2-4 chars chosen by the claiming session
- empty value: `-` (never leave a cell blank)
- log·chg: `- YYMMDD text`, one line each, newest on top
- flow: A → B(x|y) → C — order and branches
- commands (verify etc.): backtick code, runnable as-is, no inline commentary

## Skeletons (section order fixed; only (opt) may be omitted; no sections beyond the skeleton)
- ssot: `# <ID> <name>` / `> rN | <one-line purpose>` / `## decisions` / `## flow`(opt) / `## constraints`(opt) / `## chg`
- task: `# T### <title>` / `> st:.. | ssot:<decision IDs, space-separated> | base:<ID>@rev(per referenced domain, space-separated) | dep:T### or - | touches:<repo-relative paths or ->(opt)` / `## goal` / `## acceptance` / `## impl notes` / `## result`(filled at done·blocked — empty means untouched)
- task result lines: `- outcome: <what works now>` / `- at: <git commit SHA the checks ran on, or ->` / `- verified: <the checks that actually ran>` / `- limits: <what is still open, or ->`. Anything a later change must obey is not a result — raise it to the SSOT.
- ideation: `# IDEATION <slug>` / `> st:.. | <one-line want>` / `## vision` / `## explored` / `## shape` / `## domains` / `## open` — file ideation/<slug>.md, slug=kebab-case
- review: `# REVIEW <slug>` / `> st:.. | scope:<paths or all> | at:<git sha7 or -> | base:ARCH@rev` / `## summary` / `## findings` / `## notes` — file review/<slug>.md, slug=kebab-case (recommended `<scope>-<YYMMDD>`)
- STATE: `## cfg` / `## ideation`(opt) / `## ssot` / `## review`(opt) / `## tasks` / `## next` / `## log`

## Reading
- Read by purpose: the rule in force → that SSOT's decisions·flow·constraints · what changed → that SSOT's chg, only the rev range you need · how something was built and verified → the one tasks/done/ file you are investigating.
- Read one doc per call; read a large doc section by section. A read is complete only when the doc's last section is present (ssot → `## chg`, task → `## result`). If it is missing the output was truncated — re-read the missing range before judging anything.
- tasks/done/ is an archive of history: never read it in bulk, and never as a source of current rules (its st·base·ssot are as of completion). Open it to investigate a named task, the change behind a regression, or what was verified before. Listing filenames (numbering, dep satisfaction) is not reading them.

## State rules
- STATE ssot row `id|rev|tasked|pending|[?]`: rev=current, tasked=rev consumed into tasks, pending=unconsumed delta summary (`AUTH-5+ AUTH-2✎`), [?]=open decision count. tasked < rev ⇒ create-task target.
- tasked=0 (new domain) ⇒ pending is always `all`, meaning everything up to the current rev. Later changes are absorbed into `all`.
- STATE tasks row's ssot cell holds domains only (`ARCH BM`) — decision IDs live in the task file's quote line.
- Task touches (optional): space-separated repository-relative file/directory paths or `-`. No glob, absolute path, backslash, `.` or `..` components. Overlapping prefixes serialize work-group assignment until integration/release. Omission means unknown, not proven disjoint.
- Task dep uses space-separated task IDs or `-`. No self-dependencies or cycles. Keep task-file dep and STATE dep equal; do not introduce a second dependency field.
- doing·done tasks are immutable. Exception: the implementing session updating its own task's st·checks·result. Content changes become a new task.
- STATE tasks table holds remaining work only (todo·doing·blocked). At done: set st `done@date` in the file, move it to tasks/done/, delete the STATE row, leave one log line. A dep absent from the table is satisfied iff tasks/done/ holds that task's file.
- Planning changes go only through update-ssot(rev+1) → STATE pending → create-task. Never edit tasks directly.
- doc-review touches ssot/ wording only: no rev, no chg, no pending, no task — so editing never invents work. Anything that changes a condition, number, negation, obligation or scope is a planning change and belongs to update-ssot; anything ambiguous stays as written and is reported.
- ideation st: `open@date` → `ready@date` → `converted@date` (in the quote line + STATE ideation row `id|st`). Explored items reuse [o]/[x]/[?]. A domains line converted into a SSOT gets `→<ID>`; the doc becomes converted when every [o] domain has one.
- review st: `open@date` → `ready@date` → `converted@date` (in the quote line + STATE review row `id|st`). Findings start as [?]; the user adopts [o] / rejects [x] ← reason. A [o] finding turned into a task gets `→T###`; the doc becomes converted when every [o] finding has one (no [o] at all ⇒ converted at once).
- review-sourced tasks: ssot = the ARCH decisions the change enforces, `-` if none; base = ARCH@rev always; first impl-notes line `- from review/<slug> Fn`; acceptance keeps behavior unchanged (existing tests still pass). They never move ssot rev/tasked/pending.
- STATE next: 1-3 lines for human/planning resumption. Standalone/planning skills update it on exit; work-group worker/reviewer assignments live in runtime queues instead.
- STATE log: delete beyond 20 lines — detailed history lives in each SSOT's chg and in task files.

## Workspace scope
- STATE, SSOT revisions, task states and done archives describe the current checkout. They are not shared live state across worktrees; writing and re-reading a doing tag is not an atomic claim.
- `work status` discovers standalone, planning and worker contexts. Work groups are optional and require no external orchestrator. `--workspace auto` adopts a free linked worktree when appropriate and creates an isolated worktree otherwise; `current` and `new` override that choice. A branch name is never proof of ownership.
- Each work group has one planning/target branch and checkout. Planning, SSOT edits, task numbering and STATE edits happen there with one writer. Commit the plan before assigning workers. Independent branches cannot safely allocate task IDs using their local maximum alone.
- `work claim-next` selects and reserves in one transaction: dependency-ready tasks with most remaining descendants first, then oldest task ID. Correction work has priority, worker/reviewer slots are bounded (defaults 4/1), and pending submissions pause new assignments at max-pending (default 8). A board read or STATE next never assigns work.
- `work claim` atomically reserves a task and workspace in a versioned runtime under the common Git directory. All linked worktrees of the same clone share it. A new attempt gets a unique ID; retries do not reuse ownership from released attempts. Runtime JSON is CLI-owned, not directly edited or cherry-picked.
- Group workers keep the task's quote line and contract unchanged, update only their own acceptance checks/result and code, and record doing/blocked through `work update`. Task files remain todo until integration; runtime is authoritative for execution status. Planning changes must be handed back to the planning checkout.
- `work submit` runs explicit verification commands against a clean committed worker HEAD. Success records ready (review pending), which does not satisfy dependencies. `work review-claim` reserves a submission in a detached review checkout; `review-finish` records approved or changes_requested with findings. Resume corrections before new work. Approval pins the submission and target commits; worker changes require resubmission, and target movement requires re-review. `work integrate` requires approval and merges into a separate candidate checkout, archives the task with done status, updates STATE, commits and verifies the candidate, then fast-forwards the clean group checkout if its base is unchanged. Only integration satisfies group dependencies. Main/remote integration is a separate project workflow.
- Verification records identify the exact checked commit. The archived result at/verified fields preserve worker submission evidence; the candidate commit and integration checks are recorded in the local runtime. Fresh clones retain Git documents but not local runtime records.
- `context` reports Git and work bindings. Plain `board` is a checkout-only file view; dependencyReady does not check ownership or policy freshness. `work board` reads one fixed group commit and overlays runtime attempts. Its claimable flag is advisory; only claim establishes ownership. Worker policy updates require explicit synchronization and verification.
- `work cleanup` removes a tool-created worker only after integration/release and ancestry/cleanliness checks, preserving ignored/untracked changes. External worktrees remain on disk; only their binding is cleared. Branches and failed candidates can remain for recovery. Release requires stopping the old worker; no automatic TTL takeover, force deletion or push is performed.
- Review records carry a unique review ID, submission ID, commit, baseCommit, owner, summary and findings. Results use verdict approved|changes_requested and findings with priority P1|P2|P3, where and message. P1/P2 findings prevent approval. Released/superseded IDs cannot approve newer submissions. Reviewers never edit code or spec in their snapshot.
- `work run` executes an explicitly configured command adapter with JSON input/output; it owns dispatch, heartbeat, submission and integration. It stops on settled queues or configured dispatch/retry limits. Failed/interrupted work stays inspectable; waiting uses process events rather than repeated model calls. Same-clone execution is the supported scope.
- Existing standalone documents keep the original STATE and done workflow. Installing skills does not rewrite existing FORMAT/STATE; work-group behavior is an explicit optional protocol and uses the same task-file skeleton.

## Language
- Every spec/ doc is written in English. Code, identifiers, and paths stay as-is.
- cfg.lang = the user's language: interviews, confirmations, and reports happen in it. cfg.docs = doc language (default en).
- Sole exception: spec/NARRATIVE.md (written by create-narrative) is a human-facing prose doc in the user's language — FORMAT notation does not apply to it. It is a derived view of ssot/: it never introduces decisions, and on conflict ssot/ wins.
