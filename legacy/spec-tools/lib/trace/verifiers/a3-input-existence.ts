/**
 * A3 `input` の実在チェック。
 *
 * action-spec-writing.md の A3:「`{entity}.{field}` が `entity_spec` に存在する」。
 *
 * `input` は「境界で受けるフィールドの名前」だけを持ち、必須・長さ・型などの制約は
 * `entity_spec` が正である(PRIN-0007)。接地していない名前を受けると、生成 zod スキーマと
 * フォームの共有が成立しない。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { InputFieldRef } from '../../model/trace/types.js';
import type { TraceInput } from '../input.js';
import { findEntityFields } from '../../semantics/domain-index.js';
import type { SpecModel } from '../../model/types.js';

/** A3: input のフィールド参照が entity_spec に実在するかを検証する。 */
export const inputExistenceVerifier: TraceVerifier = {
  id: 'A3',
  title: 'input の実在 — 受けるフィールドが entity_spec にある',

  verify(input: TraceInput): Finding[] {
    const findings: Finding[] = [];
    for (const action of input.actions.actions) {
      for (const field of action.input) {
        const finding = checkField(field, input.domain);
        if (finding !== null) findings.push(finding);
      }
    }
    return findings;
  },
};

/** 1 つの `{entity}.{field}` を引き当てる。 */
function checkField(ref: InputFieldRef, domain: SpecModel): Finding | null {
  const fields = findEntityFields(domain, ref.entity);
  if (fields === null) {
    return traceFinding('A3', {
      message: `input の ${ref.raw} が指すエンティティ ${ref.entity} は specs/domain にありません`,
      location: ref.location,
      suggestion:
        `specs/domain/${ref.entity}/entity.md を作るか、input を実在するエンティティの ` +
        '"{entity}.{field}" に直す',
      counterexample: { input: ref.raw, entity: ref.entity },
    });
  }
  if (fields.some((field) => field.name === ref.field)) return null;
  return traceFinding('A3', {
    message: `input の ${ref.raw} は ${ref.entity} の entity_spec に存在しないフィールドです`,
    location: ref.location,
    suggestion:
      `${ref.entity} の entity.md の fields に ${ref.field} を追加するか、` +
      `既存のフィールド(${fields.map((field) => field.name).join(', ')})へ直す`,
    counterexample: {
      input: ref.raw,
      known_fields: fields.map((field) => field.name).join(', '),
    },
  });
}
