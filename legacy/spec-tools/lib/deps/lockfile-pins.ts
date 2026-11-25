/**
 * lockfile の**配信元と固定**の検査(ASVS V15.1.2「信頼できる取得元からだけ取る」)。
 *
 * `npm ci` は lockfile の `resolved` の URL から tarball を取り、`integrity` で照合する。lockfile に公式の登録簿でない
 * `resolved` があれば取得元が差し替わり、`integrity` が無い・弱ければ中身の差し替えを検知できない。
 * 以前の `deps:check` はこれらを「待ちの検査から外す」だけで赤にしなかった(3 回目の点検 C-3)。製品は配布の道具
 * (`dist:check`)を受け取らないので、製品にとって lockfile の配信元の検査はここだけである。
 *
 * 規則(`node_modules/` の下の全エントリ。lockfile は **JSON として読む**: 字面の揺れ `https:\/\/…` で素通りしない):
 *   - lockfile そのものが JSON で、`lockfileVersion >= 2` で `packages` を持つ(v1・壊れた lockfile は `npm ci` が入れるのに
 *     検査が読めない = 赤。4 回目 C4-4。以前は「未実施」で緑だった)
 *   - 除外: `node_modules/` を含まないキー(workspace の置き場そのもの)と、**正しい同梱**(`inBundle: true` で、npm が依存の同梱と
 *     みなし — 親の `bundleDependencies` の**配列**にその名前がある・同梱された部品から依存される等、判定は `npm-lock-rules.ts` が npm の
 *     `getBundler` を写す — `resolved` も `integrity` も持たず、版が 1 点の版。同梱物は親の tarball から出るので取得元を持たない)。
 *     それ以外の `inBundle` は赤にし、通常のエントリとしても見る(`npm ci` は同梱でない `inBundle` を普通に取る。5 回目 C5-3・6 回目 C6-1)
 *   - `link: true`(シンボリックリンクで入る)と `resolved` が `file:` のもの(手元のパスから入る)は、**宣言した置き場**だけ
 *     (隣の `package.json` の `workspaces` と、そこ・各 workspace の `file:` 依存。`lockfile-local.ts` が集める)。
 *     それ以外の置き場を指すものは赤(4 回目 C4-4: リンク先の postinstall が走る・中身を差し替えられる)。
 *     宣言との照合の名前は**キーのパスから導く**(`npm ci` がリンクを張る場所。自己申告の `name` 欄ではない)。リンクの `name` 欄が
 *     キーの名前と違えば赤(リンクは別名を使わない。5 回目 C5-6)
 *   - `resolved` が文字列で、`https://registry.npmjs.org/` の URL(ホストが完全一致。`@` で別ホストを装うものは不可)
 *   - 登録簿の `resolved`(`/<名前>/-/<名前の末尾>-<版>.tgz`)から導いた (名前, 版) が、エントリの `name`(無ければキーの名前)と
 *     `version` に一致する(`npm ci` は `resolved` + `integrity` で取るので、欄の自己申告を偽ると待ち・目録の integrity・
 *     advisory が別の版を引く。4 回目 C4-5)
 *   - `integrity` が単一の `sha512-…`(sha1・複数・空は不可)
 */

import { bundleProblem } from './npm-lock-rules.js';
import type { DepsFinding } from './types.js';

/** 公式の登録簿。 */
export const OFFICIAL_REGISTRY_ORIGIN = 'https://registry.npmjs.org';

/** sha512 の SRI(64 バイトの base64 = 86 字 + `==`)。 */
const SHA512_SRI = /^sha512-[A-Za-z0-9+/]{86}==$/;

interface LockEntry {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly resolved?: unknown;
  readonly integrity?: unknown;
  readonly link?: unknown;
  readonly inBundle?: unknown;
}

/**
 * 宣言した手元の置き場(lockfile のある場所からの相対の正規形 → そこを指してよい名前)。
 * 作り方は `lockfile-local.ts`(隣の `package.json` の `workspaces` と `file:` 依存)。
 */
export interface LocalDeclarations {
  readonly targets: ReadonlyMap<string, ReadonlySet<string>>;
}

/** 宣言が 1 つも無い(どのリンク・`file:` も許さない)。 */
export const NO_LOCAL_DECLARATIONS: LocalDeclarations = { targets: new Map() };

