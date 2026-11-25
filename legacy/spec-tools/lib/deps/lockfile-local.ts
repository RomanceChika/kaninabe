/**
 * lockfile の**手元の置き場**(`link: true` のリンク先・`resolved: file:…` の取得元)として宣言されたものを集める(4 回目 C4-4)。
 *
 * `npm ci` は lockfile の `link: true` をそのままシンボリックリンクにし(リンク先の install script も走る)、`file:` を手元のパスから入れる。
 * どちらも登録簿の固定(`resolved` + `integrity`)の外なので、**隣の `package.json` が宣言した置き場だけ**を許す:
 *
 *   - `workspaces` の置き場(文字どおりのパスと、末尾が `/*` の 1 段の形。そこの `package.json` の `name` が指してよい名前)
 *   - 根と各 workspace の `dependencies` / `devDependencies` / `optionalDependencies` / `peerDependencies` の `file:` 依存
 *     (宣言した側の場所からの相対を lockfile のある場所からの相対に直す。依存の名前が指してよい名前)
 *
 * それ以外の形の `workspaces`(`**` など)は展開しない(そこへのリンクは赤になる = fail-closed)。純粋で、読み取りの口を引数で受ける。
 */

import type { LocalDeclarations } from './lockfile-pins.js';
import { normalizeLocalPath } from './lockfile-pins.js';

/** 読み取りの口(lockfile の根からではなく、製品の根からの相対)。 */
export interface LocalDeclarationsFs {
  readonly readText: (rel: string) => string | null;
  readonly list: (rel: string) => readonly string[];
}

/** 依存を宣言する欄。 */
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

interface Manifest {
  readonly name?: unknown;
  readonly workspaces?: unknown;
  readonly [field: string]: unknown;
}

function joinRel(dir: string, rel: string): string {
  return dir === '' ? rel : `${dir}/${rel}`;
}

function readManifest(fs: LocalDeclarationsFs, rel: string): Manifest | null {
  const text = fs.readText(rel);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Manifest) : null;
  } catch {
    return null;
  }
}

/** `workspaces`(配列か `{ packages: [...] }`)の文字列だけ。 */
function workspacePatterns(manifest: Manifest): string[] {
  const raw = manifest.workspaces;
  const list = Array.isArray(raw) ? raw : typeof raw === 'object' && raw !== null && Array.isArray((raw as { packages?: unknown }).packages) ? (raw as { packages: unknown[] }).packages : [];
  return list.filter((item): item is string => typeof item === 'string');
}

/** 置き場の型を展開する(文字どおり / 末尾の `/*` 1 段だけ)。lockfile のある場所からの相対の正規形。 */
function expandWorkspace(fs: LocalDeclarationsFs, root: string, pattern: string): string[] {
  if (!pattern.includes('*')) return [normalizeLocalPath(pattern)];
  const parent = pattern.slice(0, -2);
  if (!pattern.endsWith('/*') || parent.includes('*')) return [];
  return fs.list(joinRel(root, normalizeLocalPath(parent))).map((child) => normalizeLocalPath(`${parent}/${child}`));
}

/** `file:` 依存を、宣言した場所(`base`。lockfile のある場所からの相対)から正規形の置き場に直して足す。 */
function addFileDependencies(targets: Map<string, Set<string>>, manifest: Manifest, base: string): void {
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec !== 'string' || !spec.startsWith('file:')) continue;
      add(targets, normalizeLocalPath(joinRel(base, spec.slice('file:'.length))), name);
    }
  }
}

function add(targets: Map<string, Set<string>>, target: string, name: string): void {
  const names = targets.get(target) ?? new Set<string>();
  names.add(name);
  targets.set(target, names);
}

/**
 * lockfile の隣の `package.json` から、宣言した手元の置き場を集める(読めなければ空 = どのリンク・`file:` も赤)。
 *
 * @param fs 読み取りの口(製品の根からの相対)
 * @param lockfile lockfile のパス(製品の根からの相対)
 */
export function declaredLocalTargets(fs: LocalDeclarationsFs, lockfile: string): LocalDeclarations {
  const root = lockfile.includes('/') ? lockfile.slice(0, lockfile.lastIndexOf('/')) : '';
  const targets = new Map<string, Set<string>>();
  const manifest = readManifest(fs, joinRel(root, 'package.json'));
  if (manifest === null) return { targets };
  addFileDependencies(targets, manifest, '');
  for (const pattern of workspacePatterns(manifest)) {
    for (const place of expandWorkspace(fs, root, pattern)) {
      const member = readManifest(fs, joinRel(root, joinRel(place, 'package.json')));
      if (member === null) continue;
      if (typeof member.name === 'string') add(targets, place, member.name);
      addFileDependencies(targets, member, place);
    }
  }
  return { targets };
}
