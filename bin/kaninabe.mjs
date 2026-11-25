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
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const KANINABE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

commands: ${Object.keys(COMMANDS).join(', ')}

--root  directory that holds product.md. Without it, the nearest directory above the
        current one that holds product.md and is not kaninabe itself; when only kaninabe
        itself has one (developing kaninabe), that one.`;

/**
 * Picks the product root: an explicit `--root`, else the nearest ancestor holding product.md that is not
 * kaninabe's own root, else kaninabe's own root (kaninabe developed on its own).
 *
 * @param {readonly string[]} args command-line arguments after the command
 * @param {string} cwd directory the command was typed in
 * @returns {{ok: true, root: string, rest: string[]} | {ok: false, message: string}}
 */
export function resolveRoot(args, cwd, kaninabeRoot = KANINABE_ROOT) {
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
    const root = path.resolve(cwd, explicit);
    if (!existsSync(path.join(root, PRODUCT_DECL))) return { ok: false, message: `no ${PRODUCT_DECL} in ${root}` };
    return { ok: true, root, rest };
  }
  let own = false;
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, PRODUCT_DECL))) {
      if (dir !== kaninabeRoot) return { ok: true, root: dir, rest };
      own = true;
    }
    if (path.dirname(dir) === dir) break;
  }
  if (own) return { ok: true, root: kaninabeRoot, rest };
  return { ok: false, message: `no ${PRODUCT_DECL} found above ${path.resolve(cwd)}; pass --root` };
}

/** Runs one node script, inheriting the terminal; returns its exit status. */
function runNode(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env: process.env });
  return result.status ?? 1;
}

function main(argv) {
  const [command, ...args] = argv;
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
  return runNode([tsx, path.join(LEGACY, 'cli', entry.cli), '--root', resolved.root, ...resolved.rest], LEGACY);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
