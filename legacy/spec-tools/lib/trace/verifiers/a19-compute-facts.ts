/**
 * A19 計算の材料 —— `computes` の純関数に届く事実が宣言されている(束 ㉒)。
 *
 * ## 何が黙って通っていたか
 *
 * `computes` は「入力に無いが実行時に純関数が決める値」の宣言である。その純関数が受け取るのは
 * **その計画が読んだ事実(`reads`)と入力**だけであり、それ以外の材料は原理的に届かない。
 * ところが計画が読む欄は、宣言が無かったあいだ**ガード式・ロールの binding・予測状態・結果の
 * id** が要求したものだけだった —— 計算の材料は 1 欄も積まれず、しかも V18(欄が実在し・入力に
 * 無く・書いてよい欄か)も A15(計画が組めたか)も、そのことを 1 件も言わなかった。
 *
 * 実測は 2 件ある(`docs/design/triage-computes-reads.md`)。
 *   - 題材の製品: 確定後の申告の直しで料金を引き直す計算に、材料の 12 欄が 1 つも届かない
 *   - 明細の総和を持つ題材: 「明細の総和」と宣言した合計金額の欄があるのに、
 *     計画の `reads` に明細は 1 行も入らない
 *
 * ## この検査が見る 3 つ
 *
 * | 何を | severity | なぜ |
 * |---|---|---|
 * | `reads` の `{entity}.{field}` が entity_spec に実在する | error | 綴りの違う宣言は材料を運ばない |
 * | `reads` の欄が**その操作の計画の `reads` に載る** | error(子の行の集合を材料にする形だけ warning) | 読めない集約を宣言しても届かない |
 * | 計算が `reads` を**1 本も宣言していない** | warning | 材料が届いていないことが読めない |
 *
 * **「材料が足りている」ことは機械には言えない。** 言えるのは「宣言した材料が届くか」と
 * 「材料の宣言が 1 本も無いか」までである(純関数の中身は DSL の外にあり、何を使うかは
 * 読めない)。`reads` はその中身を宣言の側に出す欄であり、この検査はその宣言が**嘘でない**
 * ことと、**宣言が無いこと自体が見える**ことを受け持つ。
 *
 * ## 買えなかったもの(明細の総和を持つ題材が踏み続ける形)
 *
 * 明細の総和の欄の材料は**行の集合**であり、計画の読み取りは 1 集約 1 行
 * なので宣言しても届かない。集合の読み取りは別の買い物であり、買っていない。
 *
 * 届かない理由が「**対象の集約を親とする子の行の集合だから**」と構造で言えるときに限り、error ではなく
 * **理由 `child_set_read` つきの warning**にする(拡張候補 X-child-set-reads。台帳が「仕組みの宿題」として数える)。
 * 構造で言えるのは、子が対象を `context` / `ref` で参照し・**対象の側に子への道が無く**・子の親への参照が
 * **一意でない**ときだけである(判定は `lib/trace/compute-child-set.ts`)。親の側に道があれば 1 行に絞れる
 * (製品が `context` を足せば直せる)ので error のまま、1:1 は集合ではなく 1 行なので error のまま。
 * 仕様が真実(明細の総和を材料に宣言する)を言えるようにし、穴の所在は verify の出力に残る。
 * **それ以外の到達できない材料は従来どおり error**。生成器はどちらの場合もその材料を計画に積まない。
 *
 * ## `runner: manual` の操作は計画を持たない
 *
 * 宣言された例外(定型では組み立てられない操作)には実行計画が無く、純関数を呼ぶのは手書きの
 * operation である。そこには「届かない」という状態が無いので、計画を母集合とする 2 つは見ない
 * (欄の実在は見る —— 綴りの誤りはどちらでも嘘である)。手書きの側の突合は A11 / A14 が持つ。
 */

import type { Finding, PartialInputTraceVerifier, PartialRun } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import { dataTablesGap, dataTablesOf, jobModelOf, jobsBlockedOf, jobsGaps, type TraceInput } from '../input.js';
import type { ActionComputeDecl, ActionComputeReadRef, ActionSpec } from '../../model/trace/types.js';
import { findField } from '../../semantics/domain-index.js';
import { isChildSetRead } from '../compute-child-set.js';
import { A19_REASONS } from '../compute-reasons.js';
import type { BuiltOperation, OperationBuildResult } from '../../usecase/operation-plan.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import { buildOperationPlans } from '../../usecase/operation-plan.js';

