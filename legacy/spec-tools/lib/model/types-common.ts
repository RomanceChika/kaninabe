/**
 * ドメイン仕様モデルの共有語彙。
 *
 * 5 つの doc_type(role / entity / state / access / invariant)のどれからも使う型だけを置く。
 * 特定の doc_type に属する型は types-{doc_type}.ts に置く。
 * 入口は types.ts(ファサード)であり、利用側はそちらから import する。
 */

import type { SourceLocation } from '../kernel/source-location.js';

/** 仕様ファイル上の位置。Finding の location に使う(型の正は kernel 層 `source-location.ts`)。 */
export type { SourceLocation };

/**
 * R2 の受け入れ(`self_assign`)の 1 要素 —— **名指した書き手が書いてよい役の根拠の欄**を、欄 × 役 × 書き手で名指す。
 *
 * access_spec の `creates[]` / `writes[]` と state_spec の遷移が持つ。名指していない欄・名指していない書き手には効かない
 * (点検 9 回目 A9-2 で欄 × 役に、10 回目 A10-1 で書き手を足した。以前は遷移の `by` に後から足した別のロールの自己昇格も、
 * 最初の書き手のために書いた理由が黙って受け入れた)。読み手は `parse-self-assign.ts`。
 */
export interface SelfAssignDecl {
  /** 根拠の欄の集約(エンティティ名)。 */
  readonly entity: string;
  readonly field: string;
  /** その欄が根拠の役(`claim` / `binding`)。実行者の属性の欄(`actor.{欄}`)なら持たない。 */
  readonly role?: string;
  /**
   * この理由が当てはまる書き手(その規則・遷移の `by` の部分集合。空にできない)。`writes` / `creates` の規則は `by` が 1 ロールなので
   * `[{その by}]` の 1 要素だが、形は遷移と揃えて毎回書かせる —— 規則の `by` を後で替えたとき、古い書き手のための理由が新しい書き手を
   * 黙って受け入れないように(名指した書き手が `by` から消えたら R2 が腐った受け入れとして止める)。
   */
  readonly by: readonly string[];
  /** 書き手が役を得る / 与えることを意図した理由(何を得て、何に及ばないか)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}
