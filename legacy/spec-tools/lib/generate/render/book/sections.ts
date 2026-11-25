/**
 * 章の節の名前(ブロックの「節」の側)。
 *
 * ブロック = 章の 1 節と仕様ファイル 1 枚の組である(`chapter-files.ts` の `blockOf`)。
 * 節の名前は**章が出す見出しそのもの**なので、見出しの綴りと数え方の綴りが別々にならないよう、
 * 章の生成器(見出しを書く側)と `blockOf`(数える側)がここの定数を読む。
 * 見出しが決まっていない場所(章末・タスクごとの節)には、その場所を言う名前を付ける。
 */

/**
 * 集約の章の節(見出しの綴りと同じ)。`head` だけは見出しを持たない章の冒頭で、
 * 集約そのものの説明(entity_spec の標識)が置かれる。
 */
export const DOMAIN_SECTIONS = {
  head: '章の頭',
  data: 'データ(フィールド)',
  lifecycle: 'ライフサイクル(状態機械)',
  operations: '操作 — 誰が、いつ、何をできるか',
  visibility: '誰に見えるか',
  invariants: '破ってはいけないこと(不変条件)',
} as const;

/** 章の末尾に標識をまとめて置く章(カタログ・画面・デザイン)の節の名前。 */
export const TAIL_SECTION = '章末';

/** タスクの章で、各タスクの節の末尾に標識を置く節の名前。 */
export const TASK_SECTION = 'タスクごとの節';

/** 「誰に何が見えるか」の章の節(見出しの綴りと同じ。読み取り経路の標識はその一覧の直後に置く)。 */
export const VISIBILITY_SECTIONS = {
  queries: '読み取り経路(query)',
  roles: '誰がいるか(ロール)',
  surface: '外から届く surface(SQL の公開面)',
} as const;

/** データの置き場の章の節。 */
export const TABLE_SECTION = 'テーブル仕様';

/** 結果表の ❌ の理由の種類を数える節(章のどこにも標識は無く、判断ポイントだけがある)。 */
export const RESULT_SECTION = '結果表(❌ の理由)';

/** 節の並び(レビューの手引きがブロックを並べる順。ここに無い節は末尾に回る)。 */
export const SECTION_ORDER: readonly string[] = [
  DOMAIN_SECTIONS.head,
  DOMAIN_SECTIONS.data,
  DOMAIN_SECTIONS.lifecycle,
  DOMAIN_SECTIONS.operations,
  DOMAIN_SECTIONS.visibility,
  DOMAIN_SECTIONS.invariants,
  TASK_SECTION,
  TABLE_SECTION,
  VISIBILITY_SECTIONS.queries,
  VISIBILITY_SECTIONS.roles,
  VISIBILITY_SECTIONS.surface,
  TAIL_SECTION,
  RESULT_SECTION,
];
