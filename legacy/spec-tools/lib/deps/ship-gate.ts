/**
 * 依存の検査の**出荷の関門**(`deps:check -- --ship-gate`。点検 8 回目 C8-2)。
 *
 * 通信の要る検査(公開から 7 日の待ち・lockfile と登録簿の目録の integrity の突合・登録簿に無い版・OSV・audit)は、以前は pre-commit でしか
 * 回らなかった。pre-commit を通らない変更(Dependabot の PR の画面での merge・外の PR)は、この検査を一度も通らずに出荷まで行った。
 * 夜間の出荷(`nightly.yml` の deploy)の前に、依存を入れないジョブでこの関門を回し、deploy の `needs` に入れる。
 *
 * 手元(pre-commit)との違いは 2 つで、どちらも**止める側に倒す**:
 * - 公開から 7 日未満の版(手元では警告)は**赤**。受け入れ表で期限内に受け入れた版(`accepted`)はそのまま通す(理由と期限つきの判断)。
 * - 通信の失敗で**未実施**の部分(audit / OSV / 公開日時の待ち)は**赤**(確かめられないまま出荷しない)。
 *   署名(`npm audit signatures`)だけは、入れた木(`node_modules`)を見る道具なので、依存を入れない関門のジョブでは未実施のまま通す
 *   (登録簿の目録との integrity の突合が、差し替えの検出を別の形で受け持つ)。
 * - lockfile が 1 本も見つからないときも赤(何も確かめていない)。
 */

import type { DepsFinding, DepsReport, PartName } from './types.js';

/** 出荷の関門で未実施を許す部分(入れた木を見る道具。上の説明)。 */
export const SHIP_GATE_UNPERFORMED_ALLOWED: readonly PartName[] = ['signatures'];

/** 待ちの警告を出荷の関門の赤にした指摘。 */
function hardenCooldown(finding: DepsFinding): DepsFinding {
  if (finding.kind !== 'cooldown' || finding.level !== 'warning') return finding;
  return { ...finding, level: 'red', title: `${finding.title} — 出荷の関門では待ちを満たさない版を出さない` };
}

/**
 * 検査の結果を出荷の関門の判定に直す(純粋。元の結果は変えない)。
 *
 * @param report `runDepsCheck` の結果
 * @returns 関門の判定に直した結果(`ok` と `summary` を数え直す)
 */
export function applyShipGate(report: DepsReport): DepsReport {
  const findings = report.findings.map(hardenCooldown);
  const gateNotes: string[] = [];
  if (report.lockfiles.length === 0) gateNotes.push('出荷の関門: lockfile が 1 本も見つかりません(何も確かめていない)');
  for (const lockfile of report.lockfiles) {
    for (const [name, part] of Object.entries(lockfile.parts) as [PartName, (typeof lockfile.parts)[PartName]][]) {
      if (part.status !== 'unavailable' || SHIP_GATE_UNPERFORMED_ALLOWED.includes(name)) continue;
      gateNotes.push(`出荷の関門: ${lockfile.path} の ${name} が未実施です(${part.reason ?? '理由なし'})。確かめられないまま出荷しない`);
    }
  }
  const count = (level: string): number => findings.filter((finding) => finding.level === level).length;
  const tableProblems = report.summary.red - report.findings.filter((finding) => finding.level === 'red').length;
  const red = count('red') + tableProblems + gateNotes.length;
  return {
    ...report,
    findings,
    notes: [...report.notes, ...gateNotes],
    summary: { ...report.summary, red, warning: count('warning'), accepted: count('accepted') },
    ok: red === 0,
  };
}

/**
 * 検査の結果を**全部を確かめた実行**の判定に直す(`deps:check -- --complete`。取り込みの台本が日数で回す口。fix27)。純粋。
 *
 * 取り込みの台本(merge-check)は、最後に全部を確かめた実行の印が `STALE_DAYS` 日より古ければ deps:check を回す。そこで通信が切れて
 * **未実施**の部分が残った実行を通すと、確かめていないのに印だけが新しくなり、次の取り込みからまた日数ぶん回らない(黙った飛ばし)。
 * そこで未実施の部分を全部赤にする(署名も含む。取り込みの台本は依存を入れた木で回すので、出荷の関門と違って許す部分を持たない)。
 * lockfile が 1 本も見つからないときも赤(何も確かめていない)。待ちの警告は手元と同じ警告のまま(版を上げた直後の取り込みを止めない)。
 *
 * @param report `runDepsCheck` の結果
 * @returns 判定に直した結果(`ok` と `summary.red` を数え直す。記録にもこの結果を書くので、未実施の残った実行は鮮度の印にならない)
 */
export function applyCompleteRun(report: DepsReport): DepsReport {
  const notes: string[] = [];
  if (report.lockfiles.length === 0) notes.push('全部を確かめる実行: lockfile が 1 本も見つかりません(何も確かめていない)');
  for (const lockfile of report.lockfiles) {
    for (const [name, part] of Object.entries(lockfile.parts) as [PartName, (typeof lockfile.parts)[PartName]][]) {
      if (part.status === 'unavailable') notes.push(`全部を確かめる実行: ${lockfile.path} の ${name} が未実施です(${part.reason ?? '理由なし'})。確かめられないまま鮮度の印を新しくしない`);
    }
  }
  const red = report.summary.red + notes.length;
  return { ...report, notes: [...report.notes, ...notes], summary: { ...report.summary, red }, ok: red === 0 };
}
