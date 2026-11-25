/**
 * 変異器のうち、**役の根拠の欄の書き手を広げる**もの(R2 の効き目。設計 spec-security-lint-design.md §4)。
 *
 * 壊し方は手で確かめた負例をそのまま機械にしたものである(敵対的な点検 2 回目の P1: 「どの利用者も任意の部門の
 * 管理者の欄を書ける編集の規則を足す」)。役の根拠の欄(`claim` の boolean / enum の欄・`binding` の欄)ごとに、
 * **既定のログインロールがその欄を書ける編集の規則を 1 本足す**。状態の欄(`state(...)`)は編集の規則に書けないので壊さない。
 * 既定のログインロールがその役を既に持つ(含意する)なら、書き手は広がらないので壊さない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, AggregateSpecs, SpecModel, WriteRule } from '../model/types.js';
import { globalRoleId } from '../model/role-hierarchy.js';
import { collectGrounds, holdersOf } from '../risk/verifiers/r2-grounds.js';
import type { Mutant, MutationOperator } from './types.js';

/** 集約を差し替えたモデル。 */
function withAccess(model: SpecModel, name: string, specs: AggregateSpecs, access: AccessSpec): SpecModel {
  const aggregates = new Map(model.aggregates);
  aggregates.set(name, { ...specs, access });
  return { ...model, aggregates };
}

/** 役の根拠の欄を、既定のログインロールが書ける編集の規則を 1 本足す。 */
export const addGroundWriter: MutationOperator = {
  id: 'add_ground_writer',
  title: '役の根拠の欄(`claim` / `binding` の欄)を既定のログインロールが書ける編集の規則を 1 本足す',
  breaks: 'writes(役の根拠の欄の書き手)',

  mutate(model: SpecModel): readonly Mutant[] {
    const roles = model.roles.roles;
    const writer = globalRoleId(roles, 'authenticated_default');
    if (writer === undefined) return [];
    const mutants: Mutant[] = [];
    for (const ground of collectGrounds(model).grounds) {
      if (ground.role === undefined || holdersOf(roles, ground.role).has(writer)) continue;
      const found = [...model.aggregates].find(([, specs]) => specs.entity?.entity === ground.entity);
      if (found === undefined) continue;
      const [name, specs] = found;
      const field = specs.entity?.fields.find((candidate) => candidate.name === ground.field);
      if (specs.access === undefined || field === undefined || field.auto || field.type.kind === 'state') continue;
      const rule: WriteRule = { by: writer, fields: [ground.field], location: specs.access.location };
      mutants.push({
        operator: addGroundWriter.id,
        at: `${ground.entity} の writes に by: ${writer} / fields: [${ground.field}](役 ${ground.role} の根拠)を足した`,
        site: { entity: specs.access.entity, shape: 'update', by: writer },
        model: withAccess(model, name, specs, { ...specs.access, writes: [...specs.access.writes, rule] }),
      });
    }
    return mutants;
  },
};
