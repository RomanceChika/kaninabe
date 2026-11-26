#!/usr/bin/env node
/**
 * Import fence: who may import whom (docs: arch end-state §2.2, the rows that exist in this tree today).
 * Reads import / export-from / dynamic import / require specifiers from the TypeScript syntax tree; names in
 * comments and strings that are not import specifiers never count. Exit 1 lists every violation as
 * `file:line  rule  specifier`.
 *
 * Rules:
 *   bin          imports only `node:` built-ins (it reaches legacy by path, as a child process)
 *   legacy       never imports bin/, framework/v2, or a product tree
 *   framework    non-test code never imports legacy/, scripts/, tests/, formal/, samples/, bin/ or @kaninabe/spec-tools
 *   runtime      imports no other kaninabe package; adapters import only @kaninabe/runtime (supabase-session
 *                also @kaninabe/adapter-postgrest); lint-config imports no kaninabe package.
 *                Tool configs (eslint.config.mjs) may name @kaninabe/lint-config.
 *   tests        import node: built-ins, bin/ or scripts/ (they test those) and their own helpers under tests/
 *   scripts      import `node:` built-ins and `typescript` (the parser this gate needs) only
 *
 * The one dependency of this file, `typescript`, is a deliberate exception to "gate code uses node: only".
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The tree being checked (the repository by default; tests point it at a temp tree). */
let treeRoot = ROOT;
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.next', 'tmp', '.git']);
const TEST_PATH = /(?:^|\/)(?:__tests__|tests)\/|\.test\.[cm]?[jt]sx?$/;

/** Every code file under `dir` (repo-relative, forward slashes). */
export function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE.test(name)) out.push(path.relative(treeRoot, full).split(path.sep).join('/'));
  }
  return out;
}

/** Import specifiers of one source text: [{ specifier, line }]. */
export function specifiersOf(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const add = (node, literal) => {
    if (literal !== undefined && ts.isStringLiteralLike(literal)) {
      found.push({ specifier: literal.text, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) add(node, node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node, node.moduleReference.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node, node.argument.literal);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isResolve = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'require' && callee.name.text === 'resolve';
      const isCreateRequire = ts.isIdentifier(callee) && callee.text === 'createRequire';
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (isCreateRequire) found.push({ specifier: null, line });
      else if (callee.kind === ts.SyntaxKind.ImportKeyword || isRequire || isResolve) {
        const arg = node.arguments[0];
        if (arg !== undefined && ts.isStringLiteralLike(arg)) add(node, arg);
        else found.push({ specifier: null, line });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Repo-relative target of a relative specifier, or null when the specifier is a package / built-in. */
function resolveRelative(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
}

const FORBIDDEN_FROM_FRAMEWORK = ['legacy/', 'scripts/', 'tests/', 'formal/', 'samples/', 'bin/'];
/**
 * Files that load a module by a computed name, each for a reason that cannot name a repository path:
 * they resolve installed package names or framework-internal Next.js modules, never a path inside this repo.
 */
const COMPUTED_SPECIFIER_ALLOWED = new Map([
  ['framework/runtime/scripts/build-offline.mjs', 'resolves an installed package name'],
  ['framework/runtime/scripts/check-exports.mjs', 'loads the package entries it checks'],
  ['framework/runtime/testing/http/paid-gate.mts', 'loads Next.js internal modules by name'],
]);
const KANINABE_PACKAGE = /^@kaninabe\/([^/]+)/;

/** Rule violations of one file: [{ rule, specifier, line }]. */
export function violationsOf(file, specifiers) {
  const out = [];
  const flag = (rule, { specifier, line }) => out.push({ rule, specifier, line });
  const production = file.startsWith('framework/') && !TEST_PATH.test(file);
  for (const entry of specifiers) {
    const { specifier } = entry;
    if (specifier === null) {
      if (COMPUTED_SPECIFIER_ALLOWED.has(file)) continue;
      if (production || /^(?:bin|scripts|tests)\//.test(file)) flag('the specifier must be a string literal (no computed import, createRequire)', { ...entry, specifier: '(not a literal)' });
      continue;
    }
    const target = resolveRelative(file, specifier);
    const isBuiltin = specifier.startsWith('node:');
    if (file.startsWith('bin/') && !isBuiltin) flag('bin imports node: built-ins only', entry);
    if (file.startsWith('tests/') && !isBuiltin && !(target !== null && /^(?:bin|scripts|tests)\//.test(target))) flag('tests import node: built-ins, bin/, scripts/ and tests/ only', entry);
    if (file.startsWith('scripts/') && !isBuiltin && specifier !== 'typescript') flag('scripts import node: built-ins and typescript only', entry);
    if ((file.startsWith('legacy/') || production) && target !== null && target.startsWith('..')) flag('never imports outside the repository (a product tree)', entry);
    if (file.startsWith('legacy/')) {
      if (/^@kaninabe\/v2(?:\/|$)/.test(specifier)) flag('legacy never imports bin/ or framework/v2', entry);
      const names = target ?? specifier;
      if (/^(?:bin\/|framework\/v2(?:\/|$))/.test(names) || /(?:^|\/)framework\/v2(?:\/|$)/.test(names) || /(?:^|\/)bin\/kaninabe/.test(names)) {
        flag('legacy never imports bin/ or framework/v2', entry);
      }
    }
    if (production) {
      if (target !== null && FORBIDDEN_FROM_FRAMEWORK.some((dir) => target.startsWith(dir))) flag('framework code never names legacy/, scripts/, tests/, formal/, samples/, bin/', entry);
      if (specifier.startsWith('@kaninabe/spec-tools')) flag('framework code never imports the verifier/generator', entry);
      const pkg = KANINABE_PACKAGE.exec(specifier)?.[1];
      if (pkg !== undefined && !/(?:^|\/)eslint\.config\.mjs$/.test(file)) {
        if (file.startsWith('framework/runtime/') && pkg !== 'runtime') flag('runtime imports no other kaninabe package', entry);
        if (file.startsWith('framework/adapters/') && pkg !== 'runtime' && !(file.startsWith('framework/adapters/supabase-session/') && pkg === 'adapter-postgrest')) flag('adapters import only @kaninabe/runtime', entry);
        if (file.startsWith('framework/lint-config/')) flag('lint-config imports no kaninabe package', entry);
      }
    }
  }
  return out;
}

/** Check the whole tree; returns printable violation lines. */
export function checkTree(root = ROOT) {
  treeRoot = root;
  const lines = [];
  for (const dir of ['bin', 'scripts', 'tests', 'legacy', 'framework']) {
    for (const file of walk(path.join(root, dir))) {
      if (file.startsWith('legacy/spec-tools/__tests__/fixtures/')) continue;
      const text = readFileSync(path.join(root, file), 'utf8');
      for (const v of violationsOf(file, specifiersOf(file, text))) lines.push(`${file}:${v.line}  ${v.rule}  ${v.specifier}`);
    }
  }
  if (walk(path.join(root, 'framework')).length === 0 && walk(path.join(root, 'legacy')).length === 0) lines.push('(nothing scanned: no code files under framework/ or legacy/)');
  treeRoot = ROOT;
  return lines;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = checkTree();
  if (lines.length > 0) {
    console.error(`import fence: ${lines.length} violation(s)\n${lines.join('\n')}`);
    process.exit(1);
  }
  console.log('import fence: ok');
}
