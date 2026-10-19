import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fixture, git } from './helpers/vibe-fixture.mjs'
import { vibeLoop, executeVibeUnit } from '../src/vibe-loop.mjs'
import { vibeStatus } from '../src/vibe.mjs'
import { activeRows } from '../src/state-doc.mjs'

const passed = async () => ({ ok: true, checks: [] })
const unit = (outcome = 'completed') => ({ exitCode: 0, result: { kind: 'task', id: 'T001', outcome, pushed: false, next: 'implementation' } })
const opts = (root) => ({ targetRoot: root, tag: 't060', provider: 'claude', maxUnits: 3 })
async function fakeAdapter(temporary, body) {
  const file = path.join(temporary, 'fake-provider.cjs'), config = path.join(temporary, 'adapter.json')
  await writeFile(file, `const fs=require('node:fs'),cp=require('node:child_process');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const job=JSON.parse(input);${body}});`)
  await writeFile(config, JSON.stringify({ command: process.execPath, args: [file] }))
  return config
}

test('dry-run has zero model calls or mutations; options and ARCH tier plan are visible', async (t) => {
  const { root, initial } = await fixture(t)
  const result = await vibeLoop({ ...opts(root), dryRun: true }, { execute: () => assert.fail('no model'), preflight: () => assert.fail('no probe') })
  assert.equal(result.modelRequests, 0); assert.equal(result.freshSessionPerUnit, true)
  assert.equal(result.limits.batchSize, 3)
  assert.equal(await git(root, 'rev-parse', 'HEAD'), initial)
  assert.equal(await git(root, 'status', '--porcelain'), '')
})

