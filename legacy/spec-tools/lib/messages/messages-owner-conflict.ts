/**
 * V10 の「執行点の名前の衝突」の**文面**(事実 → 3 点セット)。
 *
 * 判定そのもの(`constraintOwners`)は `lib/semantics/constraint-owners.ts` にあり、ここは**事実を受けて
 * 字面を組むだけ**である。検査器(V10)は Finding に、生成器(`code-constraint-invariants`)は
 * `preconditionFailure` の問題に写す —— どちらも同じ文面になるので、「どちらが正か」が読めなくなる
 * 余地が無い。共有の文言なので文言の層に置く。
 */

import type { InvariantDef } from '../model/types.js';
import type { ConstraintOwnerClash } from '../semantics/constraint-owners.js';

/**
 * 執行点の名前を 2 つ以上の不変条件が宣言した 1 件(3 点セット + 場所の借り先)。
 */
export interface ConstraintOwnerConflict {
  /** 何が起きているか。 */
  readonly message: string;
  /** どう直すか。 */
  readonly suggestion: string;
  /** 反例(執行点の名前・宣言した 2 つの不変条件・種別)。 */
  readonly counterexample: Readonly<Record<string, string>>;
  /** 後から宣言した不変条件(メッセージの前置と場所をここから借りる)。 */
  readonly invariant: InvariantDef;
}

/**
 * 衝突 1 件の 3 点セットを組み立てる(文面はここ 1 か所だけが持つ)。
 *
 * @param clash 意味解析の層が返した衝突の事実
 * @returns 検査器と生成器が共有する 3 点セット
 */
export function ownerConflictOf(clash: ConstraintOwnerClash): ConstraintOwnerConflict {
  const { ref, kind, existing, invariant } = clash;
  return {
    message: `執行点 ${ref} を 2 つの不変条件(${existing} / ${invariant.id})が宣言しています`,
    suggestion:
      '制約名・トリガ関数名から不変条件が 1 つに決まらないと、DB が拒否した理由を人に返せない' +
      '(例外の本文から名前を拾って invariant_violated に写す形なので、1 名前 = 1 不変条件である)。' +
      '守る事実ごとに執行点を分ける —— 写しの列が 2 本あれば、同じ 1 回の代入でもトリガの宣言は 2 本要る',
    counterexample: { ref, invariants: `${existing} / ${invariant.id}`, kind },
    invariant,
  };
}
