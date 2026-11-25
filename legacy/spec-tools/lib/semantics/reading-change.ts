/**
 * 公理の側で動いたもの 1 件(`spec:diff` が出し、章の「今回変わった」と手引きの数が読む)。
 *
 * 型だけを意味解析の層に置く。差分を作る側(`lib/diff/axioms.ts`)も、章を組む側(`generate/render/book`)も
 * この形を読むので、どちらがどちらを import することもない(層の表の向き)。
 *
 * 公理の側の差分は、**仕様ファイルの文字ではなく、生成物に写された言明と表示名**から作る
 * (`spec:diff` の原則: 書き方の差ではなく意味の差を見る)。
 */

import type { ReadingElement } from './reading-class.js';

/** 公理の側の差分の 1 件。 */
export interface ReadingChange {
  /** 要素の種類(分類の表の鍵。公理の側だけ)。 */
  readonly element: Extract<
    ReadingElement,
    | 'invariant.statement'
    | 'state.label'
    | 'transition.meaning'
    | 'state.summary'
    | 'machine.summary'
    | 'entity.summary'
    | 'computes.example'
  >;
  /** 出入りか、中身の入れ替わりか。 */
  readonly kind: 'added' | 'removed' | 'changed';
  /** 鍵(不変条件の ID / `{状態機械}.{状態}` / `{状態機械}.{イベント}` / 状態機械名 / エンティティ名 / `{操作}/{純関数}/{例の行の名前}`)。 */
  readonly key: string;
  /** 基点側の中身(その版に無ければ null)。 */
  readonly before: string | null;
  /** 比較先の中身(こちらに無ければ null)。 */
  readonly after: string | null;
}

/** 基点つきで読むときに章へ渡す入力(基点の表記と、その基点からの公理の側の差分)。 */
export interface ReadingBase {
  /** 基点(コミットの参照。章の「今回変わった」に出す)。 */
  readonly ref: string;
  /** 公理の側の差分(判定できたもの)。 */
  readonly changes: readonly ReadingChange[];
}
