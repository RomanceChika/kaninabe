/**
 * `npm audit --json` の結果の読み取り(1 つ目の出どころ)と、重大度から赤 / 警告への写し。
 *
 * 赤にするのは critical / high(裁定 2026-10-22)。moderate / low は警告の一覧。重大度が分からないもの(`unknown`)は
 * 警告に倒す(出どころが言わないものを赤にしない。一覧には必ず出る)。
 */

import type { DepsIo, DepsFinding, Level, PartResult, Severity } from './types.js';

const SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high', 'moderate', 'low']);

/** 重大度の語を揃える(OSV の `MEDIUM` も moderate)。 */
export function normalizeSeverity(raw: unknown): Severity {
  const word = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (word === 'medium') return 'moderate';
  return SEVERITIES.has(word) ? (word as Severity) : 'unknown';
}

/** 指摘の初期の判定(受け入れ表を当てる前)。 */
export function baseLevel(finding: Pick<DepsFinding, 'kind' | 'severity'>): Level {
  if (finding.kind === 'signature') return finding.severity === 'high' ? 'red' : 'warning';
  if (finding.kind === 'cooldown') return 'warning';
  return finding.severity === 'critical' || finding.severity === 'high' ? 'red' : 'warning';
}

interface AuditVia {
  readonly source?: number;
  readonly name?: string;
  readonly title?: string;
  readonly url?: string;
  readonly severity?: string;
  readonly range?: string;
}

/** advisory の URL から GHSA の ID を取る(無ければ npm の番号)。 */
function advisoryId(via: AuditVia): string {
  const fromUrl = /(GHSA-[a-z0-9-]+)/i.exec(via.url ?? '');
  if (fromUrl?.[1] !== undefined) return fromUrl[1];
  return `npm-${String(via.source ?? 'unknown')}`;
}

/** audit の出力を指摘にする結果。 */
export interface AuditOutcome {
  readonly part: PartResult;
  readonly findings: DepsFinding[];
}

/**
 * `npm audit --json` の出力(標準出力の本文)を読む。
 * 取得に失敗した形(`error` を持つ・JSON でない)は未実施。**脆弱性があるときの終了コードは非 0** なので、コードでは判定しない。
 *
 * @param lockfile lockfile のパス(指摘に載せる)
 * @param stdout 標準出力
 */
export function parseAudit(lockfile: string, stdout: string): AuditOutcome {
  let json: { vulnerabilities?: Record<string, { via?: unknown[] }>; error?: { summary?: string; code?: string } };
  try {
    json = JSON.parse(stdout) as typeof json;
  } catch {
    return { part: { status: 'unavailable', reason: 'npm audit の出力が JSON ではありません' }, findings: [] };
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { part: { status: 'unavailable', reason: 'npm audit の出力が報告の形(オブジェクト)ではありません' }, findings: [] };
  }
  if (json.error !== undefined) {
    return { part: { status: 'unavailable', reason: `npm audit が失敗しました(${json.error.code ?? json.error.summary ?? 'error'})` }, findings: [] };
  }
  // 報告の形を確かめる(外部レビュー: `{}` や空の応答を「検査済み・検出なし」に格上げしない)。npm audit の JSON は
  // auditReportVersion 2・vulnerabilities(オブジェクト)・metadata.vulnerabilities(重大度ごとの件数)を持つ。
  const report = json as { auditReportVersion?: unknown; vulnerabilities?: unknown; metadata?: { vulnerabilities?: Record<string, unknown> } };
  const counts = report.metadata?.vulnerabilities;
  if (report.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null || Array.isArray(report.vulnerabilities) || typeof counts !== 'object' || counts === null) {
    return { part: { status: 'unavailable', reason: 'npm audit の出力が報告の形(auditReportVersion 2・vulnerabilities・metadata)を満たしません' }, findings: [] };
  }
  const findings = new Map<string, DepsFinding>();
  for (const vuln of Object.values(json.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || via === null) continue; // 文字列 = 他の部品から伝わった印(根の advisory は別の項に出る)
      const v = via as AuditVia;
      if (v.name === undefined) continue;
      const id = advisoryId(v);
      const severity = normalizeSeverity(v.severity);
      const finding: DepsFinding = {
        lockfile, kind: 'advisory', id, aliases: [], pkg: v.name, severity, sources: ['audit'],
        title: v.title ?? '', ...(v.url === undefined ? {} : { url: v.url }), level: baseLevel({ kind: 'advisory', severity }),
      };
      findings.set(`${id}|${v.name}`, finding);
    }
  }
  // 件数の表と中身が食い違えば(件数はあるのに読めた advisory が 0)、読み落としとして未実施にする。
  const total = typeof counts['total'] === 'number' ? counts['total'] : 0;
  if (total > 0 && findings.size === 0) {
    return { part: { status: 'unavailable', reason: `npm audit の件数(${total})と読めた advisory(0)が食い違います` }, findings: [] };
  }
  return { part: { status: 'done' }, findings: [...findings.values()] };
}

/**
 * lockfile のある場所で `npm audit --json` を回す(開発依存も含める = `--omit` を付けない)。
 *
 * @param io 外への口
 * @param lockfile lockfile のパス(ルート相対)
 * @param rootAbs ルートの絶対パス
 */
export async function runAudit(io: DepsIo, lockfile: string, rootAbs: string): Promise<AuditOutcome> {
  const dir = lockfile.includes('/') ? `${rootAbs}/${lockfile.slice(0, lockfile.lastIndexOf('/'))}` : rootAbs;
  try {
    const result = await io.exec('npm', ['audit', '--json'], dir);
    return parseAudit(lockfile, result.stdout);
  } catch (error) {
    return { part: { status: 'unavailable', reason: `npm audit を回せません(${error instanceof Error ? error.message : String(error)})` }, findings: [] };
  }
}
