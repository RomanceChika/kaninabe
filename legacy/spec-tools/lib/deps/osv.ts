/**
 * OSV の照会(2 つ目の出どころ。npm の advisory DB とは別系統)。
 *
 * `POST /v1/querybatch` に lockfile の (名前, 版) を 1000 件ずつ送り、当たった ID の詳細(重大度・別名・題)は `GET /v1/vulns/{id}` で引く。
 * 出どころが重大度を言わないとき(悪意あるパッケージの `MAL-` は critical とみなす。それ以外は unknown → 警告)。
 */

import { baseLevel, normalizeSeverity } from './audit.js';
import type { DepsFinding, DepsIo, LockedPackage, PartResult, Severity } from './types.js';

const BATCH = 1000;
const OSV = 'https://api.osv.dev/v1';

interface OsvVuln {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly summary?: string;
  readonly database_specific?: { readonly severity?: string };
}

/** 詳細から重大度を取る。 */
function severityOf(vuln: OsvVuln): Severity {
  if (vuln.id.startsWith('MAL-')) return 'critical';
  return normalizeSeverity(vuln.database_specific?.severity);
}

/** OSV 照会の結果。 */
export interface OsvOutcome {
  readonly part: PartResult;
  readonly findings: DepsFinding[];
}

/**
 * lockfile の全 (名前, 版) を OSV に照会する。1 度でも通信に失敗したら、その lockfile の OSV 全体を未実施にする(半端な結果を「無し」に見せない)。
 *
 * @param io 外への口
 * @param lockfile lockfile のパス
 * @param packages 照会する部品
 */
export async function runOsv(io: DepsIo, lockfile: string, packages: readonly LockedPackage[]): Promise<OsvOutcome> {
  try {
    const hits = new Map<string, Set<string>>(); // 脆弱性 ID → 当たった "名前@版"
    for (let start = 0; start < packages.length; start += BATCH) {
      const chunk = packages.slice(start, start + BATCH);
      const body = { queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: 'npm' }, version: p.version })) };
      const response = (await io.fetchJson(`${OSV}/querybatch`, { method: 'POST', body })) as { results?: { vulns?: { id: string }[] }[] };
      const results = response.results ?? [];
      if (results.length !== chunk.length) throw new Error('OSV の応答の件数が問い合わせと合いません');
      results.forEach((result, index) => {
        const pkg = chunk[index];
        if (pkg === undefined) return;
        for (const vuln of result.vulns ?? []) {
          const set = hits.get(vuln.id) ?? new Set<string>();
          set.add(`${pkg.name}@${pkg.version}`);
          hits.set(vuln.id, set);
        }
      });
    }
    const findings: DepsFinding[] = [];
    for (const [id, owners] of hits) {
      const vuln = (await io.fetchJson(`${OSV}/vulns/${encodeURIComponent(id)}`)) as OsvVuln;
      const severity = severityOf({ ...vuln, id });
      for (const owner of owners) {
        const at = owner.lastIndexOf('@');
        findings.push({
          lockfile, kind: 'advisory', id, aliases: vuln.aliases ?? [], pkg: owner.slice(0, at), version: owner.slice(at + 1), severity,
          sources: ['osv'], title: vuln.summary ?? '', url: `https://osv.dev/${id}`, level: baseLevel({ kind: 'advisory', severity }),
        });
      }
    }
    return { part: { status: 'done' }, findings };
  } catch (error) {
    return { part: { status: 'unavailable', reason: `OSV に問い合わせできません(${error instanceof Error ? error.message : String(error)})` }, findings: [] };
  }
}

/** まとめた指摘(重大度は audit を優先・別名と出どころは両方。版は `version` を指定すればそれ、無ければもとの版か OSV の版)。 */
function combine(twin: DepsFinding, found: DepsFinding, version: string | undefined): DepsFinding {
  const severity = twin.severity === 'unknown' ? found.severity : twin.severity;
  return {
    ...twin,
    severity,
    aliases: [...new Set([...twin.aliases, ...found.aliases, ...(found.id === twin.id ? [] : [found.id])])],
    sources: [...new Set([...twin.sources, ...found.sources])],
    ...(version === undefined ? {} : { version }),
    level: baseLevel({ kind: 'advisory', severity }),
  };
}

/**
 * OSV の指摘と audit の指摘を 1 本にまとめる(同じ部品で、ID か別名が重なれば同じ advisory)。
 * まとまったものは出どころを両方持ち、重大度は audit を優先(audit が言わなければ OSV)。
 * **版ごとに 1 本**にする: 同じ部品・同じ advisory でも版が違えば別の指摘(受け入れ表は版を名指すので、2 つ目の版を 1 つ目に吸わせて隠さない)。
 * audit は版を言わない(名前ごと)ので、OSV が当てなかった audit の指摘は lockfile にあるその名前の版ごとに分ける
 * (範囲は読まず、入っている版の全部を受け入れ表に名指させる側に倒す)。lockfile に名前が無ければ版の無いまま(受け入れ表に当たらない)。
 *
 * @param audit audit の指摘
 * @param osv OSV の指摘
 * @param packages その lockfile の部品(audit の指摘の版を引く)
 */
export function mergeAdvisories(audit: readonly DepsFinding[], osv: readonly DepsFinding[], packages: readonly LockedPackage[] = []): DepsFinding[] {
  const merged: DepsFinding[] = audit.map((f) => ({ ...f }));
  for (const found of osv) {
    const ids = new Set([found.id, ...found.aliases]);
    const same = (m: DepsFinding): boolean => m.kind === 'advisory' && m.pkg === found.pkg && (ids.has(m.id) || m.aliases.some((a) => ids.has(a)));
    const twin = merged.find((m) => same(m) && (m.version === undefined || m.version === found.version));
    if (twin !== undefined) {
      merged[merged.indexOf(twin)] = combine(twin, found, twin.version ?? found.version);
      continue;
    }
    // 同じ advisory が別の版で既にまとまっていれば、その出どころを継いだ別の 1 本にする(無ければ OSV だけが見つけたもの)。
    const sibling = merged.find(same);
    merged.push(sibling === undefined ? found : combine(sibling, found, found.version));
  }
  return merged.flatMap((f) => {
    if (f.version !== undefined) return [f];
    const versions = [...new Set(packages.filter((p) => p.name === f.pkg).map((p) => p.version))].sort();
    return versions.length === 0 ? [f] : versions.map((version) => ({ ...f, version }));
  });
}
