#!/usr/bin/env node
/**
 * The one command-line entry of kaninabe: `kaninabe <command> [options]`.
 *
 * A product mounts kaninabe as a folder (`kaninabe/`) and runs `node kaninabe/bin/kaninabe.mjs <command>`.
 * This file always decides the product root itself and passes it explicitly (`--root`), so a copy of kaninabe
 * that carries its own `product.md` can never be mistaken for the product. Which implementation serves a command
 * is decided here and nowhere else; today every command is served by `legacy/spec-tools`.
 *
 * Imports: `node:` built-ins only (see scripts/check-import-fence.mjs).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SELF = realpathSync(fileURLToPath(import.meta.url));
const KANINABE_ROOT = path.resolve(path.dirname(SELF), '..');
const LEGACY = path.join(KANINABE_ROOT, 'legacy', 'spec-tools');
const RUNTIME_SCRIPTS = path.join(KANINABE_ROOT, 'framework', 'runtime', 'scripts');
const PRODUCT_DECL = 'product.md';

/** command name -> the CLI file that serves it, and whether it needs the built runtime to be fresh. */
export const COMMANDS = {
  verify: { cli: 'verify-docs.ts', fresh: true },
  generate: { cli: 'generate-docs.ts', fresh: true },
  book: { cli: 'generate-book.ts', fresh: false },
  'spec:diff': { cli: 'spec-diff.ts', fresh: false },
  'check:migrations': { cli: 'check-migrations.ts', fresh: false },
  'check:formal': { cli: 'check-formal.ts', fresh: false },
  'samples:db': { cli: 'samples-db.ts', fresh: true },
};

const USAGE = `usage: kaninabe <command> [--root <product-root>] [command options]
       kaninabe setup

commands: setup, ${Object.keys(COMMANDS).join(', ')}

setup   takes no options. It installs from the lockfiles (npm ci in the kaninabe folder and in its
        legacy/spec-tools); run it once after the folder is mounted and again after the pin moves

--root  directory that holds product.md. Without it, the nearest directory above the
        current one that holds product.md and is not kaninabe itself; when only kaninabe
        itself has one (developing kaninabe), that one.`;

/** Real path when the directory exists (symlinks and case folded the same way for every comparison). */
function real(dir) {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * Picks the product root: an explicit `--root`, else the nearest ancestor holding product.md that is not
 * kaninabe's own root, else kaninabe's own root (kaninabe developed on its own).
 *
 * @param {readonly string[]} args command-line arguments after the command
 * @param {string} cwd directory the command was typed in
 * @returns {{ok: true, root: string, rest: string[]} | {ok: false, message: string}}
 */
export function resolveRoot(args, cwd, kaninabeRoot = KANINABE_ROOT) {
  const kaninabe = real(kaninabeRoot);
  const rest = [];
  let explicit;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--root') {
      explicit = args[i + 1];
      if (explicit === undefined || explicit.startsWith('--')) return { ok: false, message: '--root needs a path' };
      i += 1;
    } else if (arg.startsWith('--root=')) {
      explicit = arg.slice('--root='.length);
      if (explicit === '') return { ok: false, message: '--root needs a path' };
    } else {
      rest.push(arg);
    }
  }
  if (explicit !== undefined) {
    const root = real(path.resolve(cwd, explicit));
    if (!existsSync(path.join(root, PRODUCT_DECL))) return { ok: false, message: `no ${PRODUCT_DECL} in ${root}` };
    return { ok: true, root, rest };
  }
  let own = false;
  for (let dir = real(path.resolve(cwd)); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, PRODUCT_DECL))) {
      if (dir !== kaninabe) return { ok: true, root: dir, rest };
      own = true;
    }
    if (path.dirname(dir) === dir) break;
  }
  if (own) return { ok: true, root: kaninabe, rest };
  return { ok: false, message: `no ${PRODUCT_DECL} found above ${path.resolve(cwd)}; pass --root` };
}

/**
 * Makes positional arguments absolute against the directory the command was typed in (the legacy CLI would
 * otherwise resolve them against its own folder), and refuses a path whose nearest product.md is not the root
 * (the legacy verifier searches upward from a given path and ignores --root).
 */
export function absolutePaths(rest, cwd, root) {
  const out = [];
  for (const arg of rest) {
    if (arg.startsWith('--')) {
      out.push(arg);
      continue;
    }
    const abs = real(path.resolve(cwd, arg));
    let nearest = abs;
    while (!existsSync(path.join(nearest, PRODUCT_DECL)) && path.dirname(nearest) !== nearest) nearest = path.dirname(nearest);
    if (nearest !== root) return { ok: false, message: `${arg} is not inside the product root ${root}` };
    out.push(abs);
  }
  return { ok: true, rest: out };
}

