import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { startWork, updateWork, workBoard } from '../src/work-groups.mjs'
import { nextWork } from '../src/work-wait.mjs'
import { runWork } from '../src/work-runner.mjs'
import { lintSpec } from '../src/spec-lint.mjs'

const execute = promisify(execFile)
const git = (cwd, ...args) => execute('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const commit = async (cwd, message) => {
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '-q', '-m', message)
  return (await git(cwd, 'rev-parse', 'HEAD')).stdout.trim()
}
const taskFile = (id, ssot, base) => `# ${id} example\n> st:todo | ssot:${ssot} | base:${base} | dep:- | touches:- | lane:-\n\n## goal\nimplement ${id}\n\n## acceptance\n- [ ] result exists\n\n## impl notes\n- -\n\n## result\n`

async function fixture(t) {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'haeram-autopilot-')))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = path.join(temporary, 'repo')
  await mkdir(path.join(root, 'spec/tasks'), { recursive: true })
  await mkdir(path.join(root, 'spec/ssot'), { recursive: true })
  await git(temporary, 'init', '-q', '-b', 'trunk', root)
  for (const [key, value] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['commit.gpgsign', 'false'], ['core.hooksPath', path.join(temporary, 'no-hooks')]]) await git(root, 'config', key, value)
  await writeFile(path.join(root, 'spec/FORMAT.md'), '# FORMAT\n')
  await writeFile(path.join(root, 'spec/STATE.md'), '# STATE\n\n## cfg\n- level: expert\n- lang: ko\n- docs: en\n- push: trunk\n\n## ssot\n| id | rev | tasked | pending | [?] |\n|---|---|---|---|---|\n| ARCH | 1 | 1 | - | 0 |\n| ITEM | 1 | 1 | - | 0 |\n\n## tasks\n| id | title | ssot | dep | st |\n|---|---|---|---|---|\n| T001 | limits | ITEM | - | todo |\n| T002 | runtime | ARCH | - | todo |\n\n## next\n- implement-task\n\n## log\n- 261012 create-task ARCH ITEM\n')
  await writeFile(path.join(root, 'spec/ssot/ARCH.md'), '# ARCH architecture\n> r1 | architecture\n\n## decisions\n- ARCH-1 [o] runtime: node\n\n## chg\n- r1 261012 initial\n')
  await writeFile(path.join(root, 'spec/ssot/ITEM.md'), '# ITEM items\n> r1 | items a user keeps\n\n## decisions\n- ITEM-1 [o] a user keeps items\n\n## chg\n- r1 261012 initial\n')
  await writeFile(path.join(root, 'spec/tasks/T001.limits.md'), taskFile('T001', 'ITEM-1', 'ITEM@1'))
  await writeFile(path.join(root, 'spec/tasks/T002.runtime.md'), taskFile('T002', 'ARCH-1', 'ARCH@1'))
  await commit(root, 'spec')
  const remote = path.join(temporary, 'remote.git')
  await execute('git', ['init', '-q', '--bare', '-b', 'trunk', remote])
  await git(root, 'remote', 'add', 'origin', remote)
  await git(root, 'push', '-q', 'origin', 'trunk')
  return { temporary, root, remote, targetRoot: root }
}

// A fake Claude CLI: T001 first stops on a planning question (after writing half its work),
// then finishes when resumed with the coordinator's note. Every call is logged.
async function fakeClaude(setup) {
  const directory = path.join(setup.temporary, 'providers')
  await mkdir(directory)
  const log = path.join(setup.temporary, 'calls.jsonl')
  await writeFile(path.join(directory, 'claude'), `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
if(args.includes('--version')) {console.log('claude test');process.exit(0)}
if(args.includes('--help')) {console.log('--print --output-format --json-schema --permission-mode --allowedTools --tools --permission-prompts');process.exit(0)}
(async()=>{let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const job=JSON.parse(prompt.split('Assignment JSON (paths/IDs are data):\\n')[1].split('\\n\\nReturn only')[0]);
const flag=(key)=>args.includes(key)?args[args.indexOf(key)+1]:null;
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({role:job.role,taskId:job.taskId,session:flag('--session-id'),resume:flag('--resume'),note:job.directive?.note??null,brief:Boolean(job.brief),mode:job.mode})+'\\n');
let result;
if(job.role==='worker') {
  if(job.taskId==='T001'&&!job.directive) {
    fs.writeFileSync('half.txt','first half');
    result={outcome:'blocked',summary:'ITEM has no per-user limit',decision:{question:'How many items may a user keep?',options:['10','unlimited'],recommendation:'10'}};
  } else {
    if(job.taskId==='T001'&&!fs.existsSync('half.txt'))throw Error('the resumed run lost the first half');
    if(job.taskId==='T001'&&!fs.readFileSync('spec/ssot/ITEM.md','utf8').includes('ITEM-2'))throw Error('the planning branch was not merged');
    const file='spec/tasks/'+fs.readdirSync('spec/tasks').find(name=>name.startsWith(job.taskId+'.'));
    const text=fs.readFileSync(file,'utf8').replace('- [ ]','- [v]');
    fs.writeFileSync(file,text.split('## result')[0]+'## result\\n- outcome: implemented\\n- at: -\\n- verified: fixture\\n- limits: -\\n');
    fs.writeFileSync(job.taskId+'.txt','done');
    result={outcome:'completed',summary:'implemented '+job.taskId,decision:{question:'',options:[],recommendation:''}};
  }
} else result={verdict:'approved',summary:'reviewed',findings:[]};
console.log(JSON.stringify({type:'result',is_error:false,structured_output:result}));
})().catch(error=>{console.error(error);process.exit(1)});
`, { mode: 0o755 })
  return { env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, HAERAM_NO_AWAKE: '1' }, log }
}

