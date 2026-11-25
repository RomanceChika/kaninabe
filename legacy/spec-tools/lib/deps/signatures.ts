/**
 * `npm audit signatures`(登録簿の署名と provenance)と、公開日時の待ち(cooldown)。
 *
 * 署名は**入れた木**(`node_modules`)を見る道具なので、木が無い場所は未実施(理由つき)。
 * 待ちは packument(`time`)の公開日時を見る。同じ名前は lockfile をまたいで 1 度だけ引く。
 * 同じ packument の `versions[v].dist.integrity` を、lockfile の `integrity` と突き合わせる(通信できるときだけ。
 * `npm audit signatures` は登録簿の目録の署名を見るだけで、lockfile の中身と結び付かない — 3 回目の点検 C-3)。
 */

import type { DepsFinding, DepsIo, LockedPackage, PartResult } from './types.js';
import { COOLDOWN_DAYS } from './types.js';

/** 署名の検査の結果。 */
export interface SignatureOutcome {
  readonly part: PartResult;
  readonly findings: DepsFinding[];
}

interface SignatureProblem {
  readonly name?: string;
  readonly version?: string;
  readonly location?: string;
}

/** 署名の指摘 1 件(invalid = 赤、missing = 警告)。 */
function signatureFinding(lockfile: string, problem: SignatureProblem, invalid: boolean): DepsFinding {
  return {
    lockfile, kind: 'signature', id: invalid ? 'invalid-signature' : 'missing-signature', aliases: [], pkg: problem.name ?? '(不明)',
    ...(problem.version === undefined ? {} : { version: problem.version }), severity: invalid ? 'high' : 'low', sources: ['signatures'],
    title: invalid ? '登録簿の署名が一致しません' : '登録簿の署名が無い版です', level: invalid ? 'red' : 'warning',
  };
}

/**
 * lockfile のある場所で `npm audit signatures --json` を回す。
 *
 * @param io 外への口
 * @param lockfile lockfile のパス(ルート相対)
 * @param rootAbs ルートの絶対パス
 */
export async function runSignatures(io: DepsIo, lockfile: string, rootAbs: string): Promise<SignatureOutcome> {
  const rel = lockfile.includes('/') ? lockfile.slice(0, lockfile.lastIndexOf('/')) : '';
  if (!io.isDirectory(rel === '' ? 'node_modules' : `${rel}/node_modules`)) {
    return { part: { status: 'unavailable', reason: '依存を入れていない(node_modules が無い)ため署名を確かめられません — npm ci のあとに再実行' }, findings: [] };
  }
  try {
    const result = await io.exec('npm', ['audit', 'signatures', '--json'], rel === '' ? rootAbs : `${rootAbs}/${rel}`);
    const json = JSON.parse(result.stdout) as { invalid?: SignatureProblem[]; missing?: SignatureProblem[]; error?: { summary?: string; code?: string } };
    if (json.error !== undefined) {
      return { part: { status: 'unavailable', reason: `npm audit signatures が失敗しました(${json.error.code ?? json.error.summary ?? 'error'})` }, findings: [] };
    }
    const findings = [
      ...(json.invalid ?? []).map((p) => signatureFinding(lockfile, p, true)),
      ...(json.missing ?? []).map((p) => signatureFinding(lockfile, p, false)),
    ];
    return { part: { status: 'done' }, findings };
  } catch (error) {
    return { part: { status: 'unavailable', reason: `署名の検査を回せません(${error instanceof Error ? error.message : String(error)})` }, findings: [] };
  }
}

/** 公開日時の表(名前 → 版 → ISO 日時)。引けなかった名前は入れない。 */
export type PublishTimes = ReadonlyMap<string, Readonly<Record<string, string>>>;

/** 登録簿の目録の `dist.integrity` の表(名前 → 版 → integrity)。言っていない版は入れない。 */
export type RegistryIntegrities = ReadonlyMap<string, Readonly<Record<string, string>>>;

/** packument の `versions[v].dist.integrity` を集める。 */
function integritiesOf(versions: Record<string, { dist?: { integrity?: unknown } }> | undefined): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [version, doc] of Object.entries(versions ?? {})) {
    const integrity = doc?.dist?.integrity;
    if (typeof integrity === 'string') found[version] = integrity;
  }
  return found;
}