/**
 * A19: 計算の材料が宣言され、計画に届くことを検証する。
 *
 * **一部だけジョブカタログに依る検査**である(A15 と同じ理由)。計画が組めるかは副作用の種別に依るので、
 * カタログが阻害のとき、副作用を持つ操作の「材料が計画に届くか」は判定できない —— 届くかを見る計画そのものが
 * 組めたか分からないからである。その操作の判定は出さず `gaps` で報告する。綴りの誤り(`reads` の欄の実在)は
 * 計画に依らないので阻害でも出す。
 *
 * **計画の組み立ては、テーブル仕様にも依る**(定型 RPC の引数を読んで接地する)。未選択・阻害のとき、材料が計画に届くかの
 * 判定は出さず、見ていないことを `gaps` で報告する(以前は黙って何も言わなかった)。
 */
export const computeFactsVerifier: PartialInputTraceVerifier = {
  id: 'A19',
  title: '計算の材料 — computes が読む事実が宣言され、計画に届く',

  verify: (input) => computeFactsRun(input).findings,
  runPartial: computeFactsRun,
};

/** 検査の本体(違反と、判定を出さなかった対象を返す)。 */
function computeFactsRun(input: TraceInput): PartialRun {
  const withComputes = input.actions.actions.filter((action) => action.computes.length > 0);
  if (withComputes.length === 0) return { findings: [], gaps: [] };
  const findings: Finding[] = [];
  for (const action of withComputes) findings.push(...missingFields(input, action));
  // 計画の組み立て(材料が届くかの判定)はテーブル仕様に依る。使えない(未選択・阻害)なら判定は出さず、見ていないことを
  // 報告する(対象は計画を持つ = runner: manual でない操作)。綴りの誤り(上)は計画に依らないので出している。
  const dataTables = dataTablesOf(input);
  if (dataTables === undefined) {
    const planned = withComputes.filter((action) => action.runner === undefined).map((action) => action.handles.raw);
    const gap = planned.length === 0 ? null : dataTablesGap(input, 'computes の材料が実行計画に届くか(reads の到達)は見ていません', planned);
    return { findings, gaps: gap === null ? [] : [gap] };
  }
  const built = builtPlans(input, dataTables);
  if (built === null) return { findings, gaps: [] };
  const plans = new Map(built.operations.map((operation) => [operation.op, operation]));
  for (const action of withComputes) {
    const plan = plans.get(action.handles.raw);
    if (plan === undefined) continue; // runner: manual / 計画が組めない操作(A15 が見る)/ 判定を出さなかった操作
    findings.push(...unreachableReads(input, action, plan, dataTables));
    findings.push(...undeclaredMaterial(action, plan));
  }
  const declared = new Set(withComputes.map((action) => action.handles.raw));
  return {
    findings,
    // runner: manual の操作は計画を持たないので、この検査は元から計画の到達を見ない(出さなかった判定ではない)。
    gaps: jobsGaps(
      input,
      built.undecided.filter((entry) => !entry.manual && declared.has(entry.op)).map((entry) => entry.op),
    ),
  };
}

/** 組み立ての結果。ガード式のパーサーが無い環境(接地できない)では null。 */
function builtPlans(input: TraceInput, dataTables: DataTableSpecModel): OperationBuildResult | null {
  const guards = input.guards;
  if (guards === undefined) return null;
  return buildOperationPlans({
    domain: input.domain,
    guards,
    actions: input.actions,
    dataTables,
    jobs: jobModelOf(input),
    jobsBlocked: jobsBlockedOf(input),
  });
}

/** `reads` が指す欄が entity_spec に実在しない(綴りの誤り)。 */
function missingFields(input: TraceInput, action: ActionSpec): Finding[] {
  const findings: Finding[] = [];
  for (const decl of action.computes) {
    for (const read of decl.reads) {
      if (findField(input.domain, read.entity, read.field) !== null) continue;
      findings.push(
        traceFinding('A19', {
          severity: 'error',
          message: `${action.handles.raw} の computes(${decl.raw})が読む ${read.raw} は entity_spec に実在しません`,
          location: read.location,
          suggestion: `${read.entity} の entity.md に ${read.field} を足すか、reads の綴りを直す`,
          counterexample: { operation: action.handles.raw, compute: decl.raw, reads: read.raw },
        }),
      );
    }
  }
  return findings;
}

