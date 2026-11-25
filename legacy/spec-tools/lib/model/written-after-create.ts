/**
 * **「作成の後に書き換わる列」の定義**(この仕組みの持ち主。点検 21 回目 C の O21-1)。
 *
 * 同じ関心が 3 か所に散っていた —— 未ログインの作成の天井の欄の契約(`model/abuse-clock.ts`)・掴む順の判定の前提
 * (`sql/lock-premises.ts`)・個人列の写しの持ち主の記録(T28 `data/verifiers/t28-copy-owner-memory.ts`)。それぞれが別の部分集合を数え、
 * T28 は `records_actor` / `records_time` / `clears`・更新で発火する供給・`set_null` を数えなかった。ここが 1 本の定義を持ち、3 か所は呼ぶだけにする。
 *
 * 「作成の後に書き換わる」と数える宣言(どれか 1 つでも当たれば書き換わる):
 * 1. 編集・遷移の宣言: access_spec の `writes` の欄・`transition_writes`・状態機械の `records_time` / `records_actor` / `clears`
 *    (`writtenByDeclaration`。集約の仕様だけで決まる)
 * 2. その列を供給するトリガが更新で発火する(data_table の `supplies` と `fires` の `update`。`fires` の読みは呼び手が渡す ——
 *    発火の宣言の読みの持ち主は `model/trigger-fires.ts`)
 * 3. その列の外部キーの削除の動作が `set_null` / `set_default`(親を消すと子の列が書き換わる)
 *
 * **入口が 2 つある理由**(点検 22 回目 C の O22-2): 未ログインの作成の天井(`model/abuse-clock.ts`)は 1 だけ(`writtenByDeclaration`)を呼び、
 * T28 と掴む順の前提は 1〜3(`rewrittenAfterCreate`)を呼ぶ。天井の欄の約束は「**数えられる本人(未ログインの作成者)が、作った後に自分の行の
 * 時刻の欄・鍵の欄を動かして数えを外せない**」である。2(更新で発火する供給)と 3(親の削除の `set_null`)は、どれも**別の宣言の書き込み**
 * (編集・遷移・親の削除。どれも access_spec の宣言が要り、未ログインの作成者には開かない —— 開くなら 1 か、親の集約の `deletes` の宣言で
 * 名指しされる)が起こすもので、数えの外し方として天井の約束に入らない。T28(写しの持ち主の記録)と掴む順の前提は「誰が書くか」を問わず
 * 列が動くかを要るので 1〜3 の全部を数える。天井の呼び手は表の宣言(`RewritableTable`)を持たない(model の層の契約の読み)ので、
 * 表を渡して 1 本にすると、天井の契約が data_table の層に依存する向きの辺が増える。
 *
 * 凍結(`triggers[].freezes`)の検査は 1〜3 に凍結にだけ要る 4〜7 を足した `rewritesOfFrozen` を呼ぶ(点検 fix26 3 回目 D26c-3)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AggregateSpecs } from './types.js';

/**
 * 表の宣言のうち、ここが読む部分(data_table の `triggers` の供給と発火・`foreign_keys` の削除の動作)。土台の層(`model/` の直下)は
 * 種類の型(`model/data/types.ts`)を import しないので、読む欄だけを構造で受ける(DataTableSpec はそのまま渡せる)。
 */
export interface RewritableTable {
  readonly triggers: readonly { readonly supplies: readonly string[]; readonly fires?: string | undefined }[];
  readonly foreignKeys: readonly { readonly column: string; readonly onDelete: string }[];
}

/**
 * 欄が**編集・遷移の宣言**で作成の後に書き換えられるか(上の 1。表の宣言を持たない呼び手 = 未ログインの作成の天井の欄の契約が使う)。
 *
 * @param column 欄
 * @param specs 集約の仕様
 * @returns 書き換えられる宣言があれば true
 */
export function writtenByDeclaration(column: string, specs: AggregateSpecs): boolean {
  const access = specs.access;
  return (
    (access?.writes.some((rule) => rule.fields.includes(column)) ?? false) ||
    (access?.transitionWrites.includes(column) ?? false) ||
    specs.stateMachines.some((machine) =>
      machine.events.some((event) => [event.recordsTime, event.recordsActor, event.clears].some((list) => list?.includes(column) ?? false)),
    )
  );
}

/**
 * 欄が作成の後に書き換わるか(上の 1〜3 の全部)。
 *
 * @param column 欄
 * @param specs 集約の仕様(読めなければ undefined。1 を数えない)
 * @param table その集約の data_table(読めなければ undefined。2・3 を数えない)
 * @param firesOnUpdate 発火の宣言が更新で発火するか(`model/trigger-fires.ts` の `firesOnUpdate`)
 * @returns 書き換わるなら true
 */
