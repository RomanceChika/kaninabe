/**
 * 検査結果の 1 画面の要約と、最終実施の鮮度(verify の範囲サマリが読む)。
 */

import type { DepsFinding, DepsReport, PartName } from './types.js';
import { STALE_DAYS } from './types.js';

const PART_LABEL: Readonly<Record<PartName, string>> = { audit: 'npm audit', osv: 'OSV', signatures: '署名', cooldown: '公開日時の待ち' };
const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'unknown'] as const;
/** 警告を 1 画面に並べる上限(超えたぶんは件数だけ。全件は JSON)。 */
const LISTED_LIMIT = 12;

function describe(f: DepsFinding): string {
  const at = f.version === undefined ? f.pkg : `${f.pkg}@${f.version}`;
  const label = f.kind === 'advisory' ? `${f.id} [${f.severity}]` : f.kind === 'cooldown' ? '待ち' : f.id;
  const accepted = f.accepted === undefined ? '' : f.accepted.overDeadline !== undefined ? `  受け入れの期限(${f.accepted.reviewBy})が${f.kind === 'cooldown' ? '待ちの受け入れの上限' : '重大度の上限'}(今日から ${String(f.accepted.overDeadline)} 日以内)を超えています: ${f.accepted.reason}` : f.accepted.expired ? `  受け入れの期限切れ(${f.accepted.reviewBy}): ${f.accepted.reason}` : `  受け入れ済み(${f.accepted.reviewBy} まで): ${f.accepted.reason}`;
  return `${label}  ${at}  ${f.title}${f.url === undefined ? '' : ` ${f.url}`}${accepted}`;
}

/**
 * 結果を 1 画面の要約にする(行の配列)。
 *
 * @param report 検査結果
 * @param jsonPath 結果の JSON の置き場(表示用)
 */
export function formatDepsReport(report: DepsReport, jsonPath: string): string[] {
  const lines: string[] = [];
  const { red, warning, accepted, unperformed } = report.summary;
  lines.push(`deps:check — ${report.ok ? '通過' : '赤'}(赤 ${String(red)} / 警告 ${String(warning)} / 受け入れ済み ${String(accepted)} / 未実施 ${String(unperformed)} 部分)`);
  for (const lockfile of report.lockfiles) {
    const parts = (Object.keys(PART_LABEL) as PartName[]).map((name) => {
      const part = lockfile.parts[name];
      return `${PART_LABEL[name]} ${part.status === 'done' ? '済' : '未実施'}`;
    });
    lines.push(`  ${lockfile.path}(${String(lockfile.packages)} 部品): ${parts.join(' / ')}`);
    for (const name of Object.keys(PART_LABEL) as PartName[]) {
      const part = lockfile.parts[name];
      if (part.status === 'unavailable') lines.push(`    未実施 — ${PART_LABEL[name]}: ${part.reason ?? ''}`);
    }
  }
  const bySeverity = (f: DepsFinding): number => SEVERITY_ORDER.indexOf(f.severity);
  for (const [heading, level] of [['赤', 'red'], ['警告', 'warning'], ['受け入れ済み', 'accepted']] as const) {
    const list = report.findings.filter((f) => f.level === level).sort((a, b) => bySeverity(a) - bySeverity(b));
    if (list.length === 0) continue;
    lines.push(`${heading}:`);
    const shown = level === 'red' ? list : list.slice(0, LISTED_LIMIT);
    for (const f of shown) lines.push(`  - ${describe(f)}  (${f.lockfile})`);
    if (shown.length < list.length) lines.push(`  ほか ${String(list.length - shown.length)} 件(全件は ${jsonPath})`);
  }
  for (const note of report.notes) lines.push(`注: ${note}`);
  lines.push(`結果の JSON: ${jsonPath}`);
  return lines;
}

/** 記録の時刻が未来とみなす余裕(時計のずれ)。 */
const CLOCK_SKEW_MS = 5 * 60_000;

/** 結果の JSON のうち、鮮度の判断に使う欄。 */
interface FreshnessRecord {
  readonly generatedAt?: unknown;
  readonly ok?: unknown;
  readonly lockfiles?: unknown;
}

/** 全ての lockfile の全ての部分が未実施か(lockfile が 0 件のときは false)。 */
function everythingUnperformed(lockfiles: unknown): boolean {
  if (!Array.isArray(lockfiles) || lockfiles.length === 0) return false;
  return lockfiles.every((entry: { parts?: Record<string, { status?: unknown }> }) => {
    const parts = Object.values(entry?.parts ?? {});
    return parts.length > 0 && parts.every((part) => part?.status === 'unavailable');
  });
}

/** どれかの lockfile のどれかの部分が未実施か(lockfile が 0 件・読めない形は「確かめていない」として true)。 */
function anythingUnperformed(lockfiles: unknown): boolean {
  if (!Array.isArray(lockfiles) || lockfiles.length === 0) return true;
  return lockfiles.some((entry: { parts?: Record<string, { status?: unknown }> }) => {
    const parts = Object.values(entry?.parts ?? {});
    return parts.length === 0 || parts.some((part) => part?.status !== 'done');
  });
}

