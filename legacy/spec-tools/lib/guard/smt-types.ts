/**
 * 写像(smt.ts)の**入出力の型**だけを置く。
 *
 * 写す規則そのものは smt.ts が正であり、ここには規則を 1 つも書かない。
 */

import type { SmtRename } from './smt-names.js';

/** 反例(witness)を組み立て直すための変数 1 つ分の情報。 */
export interface SmtVariable {
  /** SMT 上の名前(`|workshop.state|`)。 */
  readonly smtName: string;
  /** 仕様側のパス(`workshop.state`)。 */
  readonly path: string;
  /** finite 変数だけ: 整数 → 値の綴りの逆写像。 */
  readonly valueByIndex?: ReadonlyMap<number, string>;
  /**
   * この変数と**直に比べられた**リテラル定数(SMT 名)。
   * 反例を読み直すときは、ここに挙がった定数と値が一致したときだけ「その綴りと同じ値」と
   * 読む —— 関わりの無い定数と数が偶然一致しただけで綴りを当てると、日時の欄に uuid の
   * 綴りが出るような嘘の反例になる(束 ⑳-5c で差分テストが実測した)。
   */
  readonly literals?: readonly string[];
  /**
   * 順序付きの値(数・日時)として使われた変数か。
   * opaque(等号だけ)の変数の「値」は、SMT 上は**同じか違うか**しか意味を持たないので、
   * 反例に数を出しても読めない —— 読み直す側がここを見て出し分ける。
   */
  readonly ordered?: boolean;
}

/** 数値でないリテラルに割り当てた自由定数 1 つ分の情報。 */
export interface SmtLiteralConst {
  readonly smtName: string;
  readonly text: string;
}

/**
 * 「空かどうか」を表す相棒の `Bool` 1 つ分の情報(束 ㉒)。
 *
 * 反例を読み直すときは**値より先にここを見る** —— 相棒が真なら、その欄の値の変数が
 * 何を指していても意味を持たない(空の欄に「この値だった」と書くと反例が嘘になる)。
 */
export interface SmtNullVar {
  /** SMT 上の名前(`|null!workshop.venue_id|`)。 */
  readonly smtName: string;
  /** 仕様側のパス(`workshop.venue_id`)。 */
  readonly path: string;
}

/**
 * 写像の**呼び出し口**(省略時は「付け替えない・値の表はこの 1 回きり」)。
 *
 * ガード式 1 本を判定するとき(V9 / V10)は何も渡さない。遷移を時間軸に展開するとき
 * (lib/reach)だけ、手ごとの変数名と**全手で共有する値の符号化表**をここから差し込む。
 */
export interface SmtOptions {
  /**
   * SMT 上の名前の付け替え。**変数のパス**(`workshop.state`)と、**自由な `Bool` に逃がした
   * 原子の鍵**に適用される(リテラル定数には適用しない —— 同じ綴りは常に同じ定数)。
   */
  readonly rename?: SmtRename;
  /**
   * 値の綴り → 整数の符号化表。**複数回の写像で共有する**ために外から渡す —— 手ごとに
   * 別の表を採ると `state@0 = draft` と `state@1 = draft` が別の整数になり、世界が壊れる。
   * 渡した Map はこの呼び出しで追記される(初出の綴りを採番する)。
   */
  readonly valueIndex?: Map<string, number>;
}

/** 写像の結果。`declarations` と `formula` を組み立てれば SMT-LIB のスクリプトになる。 */
export interface SmtTranslation {
  /** 宣言と値域の表明(`declare-const` と `assert`)。 */
  readonly declarations: string;
  /** 式そのものを写した項。 */
  readonly formula: string;
  /** 反例を読み直すための変数一覧。 */
  readonly variables: readonly SmtVariable[];
  /** 反例を読み直すためのリテラル定数一覧。 */
  readonly literals: readonly SmtLiteralConst[];
  /** 「空かどうか」の相棒の `Bool` 一覧(`is null` が現れなければ空)。 */
  readonly nullVars: readonly SmtNullVar[];
}