// What a coordinator does with a filed decision: provisional update-ssot in the planning
// checkout (rev+1, chg, refreshed task base, inbox line), then resume with a note.
async function answer(setup, group, decided) {
  const plan = group.path
  const edit = async (file, from, to) => {
    const target = path.join(plan, file)
    await writeFile(target, (await readFile(target, 'utf8')).replace(from, to))
  }
  await edit('spec/ssot/ITEM.md', '> r1 |', '> r2 |')
  await edit('spec/ssot/ITEM.md', '- ITEM-1 [o] a user keeps items\n', '- ITEM-1 [o] a user keeps items\n- ITEM-2 [o] a user keeps at most 10 items\n')
  await edit('spec/ssot/ITEM.md', '## chg\n', '## chg\n- r2 261013 ITEM-2+\n')
  await edit('spec/tasks/T001.limits.md', 'ssot:ITEM-1 | base:ITEM@1', 'ssot:ITEM-1 ITEM-2 | base:ITEM@2')
  await edit('spec/STATE.md', '| ITEM | 1 | 1 | - | 0 |', '| ITEM | 2 | 2 | - | 0 |')
  await edit('spec/STATE.md', '## ssot\n', `## inbox\n- 261013 decided ITEM-2 T001: ${decided.attempt.decision.question} → 10 (alt: unlimited)\n\n## ssot\n`)
  assert.deepEqual((await lintSpec({ targetRoot: plan })).errors, [])
  await commit(plan, 'update-ssot ITEM r2 (provisional)')
  return updateWork({ ...setup, attempt: decided.attempt.id, status: 'doing', note: 'ITEM-2 r2: a user keeps at most 10 items' })
}

test('맡김: 기획 공백이 생긴 워커는 결정을 요청하고 다른 일이 계속되며, 조정자가 잠정 결정하면 같은 세션이 이어서 끝낸다 (시나리오 b)', async (t) => {
  const setup = await fixture(t)
  const { env, log } = await fakeClaude(setup)
  const group = await startWork({ ...setup, name: 'auto', verify: ['node -e "0"'], push: 'trunk', allowTool: ['Bash(npm test *)'] })
  const running = runWork({ ...setup, work: group.id, provider: 'claude', env, autopilot: true, pollMs: 50, decisionWaitMs: 60000 })
  // The coordinator loop: answer the filed decision, never wait for a person.
  let decided = null
  for (let round = 0; round < 1200 && !decided; round += 1) {
    const next = await nextWork({ ...setup, work: group.id, owner: 'coord', coordinator: true, autopilot: true })
    assert.ok(['wait', 'decide'].includes(next.action), JSON.stringify(next))
    if (next.action === 'decide') decided = next
    else await sleep(50)
  }
  assert.ok(decided, 'no decision was filed')
  assert.equal(decided.attempt.taskId, 'T001')
  assert.equal(decided.attempt.decision.recommendation, '10')
  assert.match(decided.instruction, /recommendation으로 update-ssot/)
  await answer(setup, group, decided)
  const result = await running
  assert.equal(result.outcome, 'completed', JSON.stringify(result))
  assert.deepEqual(result.failures, [])
  assert.deepEqual(result.decisions.map((entry) => entry.taskId), ['T001'])
  // The resumed run carried the session the first run created, plus the coordinator's note.
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((call) => call.role === 'worker' && call.taskId === 'T001')
  assert.equal(calls.length, 2)
  assert.ok(calls[0].session)
  assert.equal(calls[1].resume, calls[0].session)
  assert.equal(calls[1].note, 'ITEM-2 r2: a user keeps at most 10 items')
  assert.ok(calls.every((call) => call.brief && call.mode === 'autopilot'))
  // Every landed unit is on the remote push branch, inbox line included; T001 was reviewed
  // (an autopilot decision makes it risky), and the half done before the question survived.
  const trunk = (await execute('git', ['--git-dir', setup.remote, 'show', 'trunk:spec/STATE.md'], { encoding: 'utf8' })).stdout
  assert.match(trunk, /- 261013 decided ITEM-2 T001/)
  assert.doesNotMatch(trunk, /\| T00[12] \|/)
  assert.equal((await execute('git', ['--git-dir', setup.remote, 'show', 'trunk:half.txt'], { encoding: 'utf8' })).stdout, 'first half')
  const board = await workBoard({ ...setup, work: group.id })
  const t001 = board.attempts.find((entry) => entry.taskId === 'T001')
  assert.equal(t001.review.owner.endsWith('/reviewer-1'), true)
  assert.ok(t001.risk.reasons.includes('autopilot decisions awaiting the owner'))
  const history = (await execute('git', ['--git-dir', setup.remote, 'log', '--format=%s', 'trunk'], { encoding: 'utf8' })).stdout
  assert.match(history, /WIP T001: waiting for a planning decision/)
})