/** 鮮度の判断の厳しさ。 */
export interface FreshnessOptions {
  /**
   * 1 つでも未実施の部分があれば古いと数える(取り込みの台本の日数の口 `deps:check -- --fresh`。fix27)。既定(verify の範囲サマリ)は、全部が
   * 未実施のときだけ古いと数える(一部の未実施は手元で通信が切れた日にも起き、警告を常に出すと読まれなくなる)。
   */
  readonly complete?: boolean;
  /**
   * 今の lockfile の全部(ルート相対のパス → 中身の sha256)。渡すと、記録が確かめた lockfile の本数・パス・中身がこれと同じでなければ古いと数える
   * (取り込みの台本の日数の口。印が新しくても lockfile が変わったなら確かめ直す。差分点検 A27-2)。記録が指紋を持たない(古い形)のも古い。
   */
  readonly lockfiles?: Readonly<Record<string, string>>;
}

/** 記録が確かめた lockfile と今の lockfile の食い違い(無ければ null)。 */
function lockfileDrift(recorded: unknown, current: Readonly<Record<string, string>>): string | null {
  const entries = Array.isArray(recorded) ? (recorded as { path?: unknown; sha256?: unknown }[]) : [];
  if (entries.some((entry) => typeof entry?.sha256 !== 'string')) return '記録が lockfile の中身の指紋を持たない(古い形の記録)';
  const seen = new Map(entries.map((entry) => [String(entry.path), String(entry.sha256)]));
  const paths = [...new Set([...seen.keys(), ...Object.keys(current)])].sort();
  const changed = paths.filter((file) => seen.get(file) !== current[file]);
  return changed.length === 0 ? null : `確かめた後に lockfile が変わった・増えた・減った: ${changed.join(', ')}`;
}

/**
 * 最終実施の鮮度を 1 行にする(verify の範囲サマリ用)。無い・読めない・`STALE_DAYS` 日超は警告の言い方。
 *
 * **時刻だけでなく実行の結果も見る**(3 回目の点検 C-4): 全部「未実施」で終わった実行(オフライン)・赤で終わった実行・
 * 未来の時刻の記録は、新しい時刻でも「回した」とは数えない(さもないと、何も確かめていない記録が警告を黙らせる)。
 *
 * @param latestJson 結果の JSON の本文(無ければ null)
 * @param now 今
 * @param options 鮮度の判断の厳しさ(既定は verify の範囲サマリの判断)
 * @returns `stale` が true なら警告の行
 */
export function describeFreshness(latestJson: string | null, now: Date, options: FreshnessOptions = {}): { readonly line: string; readonly stale: boolean } {
  const hint = '`npm run deps:check` を回してください';
  if (latestJson === null) return { line: `依存の検査の最終実施: 記録なし(未実施)— ${hint}`, stale: true };
  let record: FreshnessRecord;
  try {
    record = JSON.parse(latestJson) as FreshnessRecord;
  } catch {
    return { line: `依存の検査の最終実施: 記録を読めません — ${hint}`, stale: true };
  }
  const at = new Date(typeof record?.generatedAt === 'string' ? record.generatedAt : '');
  if (Number.isNaN(at.getTime())) return { line: `依存の検査の最終実施: 記録を読めません — ${hint}`, stale: true };
  const stamp = at.toISOString();
  if (at.getTime() > now.getTime() + CLOCK_SKEW_MS) return { line: `依存の検査の最終実施: ${stamp}(未来の時刻。記録を信用できません)— ${hint}`, stale: true };
  const days = (now.getTime() - at.getTime()) / 86_400_000;
  if (days > STALE_DAYS) return { line: `依存の検査の最終実施: ${stamp}(${String(Math.floor(days))} 日前。${String(STALE_DAYS)} 日超)— ${hint}`, stale: true };
  if (typeof record.ok !== 'boolean') return { line: `依存の検査の最終実施: ${stamp}(結果を読めません)— ${hint}`, stale: true };
  if (everythingUnperformed(record.lockfiles)) return { line: `依存の検査の最終実施: ${stamp}(全部の部分が未実施で終わった。何も確かめていない)— ${hint}`, stale: true };
  if (!record.ok) return { line: `依存の検査の最終実施: ${stamp}(赤で終わった。直して回し直す)— ${hint}`, stale: true };
  if (options.complete === true && anythingUnperformed(record.lockfiles)) return { line: `依存の検査の最終実施: ${stamp}(未実施の部分が残った。全部を確かめた実行ではない)— ${hint}`, stale: true };
  const drift = options.lockfiles === undefined ? null : lockfileDrift(record.lockfiles, options.lockfiles);
  if (drift !== null) return { line: `依存の検査の最終実施: ${stamp}(${drift})— ${hint}`, stale: true };
  return { line: `依存の検査の最終実施: ${stamp}(${String(Math.max(0, Math.floor(days)))} 日前)`, stale: false };
}
