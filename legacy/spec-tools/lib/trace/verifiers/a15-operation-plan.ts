/**
 * A15 操作の実行計画が仕様から決まる(ADR-0012 ④ / 束 ⑰)。
 *
 * Y10 が「保存点の `permit` が要る値」を見るのに対し、A15 は**単発の操作 1 本ごと**に同じ問いを
 * 立てる ——「この操作を仕様だけから実行できるか」である。決まらない操作は、そこに
 * **仕様に無い知識が実装にある**ということであり、`operation-plans.ts` に載らない。
 *
 * ## error である(束 ⑰-2 で格上げ)
 *
 * 生成に乗らない操作(規約に乗らない引数を持つ RPC を呼ぶもの・写しの作成や一斉遷移のように
 * 同一トランザクションで別表を書くもの)は、action_spec に `runner: manual`(理由つき)を
 * 宣言して手書きのまま残す。束 ⑰-1 のあいだは宣言が 1 本も無かったので warning で一覧を
 * 出すことに徹していたが、⑰-2 で全数の宣言が済んだ。
 *
 * したがっていまの A15 の意味は「**`runner` の無い操作は必ず計画が導出できる**」である ——
 * 宣言されていない例外はひとつも残らない。導出できない操作を足したら、仕様を直すか
 * `runner: manual` を理由つきで宣言するかの二択になる(黙って手書きを増やす道が無い)。
 *
 * ## 逆向きも見る(束 ⑰-3)
 *
 * 宣言した操作の導出を**試みない**と、「面倒だから `runner: manual` と書く」が黙って通る ——
 * 宣言された例外が、理由文つきの免除リストに退化する。そこで manual の操作も同じ導出器に
 * かけ、**導出できてしまったら error** にする(「`runner` を外すこと」)。これで
 * 「手書きでよいのは定型では書けないものだけ」が両方向から閉じる。
 *
 * ただし「導出できた」=「計画だけで走りきれる」ではない。機械が見える範囲で**計画では
 * 足りない**と分かる印が 2 つあり、そのどちらかを持つ操作は逆向きの指摘から外れる。
 *   - 自集約の外を参照する application 執行の不変条件(入力だけを見る hooks では判定できない)
 *   - `errors.additional` が**実行器の返す結末の値域の外**の失敗を契約にしている
 *     (定型の外で何かを実行している。外部連携がその代表)
 * どちらも仕様側の宣言であり、ここに操作ごとの分岐は無い。
 *
 * 2 つ目は束 ⑰-3b で締め直した —— それまでは「`additional` が空でない」だけを見ていたので、
 * 実行器が既に返す名前を 1 行書き足すだけでこの検査を黙らせられた(独立レビュー 4-A)。
 */

import type { Finding, PartialInputTraceVerifier, PartialRun } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import { dataTablesGap, dataTablesOf, jobModelOf, jobsBlockedOf, jobsGaps, type TraceInput } from '../input.js';
import type { ManualOperation } from '../../usecase/operation-plan.js';
import { buildOperationPlans } from '../../usecase/operation-plan.js';
import { specPath } from '../../model/product/paths.js';

/**
 * A15: 単発の操作の実行計画が仕様から決まることを検証する。
 *
 * **一部だけジョブカタログに依る検査**である。副作用を持つ操作は、その副作用が「同一トランザクションで実現される
 * 種別」のジョブかどうかで定型 RPC で組めるかが変わる。カタログを採っているのに渡せない(阻害)とき、その操作の
 * 判定(計画が組めない指摘と「runner: manual が要らない」の逆向きの指摘)は**出さず**、`gaps` で報告する。
 * 欠けたカタログを「ジョブが無い」と読んで、見ていない事実から「導出できる」「manual は要らない」を導かない。
 * ジョブに依らない判定(接地・引数・事実の段の指摘と、副作用を持たない操作の判定)は阻害でも従来どおり出す。
 *
 * **テーブル仕様は検査の全体が依る**(計画の接地が定型 RPC の引数を読む)。未選択・阻害のとき判定は 1 つも出せないので、
 * 出さず、見ていないことを `gaps` で報告する(以前は黙って何も言わなかった)。
 */
