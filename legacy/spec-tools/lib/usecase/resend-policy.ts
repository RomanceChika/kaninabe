/**
 * 作成の**冪等な再送**の方針を、表の宣言(data_table の `resend`)から 1 か所で引く。
 *
 * 再送の枝は 2 か所にある —— 単発の作成 RPC(`sql/rpc-body-refusal.ts` の `createRefusalBlock`)と、
 * その表を錨にする複合 RPC の先頭(`generate/render/code-usecase-rpc.ts` の `resendBlock`)。
 * どちらも**同じ表の同じ答え**を使う(片方だけ既存の行を返すと、もう片方の経路から同じ行が漏れる)。
 *
 * 方針は 3 つしか無い。
 *
 * | 宣言 | 方針 | 再送の枝 |
 * |---|---|---|
 * | `returns_existing: true` + `creator` | `own` | 作成者の欄が実行者と一致する行だけを返す。一致しなければ中身を返さず競合(`UC409`) |
 * | `returns_existing: true`(`creator` なし) | `recorded` | その作成の監査ログの行(同じ id・同じ操作)の実行者が今回の実行者と一致する行だけを返す(点検 20 回目 B20-1)。一致しなければ中身を返さず競合(`UC409`) |
 * | `returns_existing: false` | `conflict` | 既存の行を返さない。同じ id の行があれば常に競合(`UC409`) |
 *
 * 返す 2 つの方針は、同じ鍵で**入力が違う**再送を返さず拒否の語で断る(本文は `sql/rpc-resend.ts`)。
 *
 * **書いていなければ方針は無い**(既定を置かない)。呼び側は問題(3 点セット)を検査器の指摘にし
 * (T6 / Y12)、生成器はその検査器を名指して止まる。`creator` は**作成のその呼び出しが実行者そのもので
 * 埋める列**でなければならない —— 入力から読む列や、作った後に別の操作が書く列を名指すと、
 * 「作成者」の意味が崩れる(入力から読む列には、作った人とは別の人の id が入りうる)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataResendDecl, DataTableSpec } from '../model/data/types.js';
import type { PlanProblem, SavePlan, SaveStepPlan } from './step-plan.js';
import type { ResolvedParam } from './param-source.js';

/** 監査の実行者の引数(行の列ではない)。 */
const ACTOR_ID_PARAM = 'p_actor_id';

/** 再送の方針。 */
export type ResendPolicy =
  /** 作成者の欄が実行者と一致する行だけを返す。 */
  | { readonly kind: 'own'; readonly creator: string }
  /** その作成の監査ログの実行者が今回の実行者と一致する行だけを返す(作成者の欄を持たない表)。 */
  | { readonly kind: 'recorded' }
  /** 既存の行を返さない(同じ id があれば競合)。 */
  | { readonly kind: 'conflict' };

/** 方針を引いた結果。 */
export type ResendPolicyResult =
  | { readonly ok: true; readonly policy: ResendPolicy }
  | { readonly ok: false; readonly problem: PlanProblem };

/** 方針を引くのに要る入力。 */
export interface ResendPolicyInput {
  /** 作成の行が入る表(宣言の持ち主)。 */
  readonly table: Pick<DataTableSpec, 'table' | 'relPath'> & { readonly resend?: DataResendDecl };
  /** 誰の再送の枝か(関数名・保存点。反例と文言に使う)。 */
  readonly subject: string;
  /** その作成の呼び出しが**実行者そのもの**で埋める列(宣言順。action_spec の `owner`・ユースケースの `defaults.self` で明示した欄だけ)。 */
  readonly actorColumns: readonly string[];
}

/**
 * 表の宣言から再送の方針を引く。
 *
 * @param input 表・誰の枝か・実行者で埋まる列
 * @returns 方針、または宣言の欠落・作成者の欄の誤りの問題(3 点セット)
 */