test('command adapter runs one new process/session per task, preflights once, and shares one report/tag', async (t) => {
  const { root, temporary } = await fixture(t)
  const records = path.join(temporary, 'records.jsonl')
  const adapter = await fakeAdapter(temporary, `
    fs.appendFileSync(${JSON.stringify(records)},JSON.stringify({pid:process.pid,tag:job.tag,report:job.report,base:job.diffBase,resume:job.resume})+'\\n');
    fs.writeFileSync(job.sessionFile,'session-'+process.pid);
    const stateFile='spec/STATE.md';let state=fs.readFileSync(stateFile,'utf8');
    const id=job.brief.taskId;state=state.split('\\n').filter(line=>!line.startsWith('| '+id+' |')).join('\\n');fs.writeFileSync(stateFile,state);
    fs.renameSync('spec/tasks/'+id+'.example.md','spec/tasks/done/'+id+'.example.md');
    cp.execFileSync('git',['add','spec']);cp.execFileSync('git',['commit','-q','-m',id+' done']);
    console.log(JSON.stringify({kind:'task',id,outcome:'completed',pushed:false,next:'implementation'}));`)
  let preflights = 0, pushes = 0
  const result = await vibeLoop({ ...opts(root), adapter, provider: undefined }, { preflight: async (options) => { preflights++; assert.equal(options.probeWorkspace, 'current'); return passed() }, push: async () => { pushes++; return { ok: true, pushed: null } } })
  assert.equal(result.ok, true, result.error); assert.equal(result.units, 3); assert.equal(preflights, 1)
  const rows = (await readFile(records, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(new Set(rows.map((row) => row.pid)).size, 3)
  assert.equal(new Set(rows.map((row) => row.report)).size, 1)
  assert.ok(rows.every((row) => row.tag === 't060' && row.resume === undefined))
  const manifest = JSON.parse(await readFile(result.manifest, 'utf8'))
  assert.equal(new Set(manifest.dispatches.map((row) => row.session)).size, 3)
  assert.equal(manifest.dispatches.filter((row) => row.log).length, 3)
  assert.ok(pushes <= 2)
  assert.deepEqual(activeRows(await readFile(path.join(root, 'spec/STATE.md'), 'utf8')), [])
  assert.doesNotMatch(await readFile(path.join(root, result.report), 'utf8'), /to:-/)
})

for (const [name, execute, expected] of [
  ['unchanged HEAD/STATE', async () => unit(), 'no-progress'],
  ['repeated session errors', async () => ({ exitCode: 1, result: null }), 'session-failures'],
]) test(`loop stops after two ${name}`, async (t) => {
  const { root } = await fixture(t)
  const result = await vibeLoop({ ...opts(root), maxUnits: 10 }, { preflight: passed, execute })
  assert.equal(result.reason, expected); assert.equal(result.units, 2)
  assert.deepEqual(activeRows(await readFile(path.join(root, 'spec/STATE.md'), 'utf8')), [])
})

test('stop file and parked-only route stop without dispatching a model', async (t) => {
  const { root } = await fixture(t)
  await vibeLoop({ targetRoot: root, tag: 't060', stop: true })
  const stopped = await vibeLoop(opts(root), { preflight: () => assert.fail('already stopped'), execute: () => assert.fail('no model') })
  assert.equal(stopped.reason, 'stop-file'); assert.equal(stopped.units, 0)
  const parked = await vibeLoop({ ...opts(root), tag: 't061' }, { preflight: passed, status: async () => ({ route: 'implementation', parkedOnly: true }), execute: () => assert.fail('parked') })
  assert.equal(parked.reason, 'parked-only')
})

test('no-work and max-hours routes terminate, closing report once', async (t) => {
  const { root } = await fixture(t, 0)
  const noWork = await vibeLoop(opts(root), { preflight: passed, execute: () => assert.fail('no work') })
  assert.equal(noWork.reason, 'no-work'); assert.equal(noWork.units, 0)
  let now = 0
  const timed = await vibeLoop({ ...opts(root), tag: 't062', maxHours: 1 }, { preflight: async () => { now = 3600001; return passed() }, now: () => now, execute: () => assert.fail('time limit') })
  assert.equal(timed.reason, 'max-hours')
})

test('batch gate and CI run once for multiple task commits, entirely outside model dispatch', async (t) => {
  const { root } = await fixture(t)
  let calls = 0, checks = 0, waits = 0
  const result = await vibeLoop({ ...opts(root), maxUnits: 2 }, { preflight: passed,
    execute: async () => { calls++; await writeFile(path.join(root, 'app.js'), `// ${calls}\n`); await git(root, 'add', 'app.js'); await git(root, 'commit', '-q', '-m', 'task'); return unit() },
    check: async (options) => { checks++; assert.equal(options.tier, 'batch'); return { ok: true } },
    push: async () => ({ ok: true, pushed: await git(root, 'rev-parse', 'HEAD') }),
    ci: async () => { waits++; assert.equal(calls, 2); return { ok: true, outcome: 'success', jobs: [] } },
  })
  assert.equal(result.ok, true, result.error); assert.equal(checks, 1); assert.equal(waits, 1)
})

test('failed batch gate prevents code push and preserves commits and logs', async (t) => {
  const { root } = await fixture(t)
  const result = await vibeLoop({ ...opts(root), maxUnits: 1 }, { preflight: passed,
    execute: async () => { await writeFile(path.join(root, 'app.js'), '// changed\n'); await git(root, 'add', 'app.js'); await git(root, 'commit', '-q', '-m', 'task'); return unit() },
    check: async () => ({ ok: false, log: '/test/log' }), push: () => assert.fail('gate failed'),
  })
  assert.equal(result.ok, false); assert.match(result.error, /묶음 검증 실패/)
  assert.match(await readFile(path.join(root, 'app.js'), 'utf8'), /changed/)
})

test('CI failure creates a concrete fix task with job evidence', async (t) => {
  const { root } = await fixture(t)
  const result = await vibeLoop({ ...opts(root), maxUnits: 1 }, { preflight: passed,
    execute: async () => { await writeFile(path.join(root, 'app.js'), '// code\n'); await git(root, 'add', 'app.js'); await git(root, 'commit', '-q', '-m', 'task'); return unit() },
    check: async () => ({ ok: true }), push: async () => ({ ok: true, pushed: await git(root, 'rev-parse', 'HEAD') }),
    ci: async () => ({ ok: false, outcome: 'failure', runUrl: 'https://example.test/run/1', jobs: [{ name: 'unit', conclusion: 'failure', failedSteps: ['Regression'] }] }),
  })
  assert.equal(result.ok, false); assert.match(result.error, /T004/)
  assert.match(await readFile(path.join(root, 'spec/tasks/T004.fix-ci.md'), 'utf8'), /Regression/)
  assert.match(await readFile(path.join(root, 'spec/STATE.md'), 'utf8'), /implement-task T004/)
})

test('a stop marker terminates an active command adapter rather than starting another session', async (t) => {
  const { root, temporary, initial } = await fixture(t)
  const adapter = await fakeAdapter(temporary, 'setTimeout(()=>{},20000);')
  const directory = path.join(temporary, 'logs'); await mkdir(directory)
  const stopFile = path.join(directory, 'STOP'); await writeFile(stopFile, 'stop')
  const r = await executeVibeUnit({ adapter, tag: 't060' }, { workspace: root, role: 'unit', diffBase: initial }, directory, { stopFile, deadline: Date.now() + 10000, timeoutMs: 10000 })
  assert.equal(r.stopped, 'stop-file'); assert.equal(r.result, null)
  assert.ok(await readFile(r.log, 'utf8') !== undefined)
})

test('detached host survives parent return and writes its final manifest with one shared report', async (t) => {
  const { root, temporary } = await fixture(t)
  const bin = path.join(temporary, 'bin'); await mkdir(bin)
  await writeFile(path.join(bin, 'claude'), `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({structured_output:{ran:true,exitCode:0,denied:false,note:'fake main checkout probe'}})));`, { mode: 0o755 })
  const adapter = await fakeAdapter(temporary, "console.log(JSON.stringify({kind:'none',id:'',outcome:'no_work',pushed:false,next:'stop'}));")
  const result = await vibeLoop({ ...opts(root), adapter, provider: undefined, detach: true, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } })
  assert.equal(result.detached, true); assert.ok(result.pid)
  t.after(() => { try { process.kill(-result.pid, 'SIGTERM') } catch {} })
  let state
  for (let i = 0; i < 150; i++) {
    try { state = JSON.parse(await readFile(result.manifest, 'utf8')) } catch {}
    if (state?.reason) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(state?.reason, 'no-progress', await readFile(result.log, 'utf8'))
  assert.equal(state.units, 2)
  assert.doesNotMatch(await readFile(path.join(root, state.report), 'utf8'), /to:-/)
})

test('strict concurrency keeps per-unit batch gates and pushes', async (t) => {
  const { root } = await fixture(t)
  let checks = 0, pushes = 0, n = 0
  const result = await vibeLoop({ ...opts(root), maxUnits: 2 }, { preflight: passed,
    status: async (options) => ({ ...await vibeStatus(options), concurrency: 'strict' }),
    execute: async () => { await writeFile(path.join(root, 'app.js'), `// ${++n}\n`); await git(root, 'add', 'app.js'); await git(root, 'commit', '-q', '-m', 'task'); return unit() },
    check: async () => { checks++; return { ok: true } }, push: async () => { pushes++; return { ok: true, pushed: null } },
  })
  assert.equal(result.ok, true, result.error); assert.equal(checks, 2); assert.ok(pushes >= 2)
})

test('hourly snapshots span fresh unit sessions instead of resetting at each launch', async (t) => {
  const { root } = await fixture(t)
  let now = Date.now(), n = 0, snapshots = 0
  const result = await vibeLoop({ ...opts(root), maxUnits: 4, maxHours: 5 }, { preflight: passed, now: () => now,
    execute: async () => { now += 30 * 60000; await writeFile(path.join(root, 'app.js'), `// ${++n}\n`); await git(root, 'add', 'app.js'); await git(root, 'commit', '-q', '-m', 'task'); return unit() },
    checkpoint: async () => { snapshots++ }, check: async () => ({ ok: true }), push: async () => ({ ok: true, pushed: null }),
  })
  assert.equal(result.ok, true, result.error); assert.equal(result.units, 4); assert.equal(snapshots, 2)
})