/** Runs one node script, inheriting the terminal; returns its exit status. */
function runNode(args, cwd, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env });
  if (result.error !== undefined) console.error(`kaninabe: ${result.error.message}`);
  return result.status ?? 1;
}

/** The two lockfile installs `setup` runs: [directory relative to kaninabe's root, npm arguments]. */
export const SETUP_STEPS = [
  ['.', ['ci']],
  ['legacy/spec-tools', ['ci']],
];

/** The environment an install needs: the caller's, minus settings an outer npm or a production shell would inject. */
function installEnv(env = process.env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (/^npm_(?:lifecycle|package)_/i.test(key) || /^npm_config_(?:omit|production|only|include|ignore_scripts|prefix|workspace|workspaces)$/i.test(key) || key === 'NODE_ENV' || key === 'INIT_CWD') delete clean[key];
  }
  return clean;
}

/**
 * How to start npm: node on npm's own script when it can be found (no shell, works on Windows), else `npm` itself
 * (through the shell on Windows, where `npm.cmd` cannot be started directly).
 */
export function npmCommand(env = process.env, platform = process.platform) {
  const script = env.npm_execpath;
  if (script !== undefined && /npm-cli\.[cm]?js$/.test(script) && existsSync(script)) return { command: process.execPath, prefix: [script], shell: false };
  return { command: platform === 'win32' ? 'npm.cmd' : 'npm', prefix: [], shell: platform === 'win32' };
}

/** Runs `npm ci` in kaninabe's root and in the legacy tool folder; returns the first failing status or 0. */
function setup(args) {
  if (args.length > 0) {
    if (args.includes('--help') || args.includes('-h')) {
      console.log(USAGE);
      return 0;
    }
    console.error(`kaninabe setup: takes no arguments (got ${args.join(' ')}); it runs \`npm ci\` in the kaninabe folder and in legacy/spec-tools`);
    return 1;
  }
  const npm = npmCommand();
  const env = installEnv();
  for (const [dir, npmArgs] of SETUP_STEPS) {
    const result = npm.shell
      ? spawnSync(`${npm.command} ${npmArgs.join(' ')}`, { cwd: path.join(KANINABE_ROOT, dir), stdio: 'inherit', env, shell: true })
      : spawnSync(npm.command, [...npm.prefix, ...npmArgs], { cwd: path.join(KANINABE_ROOT, dir), stdio: 'inherit', env });
    if (result.error !== undefined) console.error(`kaninabe setup: ${result.error.message}`);
    if (result.signal) console.error(`kaninabe setup: npm was stopped by ${result.signal}`);
    if ((result.status ?? 1) !== 0) return result.status ?? 1;
  }
  return 0;
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'setup') return setup(args);
  if (command === undefined || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command === undefined ? 1 : 0;
  }
  const entry = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (entry === undefined) {
    console.error(`kaninabe: unknown command '${command}'\n${USAGE}`);
    return 1;
  }
  const resolved = resolveRoot(args, process.cwd());
  if (!resolved.ok) {
    console.error(`kaninabe ${command}: ${resolved.message}`);
    return 1;
  }
  const checks = ['check-node.mjs', ...(entry.fresh ? ['check-dist-fresh.mjs'] : [])];
  for (const check of checks) {
    const status = runNode([path.join(RUNTIME_SCRIPTS, check)], KANINABE_ROOT);
    if (status !== 0) return status;
  }
  const tsx = path.join(LEGACY, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(tsx)) {
    console.error('kaninabe: tools not installed; run `npm --prefix legacy/spec-tools ci` in the kaninabe folder');
    return 1;
  }
  const here = process.cwd();
  // Only `verify` takes a path (a spec folder). Other commands have options with values (`--port 3000`), which must pass through untouched;
  // they resolve relative arguments from INIT_CWD, which is set below to the directory the command was typed in.
  const paths = command === 'verify' ? absolutePaths(resolved.rest, here, resolved.root) : { ok: true, rest: resolved.rest };
  if (!paths.ok) {
    console.error(`kaninabe ${command}: ${paths.message}`);
    return 1;
  }
  const env = { ...process.env, INIT_CWD: here };
  return runNode([tsx, path.join(LEGACY, 'cli', entry.cli), '--root', resolved.root, ...paths.rest], LEGACY, env);
}

if (process.argv[1] !== undefined && real(path.resolve(process.argv[1])) === SELF) {
  process.exit(main(process.argv.slice(2)));
}