/**
 * lockfile の `integrity` が登録簿の目録の `dist.integrity` と食い違う版を赤にする。
 * 目録が integrity を言っていない版・lockfile に integrity が無い版は指摘にしない(後者は `lockfile-integrity` が赤にする)。
 *
 * @param lockfile lockfile のパス
 * @param packages lockfile の部品(登録簿から来たものだけ見る)
 * @param registry 目録の integrity の表
 */
export function integrityMismatchFindings(lockfile: string, packages: readonly LockedPackage[], registry: RegistryIntegrities): DepsFinding[] {
  const findings: DepsFinding[] = [];
  for (const pkg of packages) {
    if (!pkg.fromRegistry || pkg.integrity === undefined) continue;
    const expected = registry.get(pkg.name)?.[pkg.version];
    if (expected === undefined || expected === pkg.integrity) continue;
    findings.push({
      lockfile, kind: 'lockfile', id: 'lockfile-integrity-mismatch', aliases: [], pkg: pkg.name, version: pkg.version, severity: 'critical', sources: ['registry'],
      title: 'lockfile の integrity が登録簿の目録の dist.integrity と一致しません(差し替えの疑い)', level: 'red',
    });
  }
  return findings;
}

/** 登録簿への問い合わせの結果。 */
export interface PublishLookup {
  readonly part: PartResult;
  readonly times: PublishTimes;
  readonly integrities: RegistryIntegrities;
  /** 目録を引けた名前ごとの、登録簿にある版。 */
  readonly versions: ReadonlyMap<string, ReadonlySet<string>>;
  /** 登録簿に無い(HTTP 404)名前。 */
  readonly missing: ReadonlySet<string>;
}

/** 口が投げた失敗が「登録簿に無い」(HTTP 404)か(本物の口は `status` を添えて投げる)。 */
export function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
}

/**
 * 名前ごとに packument の `time` を引く(同時 8 本)。**失敗は名前ごと**に扱う: 404 は「登録簿に無い」として `missing` に入れ
 * (呼び手が赤にする)、それ以外の失敗(通信)はその名前だけを未実施にする(1 つの失敗で全体を未実施にしない — 4 回目 C4-5)。
 *
 * @param io 外への口
 * @param names 引く名前
 */
