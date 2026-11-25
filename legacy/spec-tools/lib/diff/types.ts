/**
 * 仕様の意味の差分(semantic diff)の型。
 *
 * 出すのは 6 軸だけである(設計メモ `docs/design/semantic-diff.md` §1)。軸を増やすと
 * 「PR ごとに読むのはこれだけ」という約束が崩れるので、ここの `DiffAxis` が値域であり、
 * 足すには設計を開け直すことになる。
 *
 * 比べるのは**仕様(YAML)ではなく生成物**である —— 生成物は意味だけを持つので、
 * 書き方の変更(並び替え・コメント)が差分の文に化けない(同 §0)。
 *
 * 純粋な型定義であり I/O を持たない。
 */
import type { ProductRoots } from '../model/product/types.js';

/** 差分の 6 軸(値域)。 */
export type DiffAxis =
  /** 権限: 誰が・どの状態で・その操作を実行できるか(結果表の全列挙)。 */
  | 'permission'
  /** 操作の増減: 操作 ID そのものの出入り。 */
  | 'operations'
  /** 見える行: RLS の select ポリシー(どのロールがどの表の行を読めるか)。 */
  | 'rows'
  /** 公開される欄: API スキーマのビューの列と、隠し列の解け方。 */
  | 'columns'
  /** 通知: 宛先・発火のしかたと、遷移からの発火元。 */
  | 'notifications'
  /** 画面: 画面から起こせる操作と、出ていける先。 */
  | 'screens';

/**
 * 方向の記号。
 *
 * `widened`(🔓)は**権限・可視・公開が増える**変化であり、レビューの主役として先頭に集める。
 * `changed`(🔁)は「同じものの中身が入れ替わった」—— 通知の宛先のように、広がったとも
 * 狭まったとも言えない変化のための記号である(設計の 4 つの記号では宛先の入れ替えを書けない)。
 */
export type DiffDirection = 'widened' | 'narrowed' | 'added' | 'removed' | 'changed';

/** 差分の 1 行。 */
export interface SemanticChange {
  readonly axis: DiffAxis;
  readonly direction: DiffDirection;
  /** 何についての変化か(ID を主にした短い見出し。並べ替えの鍵でもある)。 */
  readonly subject: string;
  /** 基点側の中身(その版に無かったなら null)。 */
  readonly before: string | null;
  /** 比較先の中身(こちらに無くなったなら null)。 */
  readonly after: string | null;
  /** 人が読む 1 行(日本語は `messages.ts` の 1 か所が組む)。 */
  readonly text: string;
}

/**
 * 判定できなかった 1 件。
 *
 * **「差分なし」と混ぜない** —— 生成物が読めないのに「意味の差分はありません」と出す経路を
 * 作らないための型である(C23 の 3 分割と同じ流儀: 差分なし / 判定できない / 差分あり)。
 */
export interface DiffProblem {
  /**
   * 何が起きたか。
   *
   * `undeclared` は「**その版にその宣言が無かった**」であり、版ごとに export が増える
   * 生成物では正常な姿である(古い版と比べるたびに湧く)。`unreadable` は「**読めなかった**」
   * であり、**どちらの版で起きても赤**である(片側が読めないのに差分を出すと、読めた側の
   * 中身がまるごと「増えた」に化ける)。
   *
   * `unanswered` は「**生成物がその答えを出していない**」である —— 結果表が world を宣言から
   * 作れず `operations: []` になっている集約がこれで、読めているのに判定が無い。赤にはしない
   * (仕様の現状であって実行の失敗ではない)が、**出力の先頭で必ず報告する** —— 黙らせると
   * 「その操作の権限が変わっても差分が出ない」ことに誰も気づけない。
   */
  readonly kind: 'unreadable' | 'undeclared' | 'unanswered';
  /** どちらの版で読めなかったか。 */
  readonly side: 'base' | 'head';
  /** リポジトリルート相対のパス。 */
  readonly path: string;
  /** 読めなかった理由(1 行)。 */
  readonly reason: string;
}

/**
 * 片側の生成物の写し(リポジトリルート相対のパス → 中身)。
 *
 * 値が `null` は「**その版に存在しなかった**」であり、「読めなかった」ではない
 * (読めなかったほうは `DiffProblem` に載る)。
 */
export type SideSnapshot = ReadonlyMap<string, string | null>;

/** 差分の結果(行と、判定できなかったものと、比べた本数)。 */
export interface DiffOutcome {
  readonly changes: readonly SemanticChange[];
  readonly problems: readonly DiffProblem[];
  /** 両側を突き合わせた生成物の本数(「差分はありません」の文に添える)。 */
  readonly comparedFiles: number;
}

/** 軸の判定器が受け取るもの(2 版の写しと、表示名の帳面)。 */
export interface AxisInput {
  readonly base: SideSnapshot;
  readonly head: SideSnapshot;
  readonly labels: import('./labels.js').LabelBook;
  /** 製品が宣言した根(差分の元の置き場)。 */
  readonly roots: ProductRoots;
}

/** 軸の判定器が返すもの(行と、読めなかったもの)。 */
export interface AxisResult {
  readonly changes: readonly SemanticChange[];
  readonly problems: readonly DiffProblem[];
}
