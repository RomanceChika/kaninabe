/**
 * V22 行の名前の欄(`display_field`)—— 人に名指す欄は実在する文字列型の 1 欄である。
 *
 * domain-spec-writing.md §entity_spec の要求:
 * 「`display_field` は `fields` に居る `string` / `text` の欄の名前で、任意」。
 *
 * ## なぜこの検査が要るのか
 *
 * `display_field` は生成物が行の名前を出す場所(確認ダイアログの本文・参照の欄の選択肢の表示名の規則)が引く。
 * 実在しない欄・文字列でない欄(数値・日時・参照 id)を指すと、生成物は存在しない列を引くか、「3」や
 * 「2026-10-03T…」を行の名前として人に見せる。書き間違いを宣言の段で止める。`personal` の欄を指すかどうかは
 * 見ない(会場の名前のように、行を名指す欄が個人情報であるのは普通のことで、出してよいかは画面の可視性の宣言の領分)。
 */

import type { EntitySpec, SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'V22';

/** `display_field` に書ける欄の型(人が読める文字列だけ)。 */
const NAMING_TYPES: readonly string[] = ['string', 'text'];

/** V22 の指摘を組み立てる。 */
function finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 1 つの集約の `display_field` を見る。 */
function checkEntity(entity: EntitySpec): Finding[] {
  const name = entity.displayField;
  if (name === undefined) return [];
  const location = { ...entity.location, pointer: 'display_field' };
  const field = entity.fields.find((candidate) => candidate.name === name);
  if (field === undefined) {
    return [
      finding({
        message: `${entity.entity} の display_field ${name} は fields に居ません`,
        location,
        suggestion:
          `fields に居る欄(${entity.fields.map((candidate) => candidate.name).join(' / ')})から、行を人に名指す欄を選ぶ。` +
          '綴り違いなら直し、名前にあたる欄が無い集約は display_field を消す',
        counterexample: { entity: entity.entity, display_field: name },
      }),
    ];
  }
  if (!NAMING_TYPES.includes(field.type.kind)) {
    return [
      finding({
        message: `${entity.entity} の display_field ${name} は文字列の欄ではありません(型は ${field.type.kind})`,
        location,
        suggestion:
          `display_field に書けるのは ${NAMING_TYPES.join(' / ')} の欄だけ(行の名前として人に見せるため)。` +
          '数値・日時・参照の欄は名前にならないので、名前にあたる文字列の欄を選ぶ',
        counterexample: { entity: entity.entity, display_field: name, type: field.type.kind },
      }),
    ];
  }
  return [];
}

/** V22 の実装。 */
export const displayFieldVerifier: Verifier = {
  id: VERIFIER_ID,
  title: '行の名前の欄 — display_field は fields に居る string / text の欄',

  verify(model: SpecModel, _ctx: VerifyContext): Finding[] {
    return [...model.aggregates.values()].flatMap((specs) => (specs.entity === undefined ? [] : checkEntity(specs.entity)));
  },
};
