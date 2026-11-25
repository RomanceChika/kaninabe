/**
 * 保存点の**再送(冪等)で結果を読み直せるか**の判定と、読み直しの問い合わせの構造(導出の層)。
 *
 * 複合 RPC の再送は「最初に作る行から参照の鎖を辿る」形しか持たない。ここは、手順ごとに
 *
 *   1. **読み直せるか**(鎖が最初に作る行まで辿れるか・同じ表に行を作る手順が 2 つ以上あるとき
 *      行を 1 つに定められるか)を判定し、
 *   2. 読み直せるなら、その**問い合わせの構造**(どの表の・どの列が・どの行 id を指す行か)を返す。
 *
 * SQL の字面にするのは出力側(`generate/render/usecase-sql.ts` の `readbackEntries`)である。
 * 判定と字面を割ったのは、`null`(読み直せない)かどうかが「複合 RPC に写せるか」の意味判定を
 * 兼ねていて、検査 Y12 もこの判定を読むからである —— 検証器が出力側の関数を借りて同じ判定を
 * 計算する形(check が emit を読む)を作らない。
 *
 * **アプリの語彙は 1 語も持たない。** 表名・列名はすべて引数の解決結果から来る。
 */

import type { ResolvedParam } from './param-source.js';
import type { PlanProblem, SavePlan, SaveStepPlan } from './step-plan.js';
import { anchorStep, at } from './param-source-facts.js';
import type { ResendPolicy } from './resend-policy.js';
import { anchorResend } from './resend-policy.js';

/**
 * 再送の読み直しに要る「手順とその解決済み引数」の組。
 *
 * 引数は絞り込み前の `ResolvedParam` でよい —— 読み直しは供給元の `kind` と `column` だけを
 * 見るので、写せない供給元が混じっていても鎖の判定は成立する(Y12 が両方を別々に見る)。
 */
export interface ReadbackStep {
  readonly step: SaveStepPlan;
  readonly params: readonly ResolvedParam[];
}

/** 行 1 つを定める追加の絞り込み(同じ表に行を作る手順が 2 つ以上あるとき)。 */
export type RowNarrow =
  /** 絞り込みは要らない(同じ表に行を作る手順が 1 つ)。 */
  | { readonly kind: 'none' }
  /** その行が実行者で埋まる列で絞る(繰り返さない手順)。 */
  | { readonly kind: 'actor_column'; readonly column: string }
  /** 同じ表の「繰り返さない」手順の行を除く(繰り返す手順)。 */
  | { readonly kind: 'excluding'; readonly ids: readonly RowId[] };

/** 行 1 つの id の出どころ。 */
export type RowId =
  /** 最初に作る行(再送のキーそのもの)。 */
  | { readonly kind: 'first' }
  /** 親の行の id から、子の表の `column` で引いた 1 行の id。 */
  | {
      readonly kind: 'lookup';
      readonly table: string;
      readonly column: string;
      readonly parent: RowId;
      readonly narrow: RowNarrow;
    };

/** 手順の結果を既存の行から読み直す問い合わせの構造。 */
export type ReadbackQuery =
  /** id で 1 行を引く。 */
  | { readonly kind: 'by_id'; readonly table: string; readonly id: RowId }
  /** 親の id を持つ列で引く(繰り返しの手順は配列、そうでなければ 1 行)。 */
  | {
      readonly kind: 'by_column';
      readonly table: string;
      readonly column: string;
      readonly parent: RowId;
      readonly narrow: RowNarrow;
      readonly repeat: boolean;
    };

/** 手順 1 つぶんの読み直し(別名つき)。 */
export interface ReadbackPlanEntry {
  /** 手順の別名(返す jsonb の鍵)。 */
  readonly alias: string;
  /** その行を既存の行から読み直す問い合わせ。 */
  readonly query: ReadbackQuery;
}

/**
 * 読み直しの判定の結果。`anchor` が null なら冪等の錨が無い(再送の節を持たない)。
 *
 * `resend` は錨の表の再送の方針(`resend-policy.ts`)で、錨があるときは必ず持つ ——
 * 宣言が無い・作成者の欄が錨の作成で実行者に埋まる列でないときは、読み直しと同じく問題にする。
 */
export type ReadbackPlanResult =
  | {
      readonly ok: true;
      readonly anchor: SaveStepPlan | null;
      readonly resend: ResendPolicy | null;
      readonly entries: readonly ReadbackPlanEntry[];
    }
  | { readonly ok: false; readonly problems: readonly PlanProblem[] };

/** `p_actor_id`(監査の実行者)。この名前だけは「行の列」ではない。 */
const ACTOR_PARAM = 'p_actor_id';

/** 引数名の前置(param-source.ts と同じ規約)。 */
const PARAM_PREFIX = 'p_';

