/**
 * V13 セッション属性の集約スコープ(C-30 相当)。
 *
 * domain-spec-writing.md / auth-spec-writing.md §session 属性 の要求:
 * 「`session: true` は 1 集約(認証ユーザーに対応する集約)にしか付けられない」。
 *
 * ## なぜこの検査が要るのか
 *
 * `session: true` はその列の値をログインセッション(`app_metadata.profile`)へ載せることを
 * 宣言する(手順 1)。生成物 `SESSION_FIELDS` は列名だけの平たい配列であり、「どの集約の
 * 列か」を持たない。2 つ以上の集約が `session: true` を宣言すると、書く側(サインイン /
 * `refresh_session_profile` ハンドラ)は「どの集約の、どの行の値を書くのか」を宣言から
 * 決められなくなる — 同名の列が衝突する・書き込みの主語(メンバーID)が複数の集約にまたがる、
 * のどちらかが暗黙に決まってしまう。V13 はこの穴を、宣言の時点で(実装を書く前に)塞ぐ。
 *
 * 見るのは「集約が 1 つに閉じているか」だけであり、それが実際に**認証ユーザーに対応する**
 * 集約かどうか(= auth.users.id を主キーに持つか)までは仕様からは判定できない
 * (entity_spec は DB の外部キー構造を宣言しない)。ここは実装レビューの領分として残す。
 */

import type { EntitySpec, SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { Verifier } from '../../check-api/contract.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'V13';

/** V13 の指摘を組み立てる。 */
function finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** `session: true` を 1 つ以上持つ entity_spec を集める(宣言順)。 */
function entitiesWithSessionFields(model: SpecModel): readonly EntitySpec[] {
  const found: EntitySpec[] = [];
  for (const specs of model.aggregates.values()) {
    const entity = specs.entity;
    if (entity === undefined) continue;
    if (entity.fields.some((field) => field.session)) found.push(entity);
  }
  return found;
}

/**
 * `session: true` が複数集約にまたがっていないかを見る。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @returns 違反のリスト(2 集約目以降の各フィールドに 1 件ずつ)
 */
export const sessionFieldScopeVerifier: Verifier = {
  id: VERIFIER_ID,
  title: 'セッション属性の集約スコープ — session: true は 1 集約にしか付けられない',

  verify(model: SpecModel): Finding[] {
    const entities = entitiesWithSessionFields(model);
    if (entities.length <= 1) return [];

    const [first, ...rest] = entities;
    const firstName = first?.entity ?? '';
    const findings: Finding[] = [];
    for (const entity of rest) {
      for (const field of entity.fields) {
        if (!field.session) continue;
        findings.push(
          finding({
            message:
              `session: true が複数の集約(${firstName}, ${entity.entity})にまたがっています` +
              `(${entity.entity}.${field.name})`,
            location: field.location,
            suggestion:
              'session: true を付けられるのは認証ユーザーに対応する集約 1 つだけである' +
              `(既に ${firstName} が持っている)。${entity.entity}.${field.name} の session を外すか、` +
              `どちらか一方の集約に寄せる(auth-spec-writing.md §session 属性)`,
            counterexample: { entity: entity.entity, field: field.name, first: firstName },
          }),
        );
      }
    }
    return findings;
  },
};
