/**
 * DB の執行点の名前 → それを宣言する不変条件の表(意味解析の層)。
 *
 * `enforced_by`(`kind: db_constraint` / `trigger`)の `ref` は制約名・トリガ関数名であり、
 * 書き込み側はその名前を例外の本文から拾って `invariant_violated` に写す
 * (生成物 `constraint-invariants.ts` がその写像表)。したがって**同じ名前を 2 つの不変条件が
 * 執行点として宣言すると、DB が拒否した理由を人に返せない**。
 *
 * **判定はこの 1 本だけである**(Y12 の `save-renderable.ts` と同じ形)。V10 の検査器は `clashes` を
 * Finding に写し、生成器は `owner` の表を受け取って字面にするだけで、どちらも `DB_KINDS` も
 * 衝突の判定も持たない —— 片方だけに種別を足して「verify は緑のまま generate が
 * preconditionFailure で止まる」を作れないようにするためである(束 ⑲-1 のレビュー)。
 *
 * ここが返すのは**事実**(誰が・どの名前を・何種別で宣言したか)だけで、日本語の文面は持たない。
 * 文面の組み立ては文言の層(`lib/messages/messages-owner-conflict.ts` の `ownerConflictOf`)が持つ。
 *
 * **集約をまたぐ**ので、集約ごとのループではなくモデル全体を 1 回見る形で置いてある。
 */

import type { InvariantDef, SpecModel } from '../model/types.js';

/** DB が執行する `enforced_by` の種別(この 2 つだけが制約名を宣言する)。 */
const DB_KINDS = new Set(['db_constraint', 'trigger']);

/** 執行点の名前を 2 つ以上の不変条件が宣言した 1 件(事実だけ)。 */
export interface ConstraintOwnerClash {
  /** 執行点の名前(制約名・トリガ関数名)。 */
  readonly ref: string;
  /** `enforced_by` の種別(`db_constraint` / `trigger`)。 */
  readonly kind: string;
  /** 宣言順に最初に宣言した不変条件 ID。 */
  readonly existing: string;
  /** 後から宣言した不変条件(場所はここから借りる)。 */
  readonly invariant: InvariantDef;
}

/** 執行点の名前 → 不変条件 ID の表と、名前がぶつかった件。 */
export interface ConstraintOwners {
  /** 執行点の名前 → それを宣言する不変条件 ID(宣言順に最初に宣言したもの)。 */
  readonly owner: ReadonlyMap<string, string>;
  /** 2 つ以上の不変条件が宣言した執行点(1 件ごとに 1 つ)。 */
  readonly clashes: readonly ConstraintOwnerClash[];
}

/**
 * 全 invariant_spec から「執行点の名前 → 不変条件」の表を組み、名前の衝突を集める。
 *
 * 検査(V10)と生成器(code-constraint-invariants)が共有する**唯一の判定**である。
 *
 * @param model ドメイン仕様全体
 * @returns 名前の表と、衝突のリスト
 */
export function constraintOwners(model: SpecModel): ConstraintOwners {
  const owner = new Map<string, string>();
  const clashes: ConstraintOwnerClash[] = [];
  for (const specs of model.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      for (const enforcement of invariant.enforcedBy) {
        if (!DB_KINDS.has(enforcement.kind)) continue;
        const existing = owner.get(enforcement.ref);
        if (existing === undefined) {
          owner.set(enforcement.ref, invariant.id);
          continue;
        }
        if (existing === invariant.id) continue;
        clashes.push({ ref: enforcement.ref, kind: enforcement.kind, existing, invariant });
      }
    }
  }
  return { owner, clashes };
}
