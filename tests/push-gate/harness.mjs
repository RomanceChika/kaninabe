/**
 * The one shared harness of the tests that run the REAL gate with the REAL gitleaks and actionlint (push-gate-verdict, scanner-keys,
 * scanner-readable). Not a test file (the runner picks up *.test.mjs only). The import fence lets a test import this one module.
 *
 * `harness({ get, set })` is called once at the top of a test file: it registers the beforeEach / afterEach of the file (a throwaway
 * repository, a PATH that holds only the tools the gate may use, and a COPY of the scripts directory whose scan-exclusions.tsv is
 * empty, so that no test depends on the repository's own list; setList writes the list a test needs into the copy). The paths live in
 * variables of the TEST FILE (`dir`, `repo`, `bin`, `gate`, `gscripts`), because some tests move into another repository by assigning
 * `repo`; `get` returns them and `set` stores the ones the setup makes.
 *
 * Fake keys and addresses are assembled at run time and written only into throwaway repositories.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const realGate = fileURLToPath(new URL('../../scripts/push-gate.sh', import.meta.url));
export const realScripts = path.dirname(realGate);
export const CORE = [
  'sh', 'git', 'grep', 'sed', 'cut', 'wc', 'tr', 'head', 'tail', 'mktemp', 'rm', 'cat', 'dirname', 'basename', 'tar',
  'awk', 'sort', 'uniq', 'mkdir', 'ls', 'find', 'env', 'true', 'false', 'cp', 'mv', 'date', 'less', 'sha256sum',
];
export const find = (name, searchPath) => {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8', env: { PATH: searchPath } });
  const p = r.stdout.trim();
  return r.status === 0 && p.startsWith('/') ? p : null;
};
export const SYSTEM = '/usr/bin:/bin:/usr/local/bin';
export const real = {
  gitleaks: find('gitleaks', process.env.PATH ?? ''),
  actionlint: find('actionlint', process.env.PATH ?? ''),
};
export const missing = Object.entries(real).filter(([, p]) => !p).map(([n]) => n);
export const reason = `${missing.join(' and ')} not installed: run "sh scripts/setup-dev-env.sh --bin-dir <dir on PATH>" first`;
/** A fake key built from pieces; every call gives a new one. */
export const fakeKey = () => ['gh', 'p_'].join('') + randomBytes(60).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 36).padEnd(36, 'x');

export const tab = (...f) => `${f.join('\t')}\n`;
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const blobId = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
export const patchesOf = (r) => Number(/\((\d+) finding\(s\) in patches/.exec(r.out)?.[1] ?? NaN);
export const treeOf = (r) => Number(/(\d+) in the tree of HEAD\)/.exec(r.out)?.[1] ?? NaN);
export const rangeUnr = (r) => Number(/unreadable file\(s\): (\d+)/.exec(r.out)?.[1] ?? 0);
export const treeUnr = (r) => Number(/unreadable file\(s\) in the tree of HEAD: (\d+)/.exec(r.out)?.[1] ?? 0);
export const MAILMSG = 'email-like string: pull request title or body';

export function harness({ get, set }) {
  // (the paths are read at each call, from the variables of the test file)
  const state = new Proxy({}, { get: (_, k) => get()[k] });
  const env = (extra = {}) => ({
    PATH: state.bin, HOME: path.join(state.dir, 'home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', ...extra,
  });
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=Tester', '-c', 'user.email=tester@users.noreply.github.com', '-c', 'commit.gpgsign=false', ...args],
      { cwd: state.repo, encoding: 'utf8', env: { ...process.env, ...env(), PATH: process.env.PATH } });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (files, message = 'change') => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(state.repo, name)), { recursive: true });
      writeFileSync(path.join(state.repo, name), text);
      git('add', name);
    }
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const gateRun = (args, extra = {}) => {
    const r = spawnSync('/bin/sh', [state.gate, ...args], { cwd: state.repo, encoding: 'utf8', env: env(extra) });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const general = (...range) => gateRun(['--mode', 'general', ...(range.length ? range : ['--all'])]);
  const setList = (list) => {
    const f = path.join(state.gscripts, 'scan-exclusions.tsv');
    if (list === null) rmSync(f, { force: true });
    else writeFileSync(f, list);
  };
  /** The gate (from the copy of the scripts) with `list` as its exclusion list. */
  const gateWith = (list, args = ['--mode', 'general', '--all'], extra = {}) => { setList(list); return gateRun(args, extra); };
  /** scan-public.sh of the copy, over every commit (or the given arguments). Faster than the gate: no gitleaks. */
  const scanPublic = (args = [], list = '') => {
    setList(list);
    const r = spawnSync('/bin/sh', [path.join(state.gscripts, 'scan-public.sh'), ...args], { cwd: state.repo, encoding: 'utf8', env: env(), timeout: 30000 });
    assert.ok(r.error === undefined, `did not finish within 30 s: ${r.error?.message}`);
    return { status: r.status, out: r.stdout + r.stderr };
  };
  /** Like commit(), but the content is bytes (a Buffer) or text. */
  const commitRaw = (files, message = 'change') => {
    for (const [name, data] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(state.repo, name)), { recursive: true });
      writeFileSync(path.join(state.repo, name), data);
      git('add', '--', name);
    }
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  /** Commits files whose names are given as Buffers (bytes that a string cannot carry). */
  const commitNamed = (named, message = 'change') => {
    for (const [name, data] of named) writeFileSync(Buffer.concat([Buffer.from(`${state.repo}/`), Buffer.isBuffer(name) ? name : Buffer.from(name)]), data);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const scanPrText = (text, extra = {}) => {
    const f = path.join(state.dir, 'pr-text');
    writeFileSync(f, text);
    const r = spawnSync('/bin/sh', [path.join(state.gscripts, 'scan-pr-text.sh'), f], { cwd: state.repo, encoding: 'utf8', env: env(extra) });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const WORDS = () => { const f = path.join(state.dir, 'words.txt'); writeFileSync(f, 'zzgatewordzz\n'); return f; };

  beforeEach(() => {
    if (missing.length) throw new Error(reason);
    const dir = mkdtempSync(path.join(tmpdir(), 'push-gate-real-'));
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    for (const n of CORE) { const p = find(n, SYSTEM); if (p) symlinkSync(p, path.join(bin, n)); }
    for (const [n, p] of Object.entries(real)) symlinkSync(p, path.join(bin, n));
    const repo = path.join(dir, 'repo');
    mkdirSync(repo);
    const gscripts = path.join(dir, 'gate-scripts');
    cpSync(realScripts, gscripts, { recursive: true });
    writeFileSync(path.join(gscripts, 'scan-exclusions.tsv'), '');
    set({ dir, bin, repo, gscripts, gate: path.join(gscripts, 'push-gate.sh') });
    git('init', '-q', '-b', 'main');
  });
  afterEach(() => rmSync(state.dir, { recursive: true, force: true }));

  return { env, git, commit, gateRun, general, setList, gateWith, scanPublic, commitRaw, commitNamed, scanPrText, WORDS };
}
