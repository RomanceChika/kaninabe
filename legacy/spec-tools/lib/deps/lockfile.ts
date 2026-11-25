/**
 * lockfile の読み取りと、製品の中の lockfile の発見(製品の名前を知らない: 配置から決める)。
 */

import { createHash } from 'node:crypto';
import { isOfficialRegistryUrl, lockfileShapeProblem, nameFromLockKey, registryTarballIdentity } from './lockfile-pins.js';
import { FOREIGN_LOCKFILE_NAMES, isForeignLockfileName } from './npm-lock-rules.js';
import type { LockedPackage } from './types.js';

/** 歩かないディレクトリ名(依存・生成物・作業置き場・テストの題材)。 */
const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', 'tmp', 'dist', 'coverage', '__tests__', 'fixtures', '.next', 'build']);

/** 発見の深さの上限(ルートが 0)。 */
const MAX_DEPTH = 4;

/** 発見に使う口(ルート相対)。 */
export interface DiscoverFs {
  readonly list: (rel: string) => readonly string[];
  readonly isDirectory: (rel: string) => boolean;
  readonly isFile: (rel: string) => boolean;
}

/**
 * `package-lock.json` を持ち、同じ場所に `package.json` もある場所を集める(ルート相対の lockfile のパス・名前順)。
 * ワークスペースの内側(製品の実装の木など)は lockfile を持たないので当たらない。lockfile を持つ非ワークスペース(spec-tools・docs)は当たる。
 *
 * @param fs 読み取りの口
 */
export function discoverLockfiles(fs: DiscoverFs): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    const join = (name: string): string => (dir === '' ? name : `${dir}/${name}`);
    if (fs.isFile(join(ALLOWED_LOCKFILE)) && fs.isFile(join('package.json'))) found.push(join(ALLOWED_LOCKFILE));
    if (depth >= MAX_DEPTH) return;
    for (const name of [...fs.list(dir === '' ? '.' : dir)].sort()) {
      if (SKIP_DIRS.has(name)) continue;
      if (fs.isDirectory(join(name))) walk(join(name), depth + 1);
    }
  };
  walk('', 0);
  return found;
}

/** 許す lockfile の名前(npm の `package-lock.json` だけ)。 */
export const ALLOWED_LOCKFILE = 'package-lock.json';

/**
 * 依存の解決を固定するファイルとして道具が読む名前のうち、**許さないもの**(5 回目 C5-2。小文字)。
 * `npm-shrinkwrap.json` は同じ場所の `package-lock.json` より優先され(`npm ci` はそちらで入れる)、ほかは別の道具の lockfile。
 * どれも deps:check・dist:check が読まない形なので、置かれたら赤にする(`.gitignore` ではなく検査で拒む — 無視は `git add -f` で入る)。
 * 表の正は `npm-lock-rules.ts` の 1 か所(dist:check も同じ表を読む。6 回目 C6-7)。照合は `isForeignLockfileName`(大文字小文字を区別しない)。
 */
export const FOREIGN_LOCKFILES: ReadonlySet<string> = new Set(FOREIGN_LOCKFILE_NAMES);

/**
 * `package-lock.json` 以外の lockfile を集める(ルート相対・名前順。歩き方は `discoverLockfiles` と同じ。隣の `package.json` の有無は問わない)。
 *
 * @param fs 読み取りの口
 */
export function discoverForeignLockfiles(fs: DiscoverFs): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    const join = (name: string): string => (dir === '' ? name : `${dir}/${name}`);
    // 手元の一覧はドットで始まる名前を返さないので、その形の名前(`.npmrc` など。12 回目 C12-8)は名前で聞く。
    for (const name of FOREIGN_LOCKFILE_NAMES) if (name.startsWith('.') && fs.isFile(join(name))) found.push(join(name));
    for (const name of [...fs.list(dir === '' ? '.' : dir)].sort()) {
      if (!name.startsWith('.') && isForeignLockfileName(name) && fs.isFile(join(name))) found.push(join(name));
      if (depth >= MAX_DEPTH || SKIP_DIRS.has(name)) continue;
      if (fs.isDirectory(join(name))) walk(join(name), depth + 1);
    }
  };
  walk('', 0);
  return found;
}

/**
 * lockfile(v2 / v3)から (名前, 版) を集める(重複は 1 つ。link・ワークスペース自身・版の無いものは除く)。
 *
 * 登録簿から来るものの (名前, 版) は、**欄の自己申告ではなく `resolved` の tarball の URL から導く**(`npm ci` が実際に取るもの。
 * 欄と食い違えば `lockfile-pins` が赤にする — 4 回目 C4-5)。導けない(公式でない・形が違う)ものは欄の値で、登録簿から来ないものとして扱う。
 *
 * @param text lockfile の本文
 * @returns 集めたもの。読めなければ(JSON でない・v2 未満・`packages` 無し)null
 */
export function parseLockedPackages(text: string): LockedPackage[] | null {
  if (lockfileShapeProblem(text) !== null) return null;
  const packages = (JSON.parse(text) as { packages: Record<string, { version?: unknown; resolved?: unknown; integrity?: unknown; link?: unknown; name?: unknown }> }).packages;
  const seen = new Map<string, LockedPackage>();
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.includes('node_modules/') || typeof entry !== 'object' || entry === null || entry.link === true || typeof entry.version !== 'string') continue;
    const resolved = typeof entry.resolved === 'string' ? entry.resolved : '';
    const identity = isOfficialRegistryUrl(resolved) ? registryTarballIdentity(resolved) : null;
    const name = identity?.name ?? (typeof entry.name === 'string' ? entry.name : nameFromLockKey(key));
    const version = identity?.version ?? entry.version;
    seen.set(`${name}@${version}`, { name, version, fromRegistry: identity !== null, ...(typeof entry.integrity === 'string' ? { integrity: entry.integrity } : {}) });
  }
  return [...seen.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

/**
 * lockfile の中身の指紋(sha256 の 16 進)。検査の記録が「どの中身を確かめたか」を持つために使う(差分点検 A27-2)。
 *
 * @param text lockfile の本文
 */
export function lockfileDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