export function resendPolicyOf(input: ResendPolicyInput): ResendPolicyResult {
  const decl = input.table.resend;
  if (decl === undefined) return { ok: false, problem: undeclared(input) };
  if (!decl.returnsExisting) return { ok: true, policy: { kind: 'conflict' } };
  const creator = decl.creator;
  if (creator === undefined) return { ok: true, policy: { kind: 'recorded' } };
  if (!input.actorColumns.includes(creator)) return { ok: false, problem: notActorColumn(input, creator) };
  return { ok: true, policy: { kind: 'own', creator } };
}

/** 宣言が無い(黙って実行者を問わない枝を出さない)。 */
function undeclared(input: ResendPolicyInput): PlanProblem {
  return {
    message:
      `${input.subject} は ${input.table.table} に行を作りますが、${input.table.relPath} に resend の宣言がありません ——` +
      '同じ id の再送で既存の行を返してよいかが決まりません(返すなら、返してよいのは実行者が作った行だけです)',
    suggestion:
      `${input.table.relPath} に resend を書く。作成者の欄があるなら "resend: { returns_existing: true, creator: {列} }"` +
      `(候補 = 作成者で埋めると明示された列: ${input.actorColumns.length === 0 ? 'なし' : input.actorColumns.join(' / ')})、` +
      '無いなら "resend: { returns_existing: true }"(監査ログの実行者で確かめて返す)か "resend: { returns_existing: false }"(同じ id があれば競合 UC409 にする)',
    counterexample: { subject: input.subject, table: input.table.table, actorColumns: input.actorColumns.join(', ') },
  };
}

/** 作成者の欄が、作成の呼び出しで実行者そのものに埋まる列ではない。 */
function notActorColumn(input: ResendPolicyInput, creator: string): PlanProblem {
  return {
    message:
      `${input.table.relPath} の resend.creator(${creator})は、${input.subject} が実行者そのもので埋める列ではありません ——` +
      'その列で絞っても「実行者が作った行」にはなりません',
    suggestion:
      (input.actorColumns.length === 0
        ? '作成者で埋めると明示された列が無いので、creator を消す(監査ログの実行者で確かめて返す)。'
        : `creator を作成者で埋めると明示された列(${input.actorColumns.join(' / ')})に直すか、creator を消す(監査ログの実行者で確かめて返す)。`) +
      '作成者で埋まるのは action_spec の owner(またはユースケースの defaults.self)で明示した欄だけで、入力に無い実行者への参照の欄を' +
      '推測で作成者とは見なさない。人が選ぶ欄(代理で作る相手・査閲者など)を creator にしない',
    counterexample: {
      subject: input.subject,
      table: input.table.table,
      creator,
      actorColumns: input.actorColumns.join(', '),
    },
  };
}

/**
 * 錨の表の再送の方針(単発の作成 RPC と同じ表の同じ宣言から引く)。
 *
 * 作成者の欄の候補は、**錨の作成の手順そのもの**が実行者で埋める列だけである(後の遷移が書く
 * 列は「作った人」ではない)。`p_actor_id`(監査の実行者)は行の列ではないので除く。
 * 保存点の読み直しの判定(`save-readback.ts`。検査 Y12 と生成器が共有)が呼ぶ。
 *
 * @param plan 接地済みの保存点
 * @param first 最初の作成の手順(冪等の錨)
 * @param params その手順の解決済み引数
 * @returns 方針、または宣言の欠落・作成者の欄の誤り
 */
export function anchorResend(
  plan: SavePlan,
  first: SaveStepPlan,
  params: readonly ResolvedParam[],
): ReturnType<typeof resendPolicyOf> {
  const actorColumns = params
    .filter((param) => param.source.kind === 'actor' && param.name !== ACTOR_ID_PARAM)
    .map((param) => param.name.slice('p_'.length));
  return resendPolicyOf({
    table: { table: first.table, relPath: first.tableSpecPath ?? `${first.table}.md`, ...(first.resend === undefined ? {} : { resend: first.resend }) },
    subject: `${plan.usecase.name}.${plan.save.id}(最初の作成 ${first.op})`,
    actorColumns,
  });
}

