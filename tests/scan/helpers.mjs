/**
 * Helpers for the tests of scripts/scan-public.sh and scripts/scan-pr-text.sh: a throwaway git repository, a runner for
 * each script with a clean environment, and builders for the strings the scans look for. The strings are built here
 * piece by piece, so that this file (which the scans read too, like every file in the repository) never holds an
 * email address, a local path or a word from a list in one piece.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const publicScript = fileURLToPath(new URL('../../scripts/scan-public.sh', import.meta.url));
export const textScript = fileURLToPath(new URL('../../scripts/scan-pr-text.sh', import.meta.url));

export const at = '@';
/** An email-like string `local@domain`, never written in one piece in a test. */
export const mail = (local, domain) => `${local}${at}${domain}`;
/** A home directory path of `user`, written so that no file of the repository holds it in one piece. */
export const home = (user, rest = '/x') => `/ho${'me'}/${user}${rest}`;
export const OWNER = 'ownerx';
export const ownerMail = (id = '') => mail(`${id}${OWNER}`, 'users.noreply.github.com');
export const WEB_FLOW = mail('noreply', 'github.com');
export const WORD = 'zorbify';

export const cleanEnv = (dir, extra = {}) => ({
  PATH: process.env.PATH,
  HOME: dir,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  ...extra,
});

/** Makes a temp directory; the caller removes it with `rmSync`. */
export const tempDir = () => mkdtempSync(path.join(tmpdir(), 'scan-test-'));

function git(dir, args, env = {}, input) {
  const r = spawnSync('git', args, { cwd: dir, env: { ...cleanEnv(dir), ...env }, encoding: 'utf8', input });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * Creates a repository from `commits`: each is `{ files, message, author: [name, email], committer: [name, email] }`
 * (a file value may be a string or a Buffer; `null` removes it). Returns the directory.
 */
export function makeRepo(commits) {
  const dir = tempDir();
  git(dir, ['init', '-q', '-b', 'main']);
  for (const c of commits) {
    for (const [file, content] of Object.entries(c.files ?? {})) {
      const p = path.join(dir, file);
      mkdirSync(path.dirname(p), { recursive: true });
      if (content === null) rmSync(p, { force: true });
      else writeFileSync(p, content);
    }
    const [an, ae] = c.author ?? ['Dev', ownerMail()];
    const [cn, ce] = c.committer ?? [an, ae];
    const msgFile = path.join(dir, '.msg');
    writeFileSync(msgFile, c.message ?? 'change');
    git(dir, ['add', '-A', '--', '.', ':!.msg']);
    git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-F', msgFile],
      { GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_COMMITTER_NAME: cn, GIT_COMMITTER_EMAIL: ce });
    rmSync(msgFile);
  }
  return dir;
}

export { git };

/** Writes a word list and returns its path. */
export function wordList(dir, content, name = 'words') {
  const p = path.join(dir, `${name}.list`);
  writeFileSync(p, content);
  return p;
}

/** Runs scan-public.sh in `cwd`; returns `{ status, out }`. */
export function runPublic(cwd, { args = [], env = {}, home: h } = {}) {
  const r = spawnSync('sh', [publicScript, ...args], { cwd, env: cleanEnv(h ?? cwd, env), encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}

/** Runs scan-pr-text.sh on `text` (a string or a Buffer); returns `{ status, out }`. */
export function runText(text, { args = [], env = {} } = {}) {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'text');
    writeFileSync(file, text);
    const r = spawnSync('sh', [textScript, ...args, file], { cwd: dir, env: cleanEnv(dir, env), encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