export const operationPlanVerifier: PartialInputTraceVerifier = {
  id: 'A15',
  title: '操作の実行計画 — runner の無い操作は仕様だけから実行できる',

  verify: (input) => operationPlanRun(input).findings,
  runPartial: operationPlanRun,
};

/** 検査の本体(違反と、判定を出さなかった対象を返す)。 */
function operationPlanRun(input: TraceInput): PartialRun {
  // テーブル仕様が使えない(未選択・阻害)と接地そのものができない。**黙って通らず**、見ていないことを報告する
  // (未選択は「定型 RPC の引数が接地できるか」を見ていない = 採っていない製品の事実ではなく、検査の範囲の縮み)。
  const dataTables = dataTablesOf(input);
  const tablesGap = dataTablesGap(input, '操作の実行計画が仕様から決まるか(runner の無い操作の導出・runner: manual の逆向きの指摘)は見ていません');
  if (dataTables === undefined) return { findings: [], gaps: tablesGap === null ? [] : [tablesGap] };
  // ガード式のパーサーが無い環境(テストヘルパ)でも接地できない。パーサーはカタログではないので黙って何もしない。
  const guards = input.guards;
  if (guards === undefined) return { findings: [], gaps: [] };
  const built = buildOperationPlans({
    domain: input.domain,
    guards,
    actions: input.actions,
    dataTables,
    jobs: jobModelOf(input),
    jobsBlocked: jobsBlockedOf(input),
  });
  const byOp = new Map<string, string[]>();
  for (const problem of built.problems) {
    byOp.set(problem.op, [...(byOp.get(problem.op) ?? []), problem.problem.message]);
  }
  return {
    findings: [
      ...[...byOp.entries()].map(([op, messages]) => finding(input, op, messages)),
      ...built.manual.filter((entry) => entry.derivable).map((entry) => needlessRunnerFinding(input, entry)),
    ],
    gaps: jobsGaps(
      input,
      built.undecided.map((entry) => entry.op),
    ),
  };
}

/**
 * 計画が導出できるのに `runner: manual` を宣言している(束 ⑰-3)。
 *
 * 宣言された例外は「定型では書けない」ことの宣言であって、手書きを残す口ではない。
 * ここを見ないと、宣言が増えるほど生成の検査の範囲が静かに縮む。
 */
function needlessRunnerFinding(input: TraceInput, entry: ManualOperation): Finding {
  const action = input.actions.actions.find((candidate) => candidate.handles.raw === entry.op);
  return traceFinding('A15', {
    severity: 'error',
    message: `${entry.op} は実行計画が導出できるのに runner: manual を宣言しています`,
    location: action?.location ?? { file: specPath(input.roots, 'backend/actions') },
    suggestion:
      'action_spec から runner の宣言を外して生成物に載せる(Server Action と Composition Root が ' +
      '生成され、手書きの operation は消える)。宣言が要るのは定型では組み立てられない操作だけである',
    counterexample: { operation: entry.op, reason: entry.reason },
  });
}

/** 操作 1 本ぶんの指摘(理由はその操作について出た全部をまとめる)。 */
function finding(input: TraceInput, op: string, messages: readonly string[]): Finding {
  const action = input.actions.actions.find((candidate) => candidate.handles.raw === op);
  return traceFinding('A15', {
    severity: 'error',
    message: `${op} の実行計画が仕様から決まりません(${messages.length} 件)`,
    location: action?.location ?? { file: specPath(input.roots, 'backend/actions') },
    suggestion:
      '定型 RPC の引数が規約(usecase-spec-writing.md §引数名 → 供給元)に載る形になるよう ' +
      'data_table と action_spec の input を揃えるか、入力に無い値なら entity_spec に ' +
      'supplied_by: db を宣言するか action_spec に computes を宣言する。定型に乗らない RPC で' +
      '実現している操作なら action_spec に "runner: { kind: manual, reason: ... }" を宣言して' +
      '手書きのまま残す(宣言された例外だけが手書きでよい)',
    counterexample: { operation: op, reasons: messages.join(' / ') },
  });
}
