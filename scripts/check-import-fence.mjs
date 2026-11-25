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
 *   tests        import node: built-ins and bin/ or scripts/ only (they test those)
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
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.next', 'tmp', '.git']);
const TEST_PATH = /(?:^|\/)(?:__tests__|tests|fixtures)\/|\.test\.[cm]?[jt]sx?$/;

/** Every code file under `dir` (repo-relative, forward slashes). */
export function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else if (CODE.test(name)) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
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
      if ((callee.kind === ts.SyntaxKind.ImportKeyword || isRequire) && node.arguments.length > 0) add(node, node.arguments[0]);
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
const KANINABE_PACKAGE = /^@kaninabe\/([^/]+)/;

/** Rule violations of one file: [{ rule, specifier, line }]. */
export function violationsOf(file, specifiers) {
  const out = [];
  const flag = (rule, { specifier, line }) => out.push({ rule, specifier, line });
  for (const entry of specifiers) {
    const { specifier } = entry;
    const target = resolveRelative(file, specifier);
    const isBuiltin = specifier.startsWith('node:');
    if (file.startsWith('bin/') && !isBuiltin) flag('bin imports node: built-ins only', entry);
    if (file.startsWith('tests/') && !isBuiltin && !(target !== null && /^(?:bin|scripts)\//.test(target))) flag('tests import node: built-ins and bin/ or scripts/ only', entry);
    if (file.startsWith('scripts/') && !isBuiltin && specifier !== 'typescript') flag('scripts import node: built-ins and typescript only', entry);
    if (file.startsWith('legacy/')) {
      const names = target ?? specifier;
      if (/^(?:bin\/|framework\/v2(?:\/|$))/.test(names) || /(?:^|\/)framework\/v2(?:\/|$)/.test(names) || /(?:^|\/)bin\/kaninabe/.test(names)) {
        flag('legacy never imports bin/ or framework/v2', entry);
      }
    }
    if (file.startsWith('framework/') && !TEST_PATH.test(file)) {
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
export function checkTree() {
  const lines = [];
  for (const dir of ['bin', 'scripts', 'tests', 'legacy', 'framework']) {
    for (const file of walk(path.join(ROOT, dir))) {
      if (file.startsWith('legacy/spec-tools/__tests__/fixtures/')) continue;
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      for (const v of violationsOf(file, specifiersOf(file, text))) lines.push(`${file}:${v.line}  ${v.rule}  ${v.specifier}`);
    }
  }
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