/** 宣言した材料が計画の `reads` に載らない(その集約をその計画からは読めない)。 */
function unreachableReads(
  input: TraceInput,
  action: ActionSpec,
  plan: BuiltOperation,
  dataTables: DataTableSpecModel,
): Finding[] {
  const reached = new Set(
    plan.facts.reads.flatMap((read) => read.fields.map((field) => `${read.entity}.${field}`)),
  );
  const findings: Finding[] = [];
  for (const decl of action.computes) {
    for (const read of decl.reads) {
      if (findField(input.domain, read.entity, read.field) === null) continue; // 上で報告済み
      if (reached.has(read.raw)) continue;
      findings.push(
        isChildSetRead(input.domain, dataTables, decl.entity, read.entity)
          ? childSetFinding(action, decl, read)
          : unreachableFinding(action, decl, read, plan),
      );
    }
  }
  return findings;
}

/** 子の行の集合を材料に宣言した 1 件の警告(計画に積めない。理由は `child_set_read`)。 */
function childSetFinding(action: ActionSpec, decl: ActionComputeDecl, read: ActionComputeReadRef): Finding {
  return {
    ...traceFinding('A19', {
      severity: 'warning',
      message:
        `${action.handles.raw} の computes(${decl.raw})が読む ${read.raw} は ${decl.entity} の子の行の集合で、` +
        '実行計画に積めません',
      location: read.location,
      suggestion:
        '仕組みが子の集合を計画に積めない(拡張候補 X-child-set-reads)。純関数にはこの材料が渡らないので、' +
        '渡るまでは入力から計算するか手書き(runner: manual)にする',
      counterexample: {
        operation: action.handles.raw,
        compute: decl.raw,
        reads: read.raw,
        parent: decl.entity,
      },
    }),
    reason: A19_REASONS.childSetRead,
  };
}

/** 到達できない材料 1 件の指摘。 */
function unreachableFinding(
  action: ActionSpec,
  decl: ActionComputeDecl,
  read: ActionComputeReadRef,
  plan: BuiltOperation,
): Finding {
  const reads = plan.facts.reads.map((entry) => entry.entity).join(' / ');
  return traceFinding('A19', {
    severity: 'error',
    message: `${action.handles.raw} の computes(${decl.raw})が読む ${read.raw} は実行計画から読めません`,
    location: read.location,
    suggestion:
      `${read.entity} の行を 1 行に絞る手がかりが計画にない。対象の集約(または入力が id を指す集約)の ` +
      'entity_spec に context を宣言して 1 段で辿れるようにするか、その材料を使わない形に計算を' +
      '変える。**行の集合を読む材料(子の明細の総和など)はこの形では宣言できない** —— ' +
      '1 集約 1 行の読み取りが計画の読み取りの全部である',
    counterexample: {
      operation: action.handles.raw,
      compute: decl.raw,
      reads: read.raw,
      reached: reads === '' ? '(なし)' : reads,
    },
  });
}

/**
 * 材料の宣言が 1 本も無い(計画で走る操作)。
 *
 * 純関数に渡るのは**その計画が読んだ事実と入力**だけであり、宣言が無ければ材料として積まれる
 * 欄は 0 である(たまたまガードやロールが読んだ欄が混じるだけで、それは計算のための宣言では
 * ない)。入力だけから決まる計算なら宣言は要らないが、**要らないことが読めない**ので宣言する。
 */
function undeclaredMaterial(action: ActionSpec, plan: BuiltOperation): Finding[] {
  const bare = action.computes.filter((decl) => decl.reads.length === 0);
  if (bare.length === 0) return [];
  const refs = [...new Set(bare.map((decl) => decl.ref))].join(' / ');
  const incidental = plan.facts.reads.flatMap((read) => read.fields.map((field) => `${read.entity}.${field}`));
  return [
    traceFinding('A19', {
      severity: 'warning',
      message: `${action.handles.raw} の計算(${refs})は読む事実を 1 つも宣言していません`,
      location: bare[0]?.location ?? action.location,
      suggestion:
        'その計算が読む行の欄を computes[].reads に並べる(並べなければ計算のために積まれる欄は 0 で、' +
        '純関数はガードやロールがたまたま読んだ欄と入力しか見られない)。入力だけから決まる計算なら' +
        'このままでよい —— この警告は「宣言が無い」ことを出力に残すためのものである',
      counterexample: {
        operation: action.handles.raw,
        computes: refs,
        incidental: incidental.length === 0 ? '(なし)' : incidental.join(' / '),
      },
    }),
  ];
}
