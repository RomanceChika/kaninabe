/**
 * **表の形の器**(インデックス・採番のシーケンス・排他制約)の宣言。
 *
 * どれも「この表はどういう器を持つか」であり、名前が突合キーになる(`data-table-parity` /
 * `ddl-parity` が閉世界で両方向に見る)。読み手は `parse-data-shape.ts` である。
 *
 * `types.ts` が持つのは「このファイルが何者か」の宣言の型で、ここは「表の形の器」の型である
 * (パーサー側と同じ線)。
 */

import type { GlobalKeyAccept } from '../parse-global-key.js';

/** インデックス 1 本の宣言(主キーの裏のインデックスは宣言しない。突合も除外する)。 */
export interface DataIndexDecl {
  /** インデックス名(DB の実名)。 */
  readonly name: string;
  /** キー列(宣言順)。 */
  readonly on: readonly string[];
  /** 一意インデックスか。 */
  readonly unique: boolean;
  /** 部分インデックスの述語(SQL 断片)。突合は「部分インデックスであること」まで見る。 */
  readonly where?: string;
  /** 由来する不変条件 ID(あれば)。定義の正は invariant_spec 側にある。 */
  readonly invariant?: string;
  /** `invariant` の無い一意の索引の鍵が全体で一意が正しいことの受け入れ(鍵の列と理由。V26。任意)。 */
  readonly globalKey?: GlobalKeyAccept;
}

/**
 * 列の既定値が採番に使うシーケンス 1 本の宣言(`defaults` の `nextval('{name}')` が名指す器)。
 *
 * **宣言が無いシーケンスは誰も作らない**(生成 DDL も出さない)—— 題材の製品は連番の既定値を
 * 1 つも持たないのでこの穴は見えず、4 題材を空の DB に当てた実行が 2 題材で
 * `relation "…_seq" does not exist` に落ちて初めて分かった(束 ③-2 の実測)。名指しと宣言の
 * 突合は T13、実 DB との閉世界は ddl-parity が両方向で見る。
 */
export interface DataSequenceDecl {
  /** シーケンスの実名。 */
  readonly name: string;
  /** 最初の値(省略すると 1)。 */
  readonly start?: number;
}

/**
 * 排他制約 1 本の宣言(`exclude using gist`)。
 *
 * 「鍵が一致する行どうしで期間が重ならない」の実体である(invariant_spec の
 * `formal.type: exclusion` と対になる)。突合は **双方向**(data-table-parity が
 * `pg_constraint` の `contype = 'x'` の名前の集合と比べる)—— 一意索引と違い、排他制約は
 * 「うっかり普通の一意索引に書き換える」と意味が静かに変わるので、名前の過不足を閉世界にする。
 */
export interface DataExclusionDecl {
  /** 制約名(DB の実名)。 */
  readonly name: string;
  /** 一致していなければ重なってよい鍵(`with =` で並べる列)。 */
  readonly keys: readonly string[];
  /** 期間の [開始列, 終了列]。半開区間 `[開始, 終了)` に畳んで `with &&` に載せる。 */
  readonly range: readonly [string, string];
  /** 部分制約の述語(SQL 断片)。例: `state <> 'cancelled'`。 */
  readonly where?: string;
  /** 由来する不変条件 ID(あれば)。 */
  readonly invariant?: string;
}