export function rewrittenAfterCreate(
  column: string,
  specs: AggregateSpecs | undefined,
  table: RewritableTable | undefined,
  firesOnUpdate: (fires: string | undefined) => boolean,
): boolean {
  if (specs !== undefined && writtenByDeclaration(column, specs)) return true;
  if (table === undefined) return false;
  if (table.triggers.some((trigger) => trigger.supplies.includes(column) && firesOnUpdate(trigger.fires))) return true;
  return table.foreignKeys.some((key) => key.column === column && (key.onDelete === 'set_null' || key.onDelete === 'set_default'));
}

/** 凍結の検査が読む表の宣言(供給・導出・発火・外部キーの削除の動作)。 */
export interface FreezableTable {
  readonly triggers: readonly {
    readonly supplies: readonly string[];
    readonly fires?: string | undefined;
    readonly derives?: readonly { readonly column: string }[] | undefined;
  }[];
  readonly foreignKeys: readonly { readonly column: string; readonly onDelete: string }[];
}

/** 凍らせた列を作成の後に書き換える宣言の種類(`rewritesOfFrozen` の返り値)。 */
export type FrozenRewrite =
  | { readonly kind: 'declaration' }
  | { readonly kind: 'parent_delete'; readonly onDelete: string }
  | { readonly kind: 'personal' }
  | { readonly kind: 'supplied_on_update'; readonly watched: readonly string[] | 'all' }
  | { readonly kind: 'insert_at' }
  | { readonly kind: 'computes' };

/** 凍結の検査の入力(呼び手が層の上の宣言を読んで渡す。この層は data_table の種類の型も action_spec も import しない)。 */
export interface FrozenContext {
  /** 凍らせる列の全部(更新で発火する供給の元の列が全部この中なら、供給は値を変えない)。 */
  readonly frozen: ReadonlySet<string>;
  readonly specs: AggregateSpecs | undefined;
  readonly table: FreezableTable;
  /** 個人列(消去の匿名化が書く)。 */
  readonly personal: ReadonlySet<string>;
  /** 作成でない操作の action_spec の `computes` が書く列(action_spec が読めなければ空)。 */
  readonly computed: ReadonlySet<string>;
  /** 末尾の番号の導出のうち `insert_at`(差し込みで同じ親のほかの行の番号を振り直す)の列。 */
  readonly insertAt: ReadonlySet<string>;
  /** 発火の宣言が更新で見る列(`'all'` = どの列の更新でも・null = 更新で発火しない)。 */
  readonly watchedOnUpdate: (fires: string | undefined) => readonly string[] | 'all' | null;
}

/**
 * 凍らせた列(`triggers[].freezes`)を作成の後に書き換える宣言の全部(点検 fix26 3 回目 D26c-3。凍結の検査 `sql/ddl-freeze-triggers.ts` が呼ぶだけ)。
 *
 * 上の 1〜3 に、凍結にだけ要る 4 つを足す —— 凍結のトリガは誰の書き込みでも断るので、宣言が書く列を凍らせると、その宣言の操作が実行時に
 * 必ず 23514 で落ちる(消去・編集・差し込みの作成)。宣言の時点で断る。
 * 4. 個人列(消去の匿名化が書く)
 * 5. 更新で発火する供給・導出(`supplies` / `derives` の先。`follow` の導出もここ)—— **見ている元の列が全部凍っていれば**値は変わらないので数えない
 * 6. 末尾の番号の `insert_at`(差し込みが同じ親のほかの行の番号を後ろへずらす)
 * 7. 作成でない操作の `computes` が書く列
 *
 * @param column 凍らせる列
 * @param context 凍らせる列の全部と、表・集約・action_spec から読んだ宣言
 * @returns 書き換える宣言(無ければ空)
 */
export function rewritesOfFrozen(column: string, context: FrozenContext): readonly FrozenRewrite[] {
  const found: FrozenRewrite[] = [];
  if (context.specs !== undefined && writtenByDeclaration(column, context.specs)) found.push({ kind: 'declaration' });
  const key = context.table.foreignKeys.find((candidate) => candidate.column === column && (candidate.onDelete === 'set_null' || candidate.onDelete === 'set_default'));
  if (key !== undefined) found.push({ kind: 'parent_delete', onDelete: key.onDelete });
  if (context.personal.has(column)) found.push({ kind: 'personal' });
  for (const trigger of context.table.triggers) {
    if (!trigger.supplies.includes(column) && !(trigger.derives ?? []).some((derivation) => derivation.column === column)) continue;
    const watched = context.watchedOnUpdate(trigger.fires);
    if (watched === null || (watched !== 'all' && watched.every((source) => context.frozen.has(source)))) continue;
    found.push({ kind: 'supplied_on_update', watched });
  }
  if (context.insertAt.has(column)) found.push({ kind: 'insert_at' });
  if (context.computed.has(column)) found.push({ kind: 'computes' });
  return found;
}
