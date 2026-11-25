/**
 * 依存の脆弱性の検査の本体(`npm run deps:check`)。設計の正は依存の脆弱性への対応の設計メモ。
 *
 * lockfile ごとに ①`npm audit` ②OSV ③`npm audit signatures` ④公開日時の待ち(+ 登録簿の integrity との突き合わせ)を回し、通信不要の ⑤配信元と固定(`lockfile-pins`)も見て、受け入れ表を当てて 1 つの結果にする。
 * ⑤と許さない lockfile の存在は、通信なしで `npm ci` の前に回せる口(`offline.ts`・`deps:check:offline`)にも同じ関数で出る。
 * **通信できない部分は「未実施」と名指して記録し、落とさない**(落とすのは見つかった赤だけ)。
 * 「未実施」は**通信の失敗だけ**である。lockfile が読めない(JSON でない・v1・`packages` 無し)のは `npm ci` が入れるのに検査が読めない形で、
 * 赤にする(4 回目 C4-4)。登録簿に無い名前・版(404)も赤(C4-5。自己申告の名前で全体の待ちを「未実施」にさせない)。
 */

import { applyAccepted, parseAcceptedTable } from './accepted.js';
import { runAudit } from './audit.js';
import { discoverForeignLockfiles, discoverLockfiles, lockfileDigest, parseLockedPackages } from './lockfile.js';
import { mergeAdvisories, runOsv } from './osv.js';
import { declaredLocalTargets } from './lockfile-local.js';
import { lockfilePinFindings } from './lockfile-pins.js';
import { foreignLockfileFinding } from './offline.js';
import { cooldownFindings, fetchPublishTimes, integrityMismatchFindings, registryMissingFindings, runSignatures } from './signatures.js';
import { ACCEPTED_FILE } from './types.js';
import type { DepsFinding, DepsIo, DepsReport, LockedPackage, LockfileReport, PartName, PartResult } from './types.js';

const UNREADABLE: PartResult = { status: 'unavailable', reason: 'lockfile を読めません(赤として数えた)' };

/**
 * 検査を回す。
 *
 * @param io 外への口
 * @param rootAbs 製品の根の絶対パス
 */
export async function runDepsCheck(io: DepsIo, rootAbs: string): Promise<DepsReport> {
  const now = io.now();
  const lockfiles = discoverLockfiles({
    list: io.list,
    isDirectory: io.isDirectory,
    isFile: (rel) => io.readText(rel) !== null,
  });
  const reports: LockfileReport[] = [];
  const findings: DepsFinding[] = [];
  // package-lock.json 以外の lockfile(npm-shrinkwrap.json は package-lock.json より優先される)は、置かれていること自体を赤にする(5 回目 C5-2)。
  for (const foreign of discoverForeignLockfiles({ list: io.list, isDirectory: io.isDirectory, isFile: (rel) => io.readText(rel) !== null })) {
    findings.push(foreignLockfileFinding(foreign));
  }
  const locked = new Map<string, readonly LockedPackage[]>();

  for (const lockfile of lockfiles) {
    const text = io.readText(lockfile) ?? '';
    const packages = parseLockedPackages(text);
    const sha256 = lockfileDigest(text);
    if (packages === null) {
      // 形の赤(lockfile-shape)を 1 件。読めない lockfile の audit / OSV / 署名 / 待ちは回せない(未実施と並べて出す)。
      findings.push(...lockfilePinFindings(lockfile, text));
      reports.push({ path: lockfile, sha256, packages: 0, parts: { audit: UNREADABLE, osv: UNREADABLE, signatures: UNREADABLE, cooldown: UNREADABLE } });
      continue;
    }
    locked.set(lockfile, packages);
    // 配信元と固定(通信不要)。待ちの検査から外すだけでなく、公式でない取得元・integrity の欠けは赤にする。
    findings.push(...lockfilePinFindings(lockfile, text, declaredLocalTargets(io, lockfile)));
    const audit = await runAudit(io, lockfile, rootAbs);
    const osv = await runOsv(io, lockfile, packages);
    const signatures = await runSignatures(io, lockfile, rootAbs);
    findings.push(...mergeAdvisories(audit.findings, osv.findings, packages), ...signatures.findings);
    reports.push({ path: lockfile, sha256, packages: packages.length, parts: { audit: audit.part, osv: osv.part, signatures: signatures.part, cooldown: { status: 'done' } } });
  }

  // 公開日時は名前ごとに 1 度だけ引く(lockfile をまたぐ)。
  const names = [...locked.values()].flatMap((list) => list.filter((p) => p.fromRegistry).map((p) => p.name));
  const publish = await fetchPublishTimes(io, names);
  for (const [lockfile, packages] of locked) {
    findings.push(
      ...cooldownFindings(lockfile, packages, publish.times, now, publish.versions),
      ...integrityMismatchFindings(lockfile, packages, publish.integrities),
      ...registryMissingFindings(lockfile, packages, publish),
    );
  }
  const withCooldown = reports.map((report) => (locked.has(report.path) ? { ...report, parts: { ...report.parts, cooldown: publish.part } } : report));

  const table = parseAcceptedTable(io.readText(ACCEPTED_FILE));
  const today = now.toISOString().slice(0, 10);
  const unused = applyAccepted(findings, table.entries, today);
  const notes = [
    ...table.problems,
    ...unused.map((entry) => `受け入れ表: ${entry.kind} ${entry.target}(${entry.pkg})は今回どの指摘にも当たりませんでした${today > entry.reviewBy ? '(期限切れ)' : ''} — 不要なら消す`),
  ];

  const count = (level: string): number => findings.filter((f) => f.level === level).length;
  const parts: PartName[] = ['audit', 'osv', 'signatures', 'cooldown'];
  const unperformed = withCooldown.reduce((sum, report) => sum + parts.filter((part) => report.parts[part].status === 'unavailable').length, 0);
  const red = count('red') + table.problems.length;
  return {
    version: 1,
    generatedAt: now.toISOString(),
    lockfiles: withCooldown,
    findings,
    notes,
    summary: { red, warning: count('warning'), accepted: count('accepted'), unperformed },
    ok: red === 0,
  };
}