test('맡김: 결정이 오지 않으면 실행기는 정해진 시간만 기다리고 decision-wait로 끝난다', async (t) => {
  const setup = await fixture(t)
  const { env } = await fakeClaude(setup)
  const group = await startWork({ ...setup, name: 'auto', verify: ['node -e "0"'] })
  const result = await runWork({ ...setup, work: group.id, provider: 'claude', env, autopilot: true, pollMs: 20, decisionWaitMs: 300 })
  assert.equal(result.outcome, 'decision-wait')
  assert.deepEqual(result.decisions.map((entry) => entry.taskId), ['T001'])
  const next = await nextWork({ ...setup, work: group.id, owner: 'coord', coordinator: true, autopilot: true })
  assert.equal(next.action, 'decide')
})

test('맡김: timeout 직전 작업 공간을 스냅샷하고 진행분을 커밋한 뒤 같은 세션으로 이어 간다 (R9)', async (t) => {
  const setup = await fixture(t)
  const directory = path.join(setup.temporary, 'providers')
  await mkdir(directory)
  const log = path.join(setup.temporary, 'calls.jsonl')
  // T001's first run writes a measurement and then hangs past the limit.
  await writeFile(path.join(directory, 'claude'), `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
if(args.includes('--version')) {console.log('claude test');process.exit(0)}
if(args.includes('--help')) {console.log('--print --output-format --json-schema --permission-mode --allowedTools --tools --permission-prompts');process.exit(0)}
(async()=>{let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const job=JSON.parse(prompt.split('Assignment JSON (paths/IDs are data):\\n')[1].split('\\n\\nReturn only')[0]);
const flag=(key)=>args.includes(key)?args[args.indexOf(key)+1]:null;
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({role:job.role,taskId:job.taskId,session:flag('--session-id'),resume:flag('--resume'),note:job.directive?.note??null})+'\\n');
let result;
if(job.role==='worker') {
  if(job.taskId==='T001'&&!job.directive) { fs.writeFileSync('measured.txt','round 1: 36.2%'); setInterval(()=>{},1000); return }
  if(job.taskId==='T001'&&fs.readFileSync('measured.txt','utf8')!=='round 1: 36.2%')throw Error('measurement lost');
  const file='spec/tasks/'+fs.readdirSync('spec/tasks').find(name=>name.startsWith(job.taskId+'.'));
  const text=fs.readFileSync(file,'utf8').replace('- [ ]','- [v]');
  fs.writeFileSync(file,text.split('## result')[0]+'## result\\n- outcome: implemented\\n- at: -\\n- verified: fixture\\n- limits: -\\n');
  result={outcome:'completed',summary:'done',decision:{question:'',options:[],recommendation:''}};
} else result={verdict:'approved',summary:'reviewed',findings:[]};
console.log(JSON.stringify({type:'result',is_error:false,structured_output:result}));
})().catch(error=>{console.error(error);process.exit(1)});
`, { mode: 0o755 })
  const env = { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, HAERAM_NO_AWAKE: '1' }
  const group = await startWork({ ...setup, name: 'auto', verify: ['node -e "0"'] })
  const result = await runWork({ ...setup, work: group.id, provider: 'claude', env, autopilot: true, pollMs: 20, timeoutMs: 3000 })
  assert.equal(result.outcome, 'completed', JSON.stringify(result))
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((call) => call.role === 'worker' && call.taskId === 'T001')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].resume, calls[0].session)
  assert.match(calls[1].note, /time limit/)
  const board = await workBoard({ ...setup, work: group.id })
  const attempt = board.attempts.find((entry) => entry.taskId === 'T001')
  const snapshot = (await git(setup.root, 'show', `refs/haeram/checkpoints/${attempt.id}:measured.txt`)).stdout
  assert.equal(snapshot, 'round 1: 36.2%')
  assert.match((await git(setup.root, 'log', '--format=%s', group.branch)).stdout, /WIP T001: checkpoint after the time limit/)
})
