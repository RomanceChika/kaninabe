/**
 * テナント境界の**宣言されていない境界の欄**の候補(点検 5 回目 A5-4。V20 が境界の欄 0 本のときに使う)。
 *
 * 境界の欄は `actor.{欄}` の使用と `session: true` の参照の欄から導く(`tenant-boundary-model.ts`)。テナントの欄に `session: true` を付けず、
 * 境界を 1 本も書かなかった製品では境界の欄が 0 本になり、V20 / V26 は何も見ない。その形を黙らせないための材料をここで導く。
 *
 * **この部品はテナントの語を 1 つも持たない。**
 */

import type { FieldDef, SpecModel } from '../../model/types.js';

/** 境界の欄に数えられていない、テナントの欄に見える実行者の参照の欄 1 つ(A5-4)。 */
export interface LatentBoundary {
  /** 実行者の集約(`session: true` の欄を持つ集約)。 */
  readonly aggregate: string;
  readonly field: FieldDef;
  /** 参照先。 */
  readonly target: string;
  /** 同じ参照先を指す、ほかの集約(宣言順)。 */
  readonly sharedBy: readonly string[];
}

/**
 * **テナントの欄に見えるのに、境界の欄として宣言されていない**実行者の参照の欄(A5-4)。
 *
 * 実行者の集約(`session: true` の欄を 1 つでも持つ集約)の参照の欄で、`session: true` も `not_boundary` も無く、
 * ほかの集約も同じ参照先を指すもの。境界の欄が 0 本の製品でこれがあれば、テナントの欄に `session: true` を付け忘れ、
 * 境界を 1 本も書かなかった形の可能性がある —— V20 / V26 は境界の欄から始まるので、その製品では何も見ていない。
 *
 * @param model 仕様のモデル
 * @returns 候補(宣言順)
 */
export function latentBoundaries(model: SpecModel): readonly LatentBoundary[] {
  const entities = [...model.aggregates.values()].flatMap((specs) => (specs.entity === undefined ? [] : [specs.entity]));
  const actors = entities.filter((entity) => entity.fields.some((field) => field.session === true));
  return actors.flatMap((actor) =>
    actor.fields.flatMap((field) => {
      if (field.type.kind !== 'ref' || field.session === true || field.notBoundary !== undefined) return [];
      const target = field.type.entity;
      const sharedBy = entities
        .filter((other) => other.entity !== actor.entity && other.entity !== target && other.fields.some((candidate) => candidate.type.kind === 'ref' && candidate.type.entity === target))
        .map((other) => other.entity);
      return sharedBy.length === 0 ? [] : [{ aggregate: actor.entity, field, target, sharedBy }];
    }),
  );
}
