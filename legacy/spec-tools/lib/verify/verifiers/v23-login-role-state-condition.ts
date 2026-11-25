/**
 * V23 ログインの既定ロールの状態の条件 — 「行があれば状態に関わらず立つ」を書き間違いで作らせない。
 *
 * `kind: authenticated_default` のロールが立つ根拠は「実行者の集約(`session: true` を宣言した集約)に
 * その人の行があること」である。実行者の集約が**状態機械を持つ**とき —— 招待を受けただけの人・休会した人・
 * 退会した人も行は残る —— 状態の条件を書かなければ、**どの状態の行でもこのロール(と、これを含意する
 * 全てのロール)が立つ**。止めたい状態の人を DB の述語も RLS も止めない。この穴は書き忘れで開き、
 * 書き忘れは他のどの検査にも見えない。ここで落として、「行があれば立つ」を状態機械を持つ集約では
 * 既定にさせない(拒否が既定。PRIN-0009)。
 *
 * ## 何を見るか
 *
 * 1. 実行者の集約(`session: true` の欄を持つエンティティ)が、状態機械(`state(...)` 型の欄)を持つか。
 * 2. 持つなら、`kind: authenticated_default` のロールの `claim` がその状態の欄を指しているか
 *    (`claim: {entity}.{欄} == {値}` / `in [{値}, ...]`。ADR-0018)。
 *
 * 実行者の集約は `session: true` の欄を持つ最初の集約である(`actorEntity` と同じ前提。`session: true` は
 * 1 集約に閉じる — V13)。
 *
 * **語は持たない。** どの状態が「有効」かは仕様が決める。ここは「条件が書かれているか」だけを見る。
 * **免除の一覧は持たない。** 状態機械を持たない実行者の集約は対象外(条件を足す先の状態が無い)で、
 * 持つ集約は条件を書く以外に通る道が無い。
 *
 * ## 重さを切り替える 1 つのスイッチ
 *
 * 製品の仕様が条件を足すまでの移行のあいだ、この検査は警告(拡張候補の台帳の宿題)として出していた。
 * 切り替えは `ROLE_STATE_CONDITION_SEVERITY` の 1 か所だけで、製品の仕様が条件を宣言した束(束 5)で
 * `error` に切り替え、台帳の候補を畳んだ。今は error(書き忘れは通らない)。
 */

import type { AggregateSpecs, FieldDef, RoleDef, SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { Verifier } from '../../check-api/contract.js';

/** 指摘の重さ。 */
type Severity = Finding['severity'];

/** この検証器の ID。 */
const VERIFIER_ID = 'V23';

/** ログインした人の既定のロールの種別。 */
const LOGIN_KIND = 'authenticated_default';

/**
 * この検査の重さ(**唯一のスイッチ**)。
 *
 * 製品の仕様が既定ロールに状態の条件を宣言した束 5 で `'error'` にした(それまでは `'warning'` で、
 * 拡張候補の台帳に載っていた。台帳の候補は畳んだ)。
 */
export const ROLE_STATE_CONDITION_SEVERITY: Severity = 'error';

/** 実行者の集約(`session: true` の欄を持つエンティティの集約)。 */
function actorAggregate(model: SpecModel): AggregateSpecs | null {
  for (const specs of model.aggregates.values()) {
    if (specs.entity?.fields.some((field) => field.session) === true) return specs;
  }
  return null;
}

/** その集約の状態機械の欄(`state(...)` 型)。 */
function stateFields(specs: AggregateSpecs): readonly FieldDef[] {
  return specs.entity?.fields.filter((field) => field.type.kind === 'state') ?? [];
}

/** ロールの `claim` がその状態の欄を指しているか。 */
function conditionsOn(role: RoleDef, entity: string, fields: readonly FieldDef[]): boolean {
  return fields.some((field) => role.claim === `${entity}.${field.name}`);
}

/**
 * 検証器を作る(重さを引数に取る。登録するのは `ROLE_STATE_CONDITION_SEVERITY` で作った 1 つだけ)。
 *
 * @param severity 指摘の重さ
 * @returns V23 の検証器
 */
export function createLoginRoleStateConditionVerifier(severity: Severity): Verifier {
  return {
    id: VERIFIER_ID,
    title: 'ログインの既定ロールの状態の条件 — 実行者の集約が状態機械を持つのに、行があれば状態に関わらず立つ',

    verify(model: SpecModel): Finding[] {
      const actor = actorAggregate(model);
      const entity = actor?.entity;
      if (actor === null || entity === undefined) return [];
      const fields = stateFields(actor);
      if (fields.length === 0) return [];
      return model.roles.roles
        .filter((role) => role.kind === LOGIN_KIND && !conditionsOn(role, entity.entity, fields))
        .map((role) => {
          const field = fields[0]?.name ?? '{状態の欄}';
          const claim = `${entity.entity}.${field}`;
          return {
            verifier: VERIFIER_ID,
            severity,
            message:
              `ログインの既定ロール ${role.id} が状態の条件を宣言していません` +
              `(実行者の集約 ${entity.entity} は状態機械を持つので、行があれば ${field} がどの状態でも ${role.id} が立ちます)`,
            location: role.location,
            suggestion:
              `roles に claim を足す(例: claim: ${claim} == {${role.id} として扱ってよい状態} / ` +
              `claim: ${claim} in [{状態}, ...])。state の欄は session: true を宣言する必要がある。` +
              `${role.id} を含意する全てのロールにも同じ条件が効く(implies が述語に効く。ADR-0018)`,
            counterexample: { role: role.id, actor_entity: entity.entity, state_field: field },
          };
        });
    },
  };
}

/** V23: 実行者の集約が状態機械を持つのに、ログインの既定ロールが状態の条件を宣言していない。 */
export const loginRoleStateConditionVerifier: Verifier = createLoginRoleStateConditionVerifier(
  ROLE_STATE_CONDITION_SEVERITY,
);