/** 受ける最も古い lockfile の版(v2 から `packages` を持つ)。 */
const MIN_LOCKFILE_VERSION = 2;

/** 手元のパスの正規形(`./a/` → `a`、`a/../b` → `b`)。 */
export function normalizeLocalPath(value: string): string {
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
    else parts.push(part);
  }
  return `${value.startsWith('/') ? '/' : ''}${parts.join('/')}`;
}

/** `node_modules/a/node_modules/@s/b` → `@s/b`(最後の node_modules 以降)。 */
export function nameFromLockKey(key: string): string {
  const at = key.lastIndexOf('node_modules/');
  return at === -1 ? key : key.slice(at + 'node_modules/'.length);
}

/**
 * 公式の登録簿の tarball の URL から (名前, 版) を導く(`https://registry.npmjs.org/@s/b/-/b-1.2.3-beta.1.tgz` → `@s/b` / `1.2.3-beta.1`)。
 * 形が違えば null。
 *
 * @param resolved lockfile の `resolved`
 */
export function registryTarballIdentity(resolved: string): { readonly name: string; readonly version: string } | null {
  if (!isOfficialRegistryUrl(resolved)) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(resolved).pathname);
  } catch {
    return null;
  }
  const match = /^\/((?:@[^/]+\/)?[^/@]+)\/-\/([^/]+)\.tgz$/.exec(pathname);
  const name = match?.[1];
  const file = match?.[2];
  if (name === undefined || file === undefined) return null;
  const base = name.slice(name.lastIndexOf('/') + 1);
  if (!file.startsWith(`${base}-`) || file.length === base.length + 1) return null;
  return { name, version: file.slice(base.length + 1) };
}

/**
 * lockfile の形の問題(JSON でない・v2 未満・`packages` が無い)。問題が無ければ null。
 *
 * @param text lockfile の本文
 */
export function lockfileShapeProblem(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'lockfile を JSON として読めない(npm ci が何を入れるかを確かめられない)';
  }
  const doc = typeof parsed === 'object' && parsed !== null ? (parsed as { lockfileVersion?: unknown; packages?: unknown }) : {};
  const version = doc.lockfileVersion;
  if (typeof version !== 'number' || version < MIN_LOCKFILE_VERSION) {
    return `lockfile の lockfileVersion が ${String(MIN_LOCKFILE_VERSION)} 以上でない(${JSON.stringify(version ?? null)}。v1 は packages を持たず、配信元と固定を確かめられない — npm 7 以降で作り直す)`;
  }
  if (typeof doc.packages !== 'object' || doc.packages === null || Array.isArray(doc.packages)) {
    return 'lockfile に packages が無い(配信元と固定を確かめられない)';
  }
  return null;
}

/** `resolved` が公式の登録簿の URL か(文字列の接頭辞ではなく URL として見る)。 */
export function isOfficialRegistryUrl(resolved: string): boolean {
  try {
    const url = new URL(resolved);
    return url.protocol === 'https:' && url.origin === OFFICIAL_REGISTRY_ORIGIN && url.username === '' && url.password === '' && resolved.startsWith(`${OFFICIAL_REGISTRY_ORIGIN}/`);
  } catch {
    return false;
  }
}

function finding(lockfile: string, id: string, key: string, version: string | undefined, title: string): DepsFinding {
  const name = nameFromLockKey(key);
  return {
    lockfile, kind: 'lockfile', id, aliases: [], pkg: name, ...(version === undefined ? {} : { version }),
    severity: 'high', sources: ['lockfile'], title, level: 'red',
  };
}