/** 保存点の再送の入力の要約を置く仕組みの表の設計図の名前(`framework-tables.ts`。読み書きの字面は `sql/rpc-resend-digest.ts`)。 */
export const RESEND_DIGEST_FRAMEWORK = 'resend_digests';

/** 保存点の入力の要約を置く表(名前と保持の時間)。 */
export interface ResendDigestTable {
  readonly table: string;
  readonly retentionHours: number;
}

/**
 * 保存点の入力の要約を置く表を引く(`framework: resend_digests` の data_table。無い・保持の時間が無ければ null)。
 *
 * @param tables 全 data_table
 * @returns 表の名前と保持の時間
 */
export function resendDigestTableOf(
  tables: readonly { readonly table: string; readonly framework?: string; readonly retentionHours?: number }[],
): ResendDigestTable | null {
  const found = tables.find((table) => table.framework === RESEND_DIGEST_FRAMEWORK);
  if (found === undefined || found.retentionHours === undefined) return null;
  return { table: found.table, retentionHours: found.retentionHours };
}

/**
 * 保存点が要約の置き場を要るのに、置き場の表が宣言されていない、の問題(要らない・あれば null)。
 *
 * 要るのは、錨の表が再送で既存の行を返す方針(`own` / `recorded`)のときだけである(返さない方針は再送をいつも断るので比べない)。
 * Y12 と生成器が同じこの 1 本を呼ぶ(検査が緑なのに生成が存在しない表へ書く、を作らない)。
 *
 * @param resend 錨の表の再送の方針(錨が無ければ null)
 * @param tables 全 data_table
 * @returns 問題(3 点セット)か null
 */
export function resendDigestStoreProblem(
  resend: ResendPolicy | null,
  tables: readonly { readonly table: string; readonly framework?: string; readonly retentionHours?: number }[],
): PlanProblem | null {
  if (resend === null || resend.kind === 'conflict') return null;
  if (resendDigestTableOf(tables) !== null) return null;
  return {
    message: `再送で既存の行を返す保存点は、1 回目の入力の要約を置く表(framework: ${RESEND_DIGEST_FRAMEWORK})が要りますが、宣言がありません`,
    suggestion:
      `data_table に table: ${RESEND_DIGEST_FRAMEWORK} / internal: true / framework: ${RESEND_DIGEST_FRAMEWORK} / retention_hours(例: 24)/ ddl_migration を宣言する` +
      '(要約は個人列を含む入力から作るので、追記専用の監査ログには置かない)',
    counterexample: { framework: RESEND_DIGEST_FRAMEWORK },
  };
}

/** 要約を残す保存点 1 本(錨の表と、手順が作る表)。要約が誰を覆うかの導出は `resend-digest-cover.ts`(`digestCoverOf`)。 */
export interface DigestSave {
  /** 要約の行の `event_id`(`rpc-resend-digest.ts` の `resendDigestEvent`)。 */
  readonly event: string;
  /** 錨の表(最初に作る行の表)。 */
  readonly anchor: string;
  /** 保存点の手順が作る表(錨を含む)。 */
  readonly created: readonly string[];
}

/**
 * 要約を残す保存点か(錨があり、錨の表が既存の行を返す方針のときだけ。返さない方針は再送をいつも断るので要約を残さない)。
 *
 * @param plan 接地済みの保存点
 * @param params 手順ごとの解決済み引数(錨の手順の作成者の欄を引く)
 * @param event 要約の行の `event_id`
 * @returns 保存点(要約を残さなければ null)
 */
export function digestSaveOf(plan: SavePlan, params: readonly (readonly ResolvedParam[])[], event: string): DigestSave | null {
  const first = plan.steps.find((step) => step.kind === 'create');
  if (first === undefined) return null;
  const resend = anchorResend(plan, first, params[first.index] ?? []);
  if (!resend.ok || resend.policy.kind === 'conflict') return null;
  return { event, anchor: first.table, created: [...new Set(plan.steps.filter((step) => step.kind === 'create').map((step) => step.table))] };
}
