/**
 * 「この表に要る索引」の中間表現(関係の層の最初の住人)の型。
 *
 * 索引を要求するのは 2 つの別の種類である —— 読み取りクエリ(`query_spec` の filters・via・sort)と、
 * 表の関数の本文が引く列(`data_table` の `functions[].lookup`)。どちらの宣言も単独では「この表に
 * どの索引が要るか」を言えず、両方を合わせて初めて決まる。**種類どうしの関係**なので、どちらの
 * 種類のディレクトリにも置かず、型つきの値にして検査(T2)・生成・ハンドブックが同じ結果を読む
 * (設計メモ framework-modules §7 の教訓 1: 層の間の約束は名前のついた中間表現にする)。
 *
 * 型だけのファイルで、読むのは kernel の語(位置・阻害の理由)だけである。
 */

import type { BlockedReason } from '../../kernel/input-state.js';
import type { SourceLocation } from '../../kernel/source-location.js';

/** 索引を要求する側の種類(`query` = 読み取りクエリ / `lookup` = 関数の本文が引く列)。 */
export type IndexOriginKind = 'query' | 'lookup';

/** 要求元 1 件(どの宣言のどこが、この索引を要求したか)。 */
export interface IndexOrigin {
  readonly kind: IndexOriginKind;
  /** 要求元の識別子(query_spec の名前 / 関数の名前)。 */
  readonly name: string;
  /** 要求元の宣言の位置(query_spec のファイル / data_table の `functions.{名前}.lookup`)。 */
  readonly location: SourceLocation;
}

/** 要る索引 1 本(表・列の並び・要求元)。要求元が複数なのは、前方一致で 1 本に畳まれたことを意味する。 */
export interface IndexRequirement {
  /** 索引を持つ表。 */
  readonly table: string;
  /** 索引の列の並び(この順で複合索引にする)。 */
  readonly columns: readonly string[];
  /** この索引を要求した query_spec の名前(畳まれた場合は複数。名前順)。 */
  readonly queries: readonly string[];
  /** この索引を要求した関数の名前(`functions[].lookup`。畳まれた場合は複数。名前順。無ければ空)。 */
  readonly lookups: readonly string[];
  /** 要求元の全部(種類の順・名前順)。`queries` / `lookups` はこの名前だけを取り出した見え方。 */
  readonly origins: readonly IndexOrigin[];
}

/** 導出の結果(表の昇順、表の中は列数降順・列名昇順 = 決定的な出力)。 */
export interface IndexRequirements {
  /** 要求元から導いて前方一致を畳んだ候補(既存の索引による除外の前)。 */
  readonly candidates: readonly IndexRequirement[];
  /**
   * 候補のうち、`data_table` に新たに宣言が要るもの(主キー・一意制約・FK 列 1 本の索引で足りる候補を除いた後)。
   * `data_table` を読めていないとき(`gaps` に `data_tables` がある)は、何が宣言済みか言えないので空。
   */
  readonly expected: readonly IndexRequirement[];
}

/** 導出に使えなかった入力の名前(`product.md` の `uses` の種類名と同じ綴り)。 */
export type IndexInputName = 'queries' | 'data_tables';

/**
 * 導出に使えなかった入力 1 件(未選択 = 製品がその種類を採っていない / 阻害 = 採ったのに渡せない)。
 * 使えなかった入力の分は**導かない**(見ていないものを「要らない」と読まない)。理由は呼び手が報告に載せる。
 */
export type InputGap =
  | { readonly input: IndexInputName; readonly state: 'unselected' }
  | { readonly input: IndexInputName; readonly state: 'blocked'; readonly reason: BlockedReason };

/** 導出の戻り値: 読めた入力から導いた要求と、使えなかった入力(`gaps`。0 件 = 全部の入力を使った)。 */
export interface IndexRequirementsResult {
  readonly requirements: IndexRequirements;
  readonly gaps: readonly InputGap[];
}
