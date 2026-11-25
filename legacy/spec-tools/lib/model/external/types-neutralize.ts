/**
 * external_spec の**外へ出す情報(`sends`)の宣言**と、その中の送る自由文の無害化の宣言(`sends.neutralize` / `sends.neutralize_none`)の型。
 *
 * 語彙(部品の語と実行時パッケージの export の対応)は kernel の `neutralize.ts` が唯一の定義。読み取りは `parse-external-neutralize.ts`、
 * アダプタの呼び出しとの突合は X7。
 */

import type { NeutralizerDecl } from '../../kernel/neutralize.js';

/**
 * 送る自由文の無害化の宣言(`sends.neutralize`)。
 *
 * - `apply` … 宣言した部品(`@kaninabe/runtime/neutralize`)を、手書きのアダプタが送る前に必ず通す(X7 が呼び出しを束縛まで見て突き合わせる)。
 * - `none` … 無害化する自由文を送らない理由(利用者が書ける欄を送るのに `none` は書けない)。
 */
export type ExternalNeutralizeDecl =
  | { readonly kind: 'apply'; readonly parts: readonly NeutralizerDecl[] }
  | { readonly kind: 'none'; readonly reason: string };

/** 「外へ出す情報」の宣言。 */
export interface ExternalSendsDecl {
  /**
   * `entity.field` の参照(X3 が entity_spec への実在を見る)。
   * 実在するフィールドに接地できないもの(生成した文面・カタログの `summary` 等)は
   * `text` にだけ書く。
   */
  readonly fields: readonly string[];
  /** 散文での補足(任意。`fields` に書けない内容、または `fields` の代わり)。 */
  readonly text?: string;
  /** 送る自由文の無害化(`direction: outbound` の行は必須。X7 が見る)。 */
  readonly neutralize?: ExternalNeutralizeDecl;
}