/**
 * その手順が触る行を、**最初に作る行の id から辿る**形に直す。
 *
 * 保存点の中の行は必ず「最初に作る行」から参照の鎖で辿れる(そうでない手順は保存点に
 * 置けない ―― 再送のときにどの行が「その手順の結果」なのか決まらないため)。鎖は
 * `step_result_id`(前の手順の結果を受け取る引数)を 1 段ずつ遡って組み立てる。
 *
 * @param steps 保存点の全手順と解決済み引数(宣言順)
 * @param firstCreate 最初の作成手順の番号
 * @param index 対象の手順の番号
 * @returns 1 行の id の出どころ。辿れなければ null
 */
function rowIdOf(steps: readonly ReadbackStep[], firstCreate: number, index: number): RowId | null {
  if (index === firstCreate) return { kind: 'first' };
  const entry = steps[index];
  if (entry === undefined) return null;
  const link = entry.params.find((param) => param.source.kind === 'step_result_id');
  if (link === undefined || link.source.kind !== 'step_result_id') return null;
  const parent = rowIdOf(steps, firstCreate, link.source.step);
  if (parent === null) return null;
  if (link.source.column === 'id') return parent;
  const narrow = narrowOf(steps, firstCreate, index);
  if (narrow === null) return null;
  return { kind: 'lookup', table: entry.step.table, column: link.source.column, parent, narrow };
}

/** その手順と同じ表に行を作る、ほかの作成手順。 */
function rowSiblings(steps: readonly ReadbackStep[], index: number): readonly ReadbackStep[] {
  const target = steps[index];
  if (target === undefined) return [];
  return steps.filter(
    (entry) => entry.step.index !== index && entry.step.kind === 'create' && entry.step.table === target.step.table,
  );
}

/** その遷移がこの手順の**行そのもの**に適用されるか(結果の id を丸ごと受け取る引数を持つ)。 */
function appliesTo(entry: ReadbackStep, index: number): boolean {
  if (entry.step.kind !== 'transition') return false;
  return entry.params.some(
    (param) => param.source.kind === 'step_result_id' && param.source.step === index && param.source.column === 'id',
  );
}

/**
 * その行が**実行者で埋まる列**(その手順自身の引数、またはその行に適用された遷移の引数)。
 *
 * `p_actor_id`(監査の実行者)は行の列ではないので除く。残る `actor` 供給元の引数は、
 * 規約上「実行者を指す参照欄」しかないので(param-source.ts の `fieldSource`)、
 * その列に実行者 id が入ることが仕様から決まっている。
 */
function actorColumn(steps: readonly ReadbackStep[], index: number): string | null {
  for (const entry of steps) {
    if (entry.step.index !== index && !appliesTo(entry, index)) continue;
    for (const param of entry.params) {
      if (param.source.kind !== 'actor' || param.name === ACTOR_PARAM) continue;
      return param.name.slice(PARAM_PREFIX.length);
    }
  }
  return null;
}

/**
 * 同じ表に行を作る手順が 2 つ以上あるときに、**行を 1 つに定める**追加の絞り込み。
 *
 * 参照の鎖(`{親}_id = …`)だけでは、同じ親の下に複数の手順が行を作る保存点で行が
 * 1 つに定まらない。そこで規約を 2 つ置く(usecase-spec-writing.md §同じ表に行を作る手順が
 * 2 つ以上あるとき)。
 *   - **繰り返さない**手順は、その行が実行者で埋まる列で絞る(= 実行者自身の行)。
 *   - **繰り返す**手順は、同じ表の「繰り返さない」手順の行を除いた残り。
 *
 * どちらも決まらなければ null を返し、呼び側が問題にする(黙って全部を同じ鍵に入れない)。
 *
 * @param steps 保存点の全手順と解決済み引数(宣言順)
 * @param firstCreate 最初の作成手順の番号
 * @param index 対象の手順の番号
 * @returns 絞り込み(不要なら `none`)。決まらなければ null
 */
function narrowOf(steps: readonly ReadbackStep[], firstCreate: number, index: number): RowNarrow | null {
  const siblings = rowSiblings(steps, index);
  const target = steps[index];
  if (siblings.length === 0 || target === undefined) return { kind: 'none' };
  if (!target.step.repeat) {
    const column = actorColumn(steps, index);
    if (column === null) return null;
    // 兄弟も同じ列を実行者で埋めるなら、その列では行を分けられない(どちらも実行者の行になる)。
    if (siblings.some((entry) => actorColumn(steps, entry.step.index) === column)) return null;
    return { kind: 'actor_column', column };
  }
  const others = siblings.filter((entry) => !entry.step.repeat);
  if (others.length !== siblings.length) return null; // 繰り返す手順どうしは区別できない
  const ids: RowId[] = [];
  for (const entry of others) {
    const id = rowIdOf(steps, firstCreate, entry.step.index);
    if (id === null) return null;
    ids.push(id);
  }
  return { kind: 'excluding', ids };
}

