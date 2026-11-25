/**
 * X3 送る情報の接地チェック。
 *
 * external-spec-writing.md の要求:「`sends.fields[]` の `entity.field` が entity_spec に
 * 実在する」。参照は `{entity}.{field}` の形で書き、`entity` は集約名かエンティティ名
 * (`findField` と同じ規則でどちらでも引ける)、`field` はその entity_spec の `fields[].name`
 * である。
 *
 * **なぜこれが要るのか。** 「AI へ表示名・題名・発表時間を送る」という宣言が実装のどのフィールド
 * を指しているか機械で確かめられないと、entity_spec 側でフィールド名が変わっても宣言が
 * 追随せず、「送っていると書いてあるが実は存在しないフィールド」が仕様に残る。実在するフィールド
 * に接地できない情報(生成した文面・通知の要約等)は `sends.text` の側に書く(external-spec-writing.md)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { findField } from '../../semantics/domain-index.js';
import type { ExternalCatalogSpec } from '../../model/external/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'X3';

/** X3 の指摘を組み立てる。 */
function x3(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * 送る情報の接地を検証する。
 *
 * @param domain 構築済みのドメイン仕様モデル(entity_spec の母集合)
 * @param catalog 読み込み済みの外部連携カタログ(X0 はローダーが済ませてある)
 * @returns 違反のリスト
 */
export function verifySendsGrounding(domain: SpecModel, catalog: ExternalCatalogSpec): Finding[] {
  return catalog.integrations.flatMap((integration) =>
    integration.sends.fields.flatMap((ref) => {
      const dot = ref.indexOf('.');
      const entity = dot < 0 ? '' : ref.slice(0, dot);
      const field = dot < 0 ? '' : ref.slice(dot + 1);
      if (entity !== '' && field !== '' && findField(domain, entity, field) !== null) return [];
      return [
        x3({
          message: `連携 ${integration.id} の sends.fields ${ref} は entity_spec に実在しません`,
          location: integration.location,
          suggestion:
            'sends.fields は "{entity}.{field}" の形で entity_spec に実在するフィールドを指す。' +
            '実在するフィールドに接地できない情報は sends.text に書く',
          counterexample: { integration: integration.id, field: ref },
        }),
      ];
    }),
  );
}