/** 手元の置き場を指すエントリ(link / file:)が宣言どおりか。外れれば理由。 */
function localSourceProblem(key: string, entry: LockEntry, local: LocalDeclarations): string | null {
  // npm ci がリンク・取得物を置く場所はキーで決まる。宣言との照合はキーの名前で引く(自己申告の name 欄で引かない。5 回目 C5-6)。
  const name = nameFromLockKey(key);
  if (entry.link === true && typeof entry.name === 'string' && entry.name !== name) {
    return `name 欄(${entry.name})がキーの名前(${name})と違う(リンクは別名を使わない)`;
  }
  const raw = typeof entry.resolved === 'string' ? entry.resolved : '';
  const target = normalizeLocalPath(entry.link === true ? raw : raw.slice('file:'.length));
  const allowed = local.targets.get(target);
  if (raw === '') return 'リンクの resolved が無い(どこを指すか分からない)';
  if (allowed === undefined) return `宣言していない置き場(${target})を指している(根の workspaces・file: 依存に無い)`;
  if (!allowed.has(name)) return `置き場 ${target} は ${[...allowed].join(' / ')} の宣言で、${name} の宣言ではない`;
  return null;
}

/** 登録簿のエントリの (名前, 版) が resolved と一致するか。外れれば理由。 */
function identityProblem(key: string, entry: LockEntry, resolved: string): string | null {
  const identity = registryTarballIdentity(resolved);
  if (identity === null) return 'resolved が登録簿の tarball の形(/<名前>/-/<名前>-<版>.tgz)でなく、名前と版を導けない';
  const declaredName = typeof entry.name === 'string' ? entry.name : nameFromLockKey(key);
  const declaredVersion = typeof entry.version === 'string' ? entry.version : '(無し)';
  if (identity.name !== declaredName || identity.version !== declaredVersion) {
    return `エントリの名前と版(${declaredName}@${declaredVersion})が resolved の tarball(${identity.name}@${identity.version})と一致しない`;
  }
  return null;
}

/**
 * lockfile の本文から、配信元と固定の違反(赤)を集める。lockfile の形が読めなければ(JSON でない・v2 未満・`packages` 無し)、その 1 件を赤にする。
 *
 * @param lockfile lockfile のパス(ルート相対)
 * @param text lockfile の本文
 * @param local 宣言した手元の置き場(既定は無し = どのリンク・`file:` も赤)
 */
export function lockfilePinFindings(lockfile: string, text: string, local: LocalDeclarations = NO_LOCAL_DECLARATIONS): DepsFinding[] {
  const shape = lockfileShapeProblem(text);
  if (shape !== null) return [finding(lockfile, 'lockfile-shape', '(lockfile)', undefined, shape)];
  const packages = (JSON.parse(text) as { packages: Record<string, LockEntry> }).packages;
  const findings: DepsFinding[] = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.includes('node_modules/') || typeof entry !== 'object' || entry === null) continue;
    const version = typeof entry.version === 'string' ? entry.version : undefined;
    if (entry.inBundle === true) {
      const problem = bundleProblem(packages, key);
      if (problem === null) continue;
      findings.push(finding(lockfile, 'lockfile-bundle', key, version, `lockfile の${problem}`));
    }
    if (entry.link === true || (typeof entry.resolved === 'string' && entry.resolved.startsWith('file:'))) {
      const problem = localSourceProblem(key, entry, local);
      if (problem !== null) findings.push(finding(lockfile, entry.link === true ? 'lockfile-link' : 'lockfile-local-source', key, version, `lockfile の${entry.link === true ? 'リンク' : ' file: の取得元'}が${problem}`));
      continue;
    }
    if (typeof entry.resolved !== 'string') {
      findings.push(finding(lockfile, 'lockfile-unresolved', key, version, 'lockfile に resolved が無い(npm ci が取得元を lockfile で固定できない)'));
    } else if (!isOfficialRegistryUrl(entry.resolved)) {
      let host = '(URL でない)';
      try {
        host = new URL(entry.resolved).host;
      } catch {
        // URL として読めない値は host の表示だけ諦める。
      }
      findings.push(finding(lockfile, 'lockfile-source', key, version, `lockfile の resolved が公式の登録簿でない(${host})`));
    } else {
      const problem = identityProblem(key, entry, entry.resolved);
      if (problem !== null) findings.push(finding(lockfile, 'lockfile-identity', key, version, `lockfile の${problem}(npm ci は resolved で取るので、欄の名前・版で引く検査がすり抜ける)`));
    }
    if (typeof entry.integrity !== 'string' || !SHA512_SRI.test(entry.integrity)) {
      findings.push(finding(lockfile, 'lockfile-integrity', key, version, 'lockfile の integrity が無い、または単一の sha512 でない'));
    }
  }
  return findings;
}
