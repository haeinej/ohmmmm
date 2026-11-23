import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ASK, ASK_AFTER, ASK_EVERY, ASK_MAX, BUDGETS, chars, promptWords } from '../src/adapter.mjs';
import { RECENT } from '../src/folder.mjs';
import { initCortex, openCortex } from '../src/folder.mjs';

// Every person here is invented. The hook inputs are synthetic, shaped as each client documents them.
const template = fileURLToPath(new URL('../template', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const fresh = async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'cortex-')), 'cortex');
  await initCortex(dir, template);
  return dir;
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// What Claude Code hands a hook on standard input.
const claude = {
  'session-start': session => ({ session_id: session, transcript_path: '/home/sam/.claude/projects/x/t.jsonl', cwd: '/home/sam/work', hook_event_name: 'SessionStart', source: 'startup', model: 'claude-opus-5' }),
  prompt: session => ({ session_id: session, transcript_path: '/home/sam/.claude/projects/x/t.jsonl', cwd: '/home/sam/work', permission_mode: 'default', hook_event_name: 'UserPromptSubmit', prompt: 'Tidy the essays section' }),
  stop: (session, active = false) => ({ session_id: session, transcript_path: '/home/sam/.claude/projects/x/t.jsonl', cwd: '/home/sam/work', permission_mode: 'default', hook_event_name: 'Stop', stop_hook_active: active, last_assistant_message: 'Done.', background_tasks: [], session_crons: [] }),
  'session-end': session => ({ session_id: session, transcript_path: '/home/sam/.claude/projects/x/t.jsonl', cwd: '/home/sam/work', hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }),
};
// What Codex hands a hook on standard input.
const codex = {
  'session-start': session => ({ session_id: session, transcript_path: null, cwd: '/home/sam/work', hook_event_name: 'SessionStart', model: 'gpt-5-codex', source: 'startup' }),
  prompt: session => ({ session_id: session, transcript_path: null, cwd: '/home/sam/work', hook_event_name: 'UserPromptSubmit', model: 'gpt-5-codex', turn_id: 't1', prompt: 'Tidy the essays section' }),
  stop: (session, active = false) => ({ session_id: session, transcript_path: null, cwd: '/home/sam/work', hook_event_name: 'Stop', model: 'gpt-5-codex', turn_id: 't1', stop_hook_active: active, last_assistant_message: 'Done.' }),
  'session-end': session => ({ session_id: session, transcript_path: null, cwd: '/home/sam/work', hook_event_name: 'SessionEnd', model: 'gpt-5-codex', reason: 'other' }),
};
const shapes = [['claude-code', claude], ['codex', codex]];

