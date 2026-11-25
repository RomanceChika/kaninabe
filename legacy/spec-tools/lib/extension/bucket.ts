/**
 * 警告の区分(受け入れた危険 / 拡張候補 / 未分類)を決める純関数。
 *
 * **受け入れた危険**は、仕様の側が理由つきで「外す」と宣言した結果の警告である(`Finding.acceptance`。例: 多要素認証の
 * `mfa: { exempt: 理由 }`)。理由は宣言の側が持ち、宣言の実在と理由が空でないことは W5 が見る。台帳の候補より先に判定する。
 *
 * それ以外の警告は、台帳のどの拡張候補に当たるかを決める。当たる条件は 2 つで、**両方**を満たすこと。
 *
 *   1. 候補の `rules` に、その警告を出した検査の ID が入っている
 *   2. 候補が `scope`(絞りの鍵)を持つなら、警告がその絞りに収まる(`scope.ts`)。鍵が無ければ検査の全体
 *
 * どの候補にも当たらない警告は**未分類**である。区分は警告の性質を変えない —— 警告は警告のまま数え、
 * ここが決めるのは「仕組みの宿題として台帳に載っているか」だけである。
 *
 * 検査が理由の混ざる警告を出す(T2 の「引かれない索引」は仕組みの表にも製品の表にも出る)なら、候補に
 * `scope` を付けて、**候補の言い分に当たる分だけ**に絞る。絞らずに検査 ID の全体で当てると、仕様を書く人が
 * 消すべき警告が「読まなくてよい側」へ落ちる。
 *
 * 台帳が読めない・無いときは、警告はすべて未分類になる(台帳を持たない構成で、警告を黙って分類済みにしない)。
 * 受け入れた危険も同じく未分類に倒す —— 宣言との突合(W5)が回らないので、受け入れを確かめられない。
 */

import type { Finding } from '../kernel/finding.js';
import { scopeAdmits } from './scope.js';
import type { ExtensionCandidate, ExtensionLedger } from '../model/extension/types.js';

/** 警告の区分。 */
export type FindingBucket =
  | { readonly kind: 'accepted'; readonly reason: string }
  | { readonly kind: 'extension'; readonly candidate: ExtensionCandidate }
  | { readonly kind: 'unclassified' };

/**
 * 警告 1 件が候補に当たるか(検査 ID が `rules` にあり、候補の絞りに収まる)。
 *
 * @param candidate 台帳の候補
 * @param finding 検証の結果 1 件(severity は見ない。区分を持つのは warning だけなので呼び側が絞る)
 */
export function candidateHit(candidate: ExtensionCandidate, finding: Finding): boolean {
  // 受け入れた危険は候補に当てない(区分は宣言が決める。台帳の宿題に数えない)
  if (finding.acceptance !== undefined) return false;
  return candidate.rules.includes(finding.verifier) && scopeAdmits(candidate.scope, finding);
}

/**
 * 警告が当たる拡張候補(重なりは W5 が error にするので、先に当たったものを返す)。
 *
 * @param finding 検証の結果 1 件
 * @param ledger 台帳(無ければ null)
 * @returns 当たる候補。無ければ undefined
 */
export function candidateOf(finding: Finding, ledger: ExtensionLedger | null): ExtensionCandidate | undefined {
  return ledger?.candidates.find((candidate) => candidateHit(candidate, finding));
}

/**
 * 警告 1 件の区分。
 *
 * @param finding 検証の結果 1 件
 * @param ledger 台帳(無ければ null)
 * @returns 警告なら区分。error は区分を持たないので null
 */
export function bucketOf(finding: Finding, ledger: ExtensionLedger | null): FindingBucket | null {
  if (finding.severity !== 'warning') return null;
  if (ledger !== null && finding.acceptance !== undefined) return { kind: 'accepted', reason: finding.acceptance.reason };
  const candidate = candidateOf(finding, ledger);
  return candidate === undefined ? { kind: 'unclassified' } : { kind: 'extension', candidate };
}

/** 区分を人が読む言い方にする(`受け入れた危険 — 理由` / `拡張候補 X-derived-columns` / `未分類`)。 */
export function bucketLabel(bucket: FindingBucket): string {
  if (bucket.kind === 'accepted') return `受け入れた危険 — ${bucket.reason}`;
  return bucket.kind === 'extension' ? `拡張候補 ${bucket.candidate.id}` : '未分類';
}

/** 区分ごとの件数。 */
export interface BucketCounts {
  /** 受け入れた危険の件数(仕様が理由つきで外した結果の警告)。 */
  readonly accepted: number;
  /** 拡張候補に当たる警告の件数。 */
  readonly extension: number;
  /** 未分類の警告の件数。 */
  readonly unclassified: number;
}

/**
 * 警告の件数を区分ごとに数える(error は数えない)。
 *
 * @param findings 検証の全結果
 * @param ledger 台帳(無ければ null)
 */
export function bucketCounts(findings: readonly Finding[], ledger: ExtensionLedger | null): BucketCounts {
  let accepted = 0;
  let extension = 0;
  let unclassified = 0;
  for (const finding of findings) {
    const bucket = bucketOf(finding, ledger);
    if (bucket === null) continue;
    if (bucket.kind === 'accepted') accepted += 1;
    else if (bucket.kind === 'extension') extension += 1;
    else unclassified += 1;
  }
  return { accepted, extension, unclassified };
}

/**
 * 件数の内訳を人が読む言い方にする(`拡張候補 M / 未分類 K`。受け入れた危険があれば `受け入れた危険 A / ` を前に足す)。
 *
 * @param counts 区分ごとの件数
 */
export function bucketBreakdown(counts: BucketCounts): string {
  const accepted = counts.accepted === 0 ? '' : `受け入れた危険 ${String(counts.accepted)} / `;
  return `${accepted}拡張候補 ${String(counts.extension)} / 未分類 ${String(counts.unclassified)}`;
}

/** 候補 1 件と、それに当たる警告。 */
export interface CandidateHits {
  readonly candidate: ExtensionCandidate;
  readonly hits: readonly Finding[];
}

/**
 * 台帳の候補ごとに、当たる警告を集める(台帳の宣言順)。
 *
 * @param findings 検証の全結果(warning だけが当たる)
 * @param ledger 台帳
 */
export function hitsByCandidate(findings: readonly Finding[], ledger: ExtensionLedger): readonly CandidateHits[] {
  return ledger.candidates.map((candidate) => ({
    candidate,
    hits: findings.filter((finding) => finding.severity === 'warning' && candidateHit(candidate, finding)),
  }));
}