/**
 * 再送(冪等)のときに、その手順の結果を既存の行から読み直す問い合わせ。
 *
 * 繰り返しの手順は配列、そうでなければ 1 行。絞り込みは `rowIdOf` が組み立てた「最初に作る行からの鎖」
 * で行い、同じ表に行を作る手順が 2 つ以上ある保存点では `narrowOf` の追加の絞り込みで行を 1 つに定める。
 *
 * @param steps 保存点の全手順と解決済み引数(宣言順)
 * @param firstCreate 最初の作成手順の番号
 * @param index 対象の手順の番号
 * @returns 問い合わせの構造。辿れなければ null
 */
function readbackQueryOf(steps: readonly ReadbackStep[], firstCreate: number, index: number): ReadbackQuery | null {
  const entry = steps[index];
  if (entry === undefined) return null;
  if (index === firstCreate) return { kind: 'by_id', table: entry.step.table, id: { kind: 'first' } };
  const link = entry.params.find((param) => param.source.kind === 'step_result_id');
  if (link === undefined || link.source.kind !== 'step_result_id') return null;
  const parent = rowIdOf(steps, firstCreate, link.source.step);
  if (parent === null) return null;
  if (link.source.column === 'id') return { kind: 'by_id', table: entry.step.table, id: parent };
  const narrow = narrowOf(steps, firstCreate, index);
  if (narrow === null) return null;
  return {
    kind: 'by_column',
    table: entry.step.table,
    column: link.source.column,
    parent,
    narrow,
    repeat: entry.step.repeat,
  };
}

/**
 * 再送(冪等)のときに全手順の結果を既存の行から読み直せるかを判定し、問い合わせの構造を返す。
 *
 * 作成手順を持たない保存点には冪等の錨が無く、再送の節そのものを持たない(遷移は判断時の
 * 状態を条件にするので再送は競合として弾かれる)ため、その場合は `anchor: null` を返す。
 *
 * **構造まで返すのは検査と生成器で判定を 1 度にするためである。** 以前は検査(Y12)が
 * 「読み直せるか」だけを見て、生成器が同じ判定をもう一度回して式を組んでいた —— 片方の条件が
 * ずれた瞬間に `jsonb_build_object('alias', )` のような空の式が migration に出て、壊れるのは
 * DB に当てたときだった(束 ⑲-1 のレビュー)。字面にするのは生成器の `readbackEntries`。
 *
 * @param plan 接地済みの保存点
 * @param steps 手順ごとの解決済み引数(宣言順)
 * @returns 錨と読み直しの構造、または読み直せない手順の問題(3 点セット)
 */
export function readbackPlans(
  plan: SavePlan,
  steps: readonly (readonly ResolvedParam[])[],
): ReadbackPlanResult {
  const first = anchorStep(plan);
  if (first === undefined) return { ok: true, anchor: null, resend: null, entries: [] };
  const readback: readonly ReadbackStep[] = plan.steps.map((step) => ({
    step,
    params: steps[step.index] ?? [],
  }));
  const problems: PlanProblem[] = [];
  const resend = anchorResend(plan, first, steps[first.index] ?? []);
  if (!resend.ok) problems.push(resend.problem);
  const entries: ReadbackPlanEntry[] = [];
  for (const step of plan.steps) {
    const query = readbackQueryOf(readback, first.index, step.index);
    if (query === null) {
      problems.push(unreadbackable(plan, step));
      continue;
    }
    entries.push({ alias: step.alias, query });
  }
  if (problems.length > 0 || !resend.ok) return { ok: false, problems };
  return { ok: true, anchor: first, resend: resend.policy, entries };
}


/** 読み直せない 1 手順の 3 点セット(対処は 3 つの形に分けて案内する)。 */
function unreadbackable(plan: SavePlan, step: SaveStepPlan): PlanProblem {
  return {
    message:
      `手順 ${step.alias}(${step.op})の結果を再送のときに読み直せません —— 最初に作る行から参照の鎖で` +
      `辿れないか、同じ表(${step.table})に行を作る手順が 2 つ以上あって行を 1 つに定められません`,
    suggestion:
      '保存点の手順は「最初に作る行から参照の鎖で辿れるもの」だけにする。3 つの直し方がある —— ' +
      '(1) 保存点の**外**にある別集約への遷移なら、その集約をこの保存点の中で作るか、遷移を単発の操作に出す' +
      '(**保存点を分ける**)。(2) 親を持たない行を N 行作る形なら、**親集約を 1 つ置いて**その子として作る' +
      '(親の行から鎖で辿れるようになる)。(3) 同じ表に 2 つ以上作るなら、繰り返さない側が実行者で埋まる列を' +
      '持つようにする(usecase-spec-writing.md §同じ表に行を作る手順が 2 つ以上あるとき)',
    counterexample: { ...at(plan, step), table: step.table, alias: step.alias },
  };
}