// Runs `cortex hook` as a client does: the input on standard input, the answer on standard output.
const run = (moment, dir, agent, input) => {
  const started = performance.now();
  const done = spawnSync('node', [cli, 'hook', moment, dir, '--agent', agent], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  return { status: done.status, out: done.stdout, err: done.stderr, ms: performance.now() - started };
};
const contextOf = out => JSON.parse(out).hookSpecificOutput.additionalContext;
const asked = out => out !== '' && JSON.parse(out).decision === 'block';
// The hooks' checkpoints: starts, turns and asks.
const lines = async dir => (await readFile(join(dir, '.cortex', 'hooks.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const loneHalf = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test('session-start gives the playbook, the profile and the observations within each client\'s budget, and never a proposal', async () => {
  const dir = await fresh();
  const person = openCortex(dir, { actor: 'member' });
  await person.setAccount('did:plc:example0sam');
  await person.writeProfile('## Preferences\n\n- Keep drafts to short paragraphs\n\n## Goals\n\n- Finish the tides essay\n');
  await person.observe({ id: 'pinned-titles', text: 'Titles start with "On".', pin: true });
  await openCortex(dir, { actor: 'codex' }).observe({ id: 'walks', text: 'Walks to the harbour before writing.', about: [] });
  await openCortex(dir, { actor: 'codex' }).proposeProfile({ heading: 'Goals', line: 'Publish weekly', quote: 'I would like to publish weekly' });
  for (const [agent, shape] of shapes) {
    const { status, out, ms } = run('session-start', dir, agent, shape['session-start']('s1'));
    assert.equal(status, 0);
    const context = contextOf(out);
    assert.ok(chars(context) <= BUDGETS[agent], `${agent}: ${chars(context)} characters`);
    // Claude Code has room for the whole playbook; Codex is pointed to cortex_start for it.
    assert.match(context, agent === 'claude-code' ? /## The playbook \(agents\/AGENTS\.md\)\n\n# How to keep this cortex/ : /Call cortex_start now: it returns the playbook in full/);
    assert.match(context, /Account: did:plc:example0sam/);
    assert.match(context, /- Keep drafts to short paragraphs/);
    // Pinned first, then the newest.
    assert.match(context, /## Observations\n\n- Titles start with "On"\. \[pinned-titles, you, \d{4}-\d{2}-\d{2}\]\n- Walks to the harbour before writing\. \[walks, codex/);
    assert.doesNotMatch(context, /Publish weekly/, 'a proposal is the person\'s to answer, not an instruction');
    assert.ok(ms < 2000);
  }
});

test('session-start drops the oldest observations first, then points to the playbook, and stays whole characters', async () => {
  const dir = await fresh();
  const person = openCortex(dir, { actor: 'member', now: () => new Date('2026-11-01T00:00:00.000Z') });
  await person.observe({ id: 'kept-pin', text: 'Pinned, so always shown.', pin: true });
  for (let n = 0; n < 30; n++) {
    await openCortex(dir, { actor: 'codex', now: () => new Date(Date.UTC(2026, 10, 1, 0, n)) }).observe({ id: `seen-${n}`, text: `Observation ${n}: ${'🌊 '.repeat(90)}` });
  }
  const context = contextOf(run('session-start', dir, 'codex', codex['session-start']('s1')).out);
  assert.ok(chars(context) <= BUDGETS.codex);
  assert.match(context, /Pinned, so always shown/);
  assert.match(context, /Observation 29:/, 'the newest stays');
  assert.doesNotMatch(context, /Observation 0:/, 'the oldest goes first');
  assert.equal(loneHalf.test(context), false);
  // With room, nothing is dropped.
  const roomy = contextOf(run('session-start', dir, 'claude-code', claude['session-start']('s2')).out);
  assert.match(roomy, /## The playbook \(agents\/AGENTS\.md\)\n\n# How to keep this cortex/);
});

test(`stop asks once a session for observations, from turn ${ASK_AFTER} on, and not if the agent already wrote one`, async () => {
  for (const [agent, shape] of shapes) {
    const dir = await fresh();
    run('session-start', dir, agent, shape['session-start']('s1'));
    assert.equal(asked(run('stop', dir, agent, shape.stop('s1')).out), false, 'one turn is not asked about');
    const second = run('stop', dir, agent, shape.stop('s1'));
    assert.equal(asked(second.out), true);
    assert.equal(JSON.parse(second.out).reason, ASK);
    // The client continues because the hook asked: no second ask.
    assert.equal(run('stop', dir, agent, shape.stop('s1', true)).out, '');
    assert.equal(run('stop', dir, agent, shape.stop('s1')).out, '', 'asked once a session');
    // Another session is asked on its own.
    run('session-start', dir, agent, shape['session-start']('s2'));
    run('stop', dir, agent, shape.stop('s2'));
    assert.equal(asked(run('stop', dir, agent, shape.stop('s2')).out), true);
    // An agent that already wrote an observation this session is not asked.
    run('session-start', dir, agent, shape['session-start']('s3'));
    await openCortex(dir, { actor: agent }).observe({ id: `seen-in-s3-${agent}`, text: 'Prefers tables to lists.' });
    run('stop', dir, agent, shape.stop('s3'));
    assert.equal(run('stop', dir, agent, shape.stop('s3')).out, '');
    assert.ok((await lines(dir)).every(line => typeof line.session === 'string'));
  }
});

test('session-start answers in full without .cortex/, and when the hooks\' log cannot be written', async () => {
  const dir = await fresh();
  await rm(join(dir, '.cortex'), { recursive: true, force: true });
  const { status, out } = run('session-start', dir, 'claude-code', claude['session-start']('s1'));
  assert.equal(status, 0);
  assert.match(contextOf(out), /## The playbook/);
  assert.equal((await lines(dir))[0].session, 's1', 'the folder is made');

  await rm(join(dir, '.cortex', 'hooks.jsonl'));
  await mkdir(join(dir, '.cortex', 'hooks.jsonl'));
  const broken = run('session-start', dir, 'codex', codex['session-start']('s2'));
  assert.equal(broken.status, 0);
  assert.match(contextOf(broken.out), /## Their profile/);
  // A stop whose checkpoint cannot be written asks nothing, and exits 0.
  for (let turn = 0; turn < 3; turn++) assert.deepEqual((({ status, out }) => [status, out])(run('stop', dir, 'codex', codex.stop('s2'))), [0, '']);
});

test(`stop asks again after ${ASK_EVERY} more turns with nothing recorded, at most ${ASK_MAX} times a session`, async () => {
  const dir = await fresh();
  run('session-start', dir, 'claude-code', claude['session-start']('long'));
  let asks = 0;
  const turns = ASK_AFTER + ASK_EVERY * (ASK_MAX + 2);
  const askedAt = [];
  for (let turn = 1; turn <= turns; turn++) {
    if (asked(run('stop', dir, 'claude-code', claude.stop('long')).out)) { asks++; askedAt.push(turn); }
  }
  assert.equal(asks, ASK_MAX);
  assert.deepEqual(askedAt.slice(0, 2), [ASK_AFTER, ASK_AFTER + ASK_EVERY]);

  // An observation recorded after an ask holds off the next one.
  const other = await fresh();
  run('session-start', other, 'codex', codex['session-start']('s'));
  for (let turn = 1; turn <= ASK_AFTER; turn++) run('stop', other, 'codex', codex.stop('s'));
  await pause(5);
  await openCortex(other, { actor: 'codex' }).observe({ id: 'late-correction', text: 'Wanted the report header changed to the new one.' });
  let later = 0;
  for (let turn = 1; turn <= ASK_EVERY; turn++) if (asked(run('stop', other, 'codex', codex.stop('s')).out)) later++;
  assert.equal(later, 0);
});

test('the ask names corrections, mistakes and repeated requests', () => {
  for (const words of [/correction/, /wrong|out of date/, /again/]) assert.match(ASK, words);
});

test('prompt words keep meaningful Latin words and Hangul, and drop common ones', () => {
  assert.deepEqual(promptWords('Tidy the essays section, please'), ['tidy', 'essays', 'section']);
  assert.deepEqual(promptWords('주간 보고서 헤더 바꿔줘'), ['주간', '보고서', '헤더', '바꿔줘']);
});

test('prompt recalls older matching observations once a session, and nothing when none match', async () => {
  const dir = await fresh();
  const cortex = openCortex(dir, { actor: 'member' });
  await cortex.observe({ id: 'old-header', text: 'The weekly report uses the new header since November.' });
  await pause(5);
  for (let n = 0; n < RECENT; n++) await cortex.observe({ id: `newer-${n}`, text: `Something newer, ${n}.` });
  const input = { ...claude.prompt('s1'), prompt: 'Draft the weekly report' };
  const first = run('prompt', dir, 'claude-code', input);
  assert.equal(first.status, 0);
  const context = contextOf(first.out);
  assert.match(context, /old-header/);
  assert.doesNotMatch(context, /newer-/, 'session start already gave the newest');
  assert.equal(run('prompt', dir, 'claude-code', input).out, '', 'given once a session');
  assert.equal(run('prompt', dir, 'codex', { ...codex.prompt('s9'), prompt: 'Something unrelated entirely' }).out, '');
});

test('prompt answers with nothing when nothing matches, without waiting long for standard input', async () => {
  const dir = await fresh();
  for (const [agent, shape] of shapes) {
    const { status, out } = run('prompt', dir, agent, shape.prompt('s1'));
    assert.equal(status, 0);
    assert.equal(out, '');
  }
  // stdin left open: prompt still exits at once.
  const started = performance.now();
  const child = spawn('node', [cli, 'hook', 'prompt', dir, '--agent', 'codex'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const status = await new Promise(resolve => child.on('exit', resolve));
  child.stdin.destroy();
  assert.equal(status, 0);
  assert.ok(performance.now() - started < 1000, 'did not wait for stdin to close');
});

test('a client that closes the pipe early sees no error', async () => {
  const dir = await fresh();
  const child = spawn('node', [cli, 'hook', 'session-start', dir, '--agent', 'claude-code'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.destroy();
  let err = '';
  child.stderr.on('data', chunk => { err += chunk; });
  child.stdin.end(JSON.stringify(claude['session-start']('s1')));
  const status = await new Promise(resolve => child.on('exit', resolve));
  assert.equal(status, 0);
  assert.equal(err, '');
});

test('a broken cortex folder makes every moment exit 0 with no output', async () => {
  const base = await mkdtemp(join(tmpdir(), 'cortex-'));
  const notCortex = join(base, 'plain');
  await initCortex(notCortex, template);
  await rm(join(notCortex, 'agents'), { recursive: true });
  const aFile = join(base, 'file');
  await writeFile(aFile, 'not a folder');
  const good = await fresh();
  const cases = [[join(base, 'missing'), null], [aFile, null], [notCortex, null], [good, 'not json'], [good, '[1, 2]']];
  for (const [dir, raw] of cases) {
    for (const [agent, shape] of shapes) {
      for (const moment of ['session-start', 'prompt', 'stop', 'session-end']) {
        const { status, out, err } = run(moment, dir, agent, raw ?? shape[moment]('s1'));
        assert.equal(status, 0, `${moment} on ${dir}: ${err}`);
        assert.equal(out, '', `${moment} on ${dir}`);
      }
    }
  }
  assert.equal(run('nonsense', good, 'codex', '{}').out, '');
});

test('no moment takes longer than 200 ms on a cortex with 300 observations', async () => {
  const dir = await fresh();
  const cortex = openCortex(dir, { actor: 'member' });
  for (let n = 0; n < 300; n++) await cortex.observe({ id: `seen-${n}`, text: `Something learned about how Sam works, ${n}.`, pin: n < 3 });
  for (const moment of ['session-start', 'prompt', 'stop', 'session-end']) {
    const { status, ms } = run(moment, dir, 'claude-code', claude[moment]('s1'));
    assert.equal(status, 0);
    assert.ok(ms < 200, `${moment} took ${Math.round(ms)} ms`);
  }
});

test('install-hooks prints the snippet for each client and writes nothing, and the session log merges cleanly', async () => {
  const claudeSnippet = spawnSync('node', [cli, 'install-hooks', 'claude-code'], { encoding: 'utf8' });
  assert.equal(claudeSnippet.status, 0);
  const { hooks } = JSON.parse(claudeSnippet.stdout);
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']);
  assert.equal(hooks.Stop[0].hooks[0].command, 'cortex hook stop --agent claude-code');
  const codexSnippet = spawnSync('node', [cli, 'install-hooks', 'codex'], { encoding: 'utf8' });
  assert.equal(codexSnippet.status, 0);
  for (const [event, moment] of [['SessionStart', 'session-start'], ['UserPromptSubmit', 'prompt'], ['Stop', 'stop'], ['SessionEnd', 'session-end']]) {
    assert.ok(codexSnippet.stdout.includes(`[[hooks.${event}.hooks]]\ntype = "command"\ncommand = "cortex hook ${moment} --agent codex"`), event);
  }
  assert.equal(spawnSync('node', [cli, 'install-hooks', 'emacs'], { encoding: 'utf8' }).status, 1);
  assert.match(await readFile(join(await fresh(), '.gitattributes'), 'utf8'), /^\.cortex\/sessions\.jsonl merge=union$/m);
});