export async function fetchPublishTimes(io: DepsIo, names: readonly string[]): Promise<PublishLookup> {
  const times = new Map<string, Readonly<Record<string, string>>>();
  const integrities = new Map<string, Readonly<Record<string, string>>>();
  const versions = new Map<string, ReadonlySet<string>>();
  const missing = new Set<string>();
  const failed: string[] = [];
  const queue = [...new Set(names)];
  const worker = async (): Promise<void> => {
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
      try {
        const doc = (await io.fetchJson(`https://registry.npmjs.org/${name.replace('/', '%2f')}`)) as { time?: Record<string, string>; versions?: Record<string, { dist?: { integrity?: unknown } }> };
        // 目録の形でない応答(versions が無い)は、その名前を確かめられなかったとして未実施に数える(黙って緑にしない)。
        if (typeof doc.versions !== 'object' || doc.versions === null) throw new Error('目録に versions がありません');
        times.set(name, doc.time ?? {});
        integrities.set(name, integritiesOf(doc.versions));
        versions.set(name, new Set(Object.keys(doc.versions)));
      } catch (error) {
        if (isNotFound(error)) missing.add(name);
        else failed.push(`${name}(${error instanceof Error ? error.message : String(error)})`);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const part: PartResult = failed.length === 0
    ? { status: 'done' }
    : { status: 'unavailable', reason: `登録簿に問い合わせできない名前が ${String(failed.length)} 件(${failed.sort().slice(0, 3).join(' / ')}${failed.length > 3 ? ' ほか' : ''})` };
  return { part, times, integrities, versions, missing };
}

/**
 * 登録簿から来るはずの部品のうち、**登録簿に無い名前**(404)・**目録に無い版**を赤にする(自己申告の名前・版で検査を外させない)。
 * 目録を引けなかった名前(通信の失敗)は何も言わない(未実施は `part` が言う)。
 *
 * @param lockfile lockfile のパス
 * @param packages lockfile の部品(登録簿から来たものだけ見る)
 * @param lookup 問い合わせの結果
 */
export function registryMissingFindings(lockfile: string, packages: readonly LockedPackage[], lookup: Pick<PublishLookup, 'versions' | 'missing'>): DepsFinding[] {
  const findings: DepsFinding[] = [];
  for (const pkg of packages) {
    if (!pkg.fromRegistry) continue;
    const known = lookup.versions.get(pkg.name);
    const absentName = lookup.missing.has(pkg.name);
    if (!absentName && (known === undefined || known.has(pkg.version))) continue;
    findings.push({
      lockfile, kind: 'lockfile', id: absentName ? 'registry-missing' : 'registry-version-missing', aliases: [], pkg: pkg.name, version: pkg.version, severity: 'high', sources: ['registry'],
      title: absentName ? '登録簿に無い名前です(lockfile の名前の欄が偽られている・取り下げられた疑い)' : '登録簿の目録に無い版です(lockfile の版の欄が偽られている・取り下げられた疑い)',
      level: 'red',
    });
  }
  return findings;
}

/**
 * 公開から `COOLDOWN_DAYS` 日未満の版を警告にする。待ちを**満たしたと言えない**版は赤にする(7 回目 C7-7。黙って飛ばさない):
 * - 目録を引けた名前なのに `time` にその版が無い・日時として読めない(公開日時が引けない = 待ちを確かめられない)
 * - 経過日数が負(公開日時が手元の時計より後。時計の遅れで、公開から数分の版が待ちを素通りする形)
 *
 * 目録そのものを引けなかった名前(通信の失敗)は何も言わない(未実施は `part` が言う)。目録の `versions` に無い版は
 * `registryMissingFindings` が赤にするので、`versions` を渡されたらここでは重ねて名指ししない。
 *
 * @param lockfile lockfile のパス
 * @param packages lockfile の部品(登録簿から来たものだけ見る)
 * @param times 公開日時の表
 * @param now 今
 * @param versions 目録の版の表(渡せば、目録に無い版は `registryMissingFindings` に任せる)
 */
export function cooldownFindings(lockfile: string, packages: readonly LockedPackage[], times: PublishTimes, now: Date, versions?: ReadonlyMap<string, ReadonlySet<string>>): DepsFinding[] {
  const findings: DepsFinding[] = [];
  const red = (pkg: LockedPackage, id: string, title: string): DepsFinding => ({
    lockfile, kind: 'cooldown', id, aliases: [], pkg: pkg.name, version: pkg.version, severity: 'high', sources: ['registry'], title, level: 'red',
  });
  for (const pkg of packages) {
    if (!pkg.fromRegistry) continue;
    const table = times.get(pkg.name);
    if (table === undefined) continue;
    const known = versions?.get(pkg.name);
    if (known !== undefined && !known.has(pkg.version)) continue;
    const published = Object.hasOwn(table, pkg.version) ? table[pkg.version] : undefined;
    const at = typeof published === 'string' ? new Date(published).getTime() : Number.NaN;
    if (published === undefined || Number.isNaN(at)) {
      findings.push(red(pkg, 'cooldown-time-missing', `公開日時が目録から引けません(${JSON.stringify(published ?? null)}。${String(COOLDOWN_DAYS)} 日の待ちを確かめられない)`));
      continue;
    }
    const ageDays = (now.getTime() - at) / 86_400_000;
    if (ageDays < 0) {
      findings.push(red(pkg, 'cooldown-future', `公開日時(${published})が手元の時計より後です(経過 ${ageDays.toFixed(2)} 日。時計のずれか目録の偽り。待ちを確かめられない)`));
      continue;
    }
    if (ageDays >= COOLDOWN_DAYS) continue;
    findings.push({
      lockfile, kind: 'cooldown', id: 'cooldown', aliases: [], pkg: pkg.name, version: pkg.version, severity: 'low', sources: ['registry'],
      title: `公開から ${ageDays.toFixed(1)} 日(${published.slice(0, 10)} 公開。${String(COOLDOWN_DAYS)} 日未満)`, level: 'warning',
    });
  }
  return findings;
}
