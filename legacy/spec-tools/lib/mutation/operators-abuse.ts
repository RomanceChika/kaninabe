/**
 * 変異器のうち、**未ログインの書き込みの歯止めを外す・広げる**もの(R5 の効き目。設計 r5-abuse-freeze.md §7)。
 *
 * 壊し方は検査の負例をそのまま機械にしたものである。
 *
 *   - `drop_abuse_ceiling`: 未ログインの作成の `abuse` を消す(全体の天井が無くなる)
 *   - `widen_create_to_anonymous`: 未ログインの作成が無い集約に、天井を持たない未ログインの作成の規則を足す(開けただけで歯止めが無い)
 *   - `drop_public_reason`: 未ログインに開いた更新・削除・遷移の `public: 理由` を消す(受け入れが無くなる)
 *
 * どれも R5 が捕る(検出器 `risk` の指紋に R5 の指摘が入る)。未ログインのロールが無い仕様・壊す場所が無い仕様では空を返す。
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, AggregateSpecs, EventDef, SpecModel, StateMachineSpec } from '../model/types.js';
import { anonymousRoleId } from '../model/role-hierarchy.js';
import type { Mutant, MutationOperator } from './types.js';

/** 集約のアクセス宣言を差し替えたモデル。 */
function withAccess(model: SpecModel, name: string, specs: AggregateSpecs, access: AccessSpec): SpecModel {
  return withSpecs(model, name, { ...specs, access });
}

/** 集約を差し替えたモデル。 */
function withSpecs(model: SpecModel, name: string, specs: AggregateSpecs): SpecModel {
  const aggregates = new Map(model.aggregates);
  aggregates.set(name, specs);
  return { ...model, aggregates };
}

/** `public` を外した値(他の欄はそのまま)。 */
function withoutPublic<T extends { readonly public?: string }>(rule: T): T {
  const { public: _dropped, ...rest } = rule;
  return rest as T;
}

/** 未ログインの作成の `abuse` を消す。 */
export const dropAbuseCeiling: MutationOperator = {
  id: 'drop_abuse_ceiling',
  title: '未ログインの作成の `abuse`(全体の天井)を消す',
  breaks: 'creates[].abuse(未ログインの作成の全体の天井)',

  mutate(model: SpecModel): readonly Mutant[] {
    const anonymous = anonymousRoleId(model.roles.roles);
    if (anonymous === undefined) return [];
    const mutants: Mutant[] = [];
    for (const [name, specs] of model.aggregates) {
      const access = specs.access;
      if (access === undefined) continue;
      access.creates.forEach((rule, index) => {
        if (rule.by !== anonymous || rule.abuse === undefined) return;
        const { abuse: _dropped, ...bare } = rule;
        const creates = access.creates.map((current, i) => (i === index ? bare : current));
        mutants.push({
          operator: dropAbuseCeiling.id,
          at: `${access.entity} の creates[${index}](by: ${rule.by}) の abuse を消した`,
          site: { entity: access.entity, shape: 'create', by: rule.by },
          model: withAccess(model, name, specs, { ...access, creates }),
        });
      });
    }
    return mutants;
  },
};

/** 未ログインの作成が無い集約に、天井の無い未ログインの作成の規則を足す。 */
export const widenCreateToAnonymous: MutationOperator = {
  id: 'widen_create_to_anonymous',
  title: '未ログインの作成が無い集約に、天井(`abuse`)の無い未ログインの作成の規則を足す',
  breaks: 'creates(未ログインの作成の規則)',

  mutate(model: SpecModel): readonly Mutant[] {
    const anonymous = anonymousRoleId(model.roles.roles);
    if (anonymous === undefined) return [];
    const mutants: Mutant[] = [];
    for (const [name, specs] of model.aggregates) {
      const access = specs.access;
      if (access === undefined || access.creates.some((rule) => rule.by === anonymous)) continue;
      mutants.push({
        operator: widenCreateToAnonymous.id,
        at: `${access.entity} の creates に by: ${anonymous}(abuse なし)を足した`,
        site: { entity: access.entity, shape: 'create', by: anonymous },
        model: withAccess(model, name, specs, { ...access, creates: [...access.creates, { by: anonymous, location: access.location }] }),
      });
    }
    return mutants;
  },
};

/** 遷移 1 本の `public` を外した状態機械(外す遷移が無ければ undefined)。 */
function machineWithoutPublic(machine: StateMachineSpec, event: EventDef): StateMachineSpec {
  return { ...machine, events: machine.events.map((current) => (current === event ? withoutPublic(current) : current)) };
}

/** 未ログインに開いた更新・削除・遷移の `public` を消す。 */
export const dropPublicReason: MutationOperator = {
  id: 'drop_public_reason',
  title: '未ログインに開いた更新・削除・遷移の `public: 理由` を消す',
  breaks: 'writes / deletes / events の public(未ログインに開く書き込みの受け入れ)',

  mutate(model: SpecModel): readonly Mutant[] {
    const anonymous = anonymousRoleId(model.roles.roles);
    if (anonymous === undefined) return [];
    const mutants: Mutant[] = [];
    for (const [name, specs] of model.aggregates) {
      const access = specs.access;
      if (access !== undefined) {
        access.writes.forEach((rule, index) => {
          if (rule.by !== anonymous || rule.public === undefined) return;
          const writes = access.writes.map((current, i) => (i === index ? withoutPublic(current) : current));
          mutants.push({
            operator: dropPublicReason.id,
            at: `${access.entity} の writes[${index}](by: ${rule.by}) の public を消した`,
            site: { entity: access.entity, shape: 'update', by: rule.by },
            model: withAccess(model, name, specs, { ...access, writes }),
          });
        });
        access.deletes.forEach((rule, index) => {
          if (rule.by !== anonymous || rule.public === undefined) return;
          const deletes = access.deletes.map((current, i) => (i === index ? withoutPublic(current) : current));
          mutants.push({
            operator: dropPublicReason.id,
            at: `${access.entity} の deletes[${index}](by: ${rule.by}) の public を消した`,
            site: { entity: access.entity, shape: 'delete', by: rule.by },
            model: withAccess(model, name, specs, { ...access, deletes }),
          });
        });
      }
      for (const machine of specs.stateMachines) {
        for (const event of machine.events) {
          if (!event.by.includes(anonymous) || event.public === undefined) continue;
          const stateMachines = specs.stateMachines.map((current) => (current === machine ? machineWithoutPublic(machine, event) : current));
          mutants.push({
            operator: dropPublicReason.id,
            at: `${machine.machine} の ${event.id}(by: ${event.by.join(', ')}) の public を消した`,
            site: { entity: specs.entity?.entity ?? name, shape: 'transition', event: `${machine.machine}.${event.id}` },
            model: withSpecs(model, name, { ...specs, stateMachines }),
          });
        }
      }
    }
    return mutants;
  },
};
