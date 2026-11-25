/**
 * V2 参照整合。
 *
 * 仕様に現れる「他の宣言を指す参照」がすべて実在することを検査する
 * (domain-spec-writing.md の V1〜V12 表 V2 行)。対象は次の 7 種。
 *
 * 1. entity_spec の `state(machine)` が指す状態機械の実在
 * 2. entity_spec の `ref(entity)` が指すエンティティの実在
 * 3. entity_spec の `context` の**値**(文脈依存ロールの解決パス)が、自エンティティの
 *    フィールドから相手を指す**前方参照**として実在すること
 * 4. guard / binding / when(`creates` / `writes` / `deletes` / **`reads`**)の各式に現れる
 *    path(比較の右辺パスを含む)が entity_spec の `context`(と対象エンティティ自身・
 *    予約語 actor/now)で解決できること
 * 5. state_spec の `effects[].on` / `forbidden[].event` が events に実在すること
 * 6. state_spec の `events[].from` / `events[].to` / `forbidden[].from` の状態 ID が
 *    `states` に実在すること
 * 7. access_spec の列を名指す口(`fields_hidden[].field` / `writes[].fields` / `accept[].filter`)が
 *    entity_spec の列に実在すること(v2-access-fields.ts。`fields_hidden[].from` のロールの接地は V11)
 *
 * このファイルが持つのは**名前の実在**(1・2・5・6)と全体の組み立てで、パスの解決
 * (3・4)は v2-paths.ts、読み取り規則の 2 つの口(`reads[].filters` / `reads[].when`)の
 * 接地は v2-access-reads.ts にある。Finding の verifier はどれも V2 である。
 */

import type { EntitySpec, SourceLocation, SpecModel, StateMachineSpec } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';
import {
  buildAggregateEnv,
  buildAggregateValueKindEnv,
  buildDomainEnv,
  buildValueKindEnv,
} from '../../semantics/domain-env.js';
import { checkReadFilters, checkReadWhenActor, checkReadWhenShape } from './v2-access-reads.js';
import { checkAccessFields } from './v2-access-fields.js';
import { checkContextDeclarations } from './v2-context.js';
import { buildIndex, checkExpr, refError as error, type RefIndex } from './v2-paths.js';

/** entity_spec の state(machine) / ref(entity) の実在を検査する。 */
function checkFieldTypes(entity: EntitySpec, index: RefIndex): Finding[] {
  const findings: Finding[] = [];
  for (const f of entity.fields) {
    if (f.type.kind === 'state' && !index.machines.has(f.type.machine)) {
      findings.push(
        error(
          `${entity.entity}.${f.name} の型 state(${f.type.machine}): 状態機械 ${f.type.machine} が未定義です`,
          f.location,
          `states.md に state_machine: ${f.type.machine} を定義するか、既存の状態機械名に直してください。`,
          { entity: entity.entity, field: f.name, machine: f.type.machine },
        ),
      );
    }
    if (f.type.kind === 'ref' && !index.entities.has(f.type.entity)) {
      findings.push(
        error(
          `${entity.entity}.${f.name} の型 ref(${f.type.entity}): エンティティ ${f.type.entity} が未定義です`,
          f.location,
          `specs/domain/${f.type.entity}/entity.md を追加するか、既存のエンティティ名に直してください。`,
          { entity: entity.entity, field: f.name, ref: f.type.entity },
        ),
      );
    }
  }
  return findings;
}

/**
 * 遷移が参照する状態 ID(events[].from / events[].to / forbidden[].from)が
 * states に実在するかを検査する。実在しない状態 ID は到達可能性(V5)や
 * 全域性(V3)の判定を静かに狂わせるため、参照整合の検査で落とす。
 */
function checkStateRefs(machine: StateMachineSpec): Finding[] {
  const known = new Set(machine.states);
  const findings: Finding[] = [];
  const check = (state: string, kind: string, owner: string, location: SourceLocation): void => {
    if (known.has(state)) return;
    findings.push(
      error(
        `${machine.machine} の ${owner}.${kind}: 状態 ${state} が states に存在しません`,
        location,
        `states に ${state} を追加するか、${kind} を既存の状態 ID(${machine.states.join(' / ')})に直してください。`,
        { machine: machine.machine, owner, kind, state },
      ),
    );
  };

  for (const ev of machine.events) {
    for (const from of ev.from) check(from, 'from', `events.${ev.id}`, ev.location);
    check(ev.to, 'to', `events.${ev.id}`, ev.location);
  }
  for (const fb of machine.forbidden) {
    for (const from of fb.from) check(from, 'from', `forbidden.${fb.event}`, fb.location);
  }
  return findings;
}

/**
 * SpecModel 全体の参照整合を検査する検証器。
 * 参照先の実在のみを見る。全域性(V3/V4)や到達可能性(V5)には関与しない。
 */
export const referenceIntegrityVerifier: Verifier = {
  id: 'V2',
  title: '参照整合(状態機械・エンティティ・パス・イベント参照の実在)',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const index = buildIndex(model);
    const findings: Finding[] = [];

    for (const [aggregateName, aggregate] of model.aggregates) {
      const entity = aggregate.entity;
      // 比較リテラルの値域は「その集約から見た」環境で引く(裸のフィールド名を含む)。
      const scope = {
        entity,
        origin: aggregateName,
        index,
        env: buildAggregateEnv(model, aggregateName),
        kinds: buildAggregateValueKindEnv(model, aggregateName),
        model,
      };
      if (entity !== undefined) {
        findings.push(...checkFieldTypes(entity, index));
        findings.push(...checkContextDeclarations(entity, index));
      }

      for (const m of aggregate.stateMachines) {
        findings.push(...checkStateRefs(m));
        const eventIds = new Set(m.events.map((e) => e.id));
        for (const ev of m.events) {
          if (ev.guard === undefined) continue;
          findings.push(
            ...checkExpr(ev.guard, 'guard', `${m.machine}.${ev.id}`, scope, ctx.guards, ev.location),
          );
        }
        for (const ef of m.effects) {
          if (eventIds.has(ef.on)) continue;
          findings.push(
            error(
              `${m.machine} の effects.on: イベント ${ef.on} が events に存在しません`,
              ef.location,
              `events に ${ef.on} を定義するか、effects の on を既存のイベント ID に直してください。`,
              { machine: m.machine, on: ef.on },
            ),
          );
        }
        for (const fb of m.forbidden) {
          if (eventIds.has(fb.event)) continue;
          findings.push(
            error(
              `${m.machine} の forbidden.event: イベント ${fb.event} が events に存在しません`,
              fb.location,
              `events に ${fb.event} を定義するか、forbidden の event を既存のイベント ID に直してください。`,
              { machine: m.machine, event: fb.event },
            ),
          );
        }
      }

      const access = aggregate.access;
      if (access === undefined) continue;
      // creates / writes / deletes の when は同じ式言語なので、宣言の種類だけを変えて同じ検査に通す。
      const whenRules = [
        ...access.creates.map((rule) => ({ kind: 'creates', rule })),
        ...access.writes.map((rule) => ({ kind: 'writes', rule })),
        ...access.deletes.map((rule) => ({ kind: 'deletes', rule })),
      ];
      for (const { kind, rule } of whenRules) {
        if (rule.when === undefined) continue;
        findings.push(
          ...checkExpr(
            rule.when,
            'when',
            `${access.entity} の ${kind}(by: ${rule.by})`,
            scope,
            ctx.guards,
            rule.location,
          ),
        );
      }
      // 可視性の条件(`reads[].when`)も同じ式言語である。違うのは「実行者の属性を書けない」
      // ことだけで、その 1 点だけを別に見る(束 §14)。
      for (const rule of access.reads) {
        if (rule.when === undefined) continue;
        const owner = `${access.entity} の reads(by: ${rule.by})`;
        findings.push(...checkExpr(rule.when, 'when', owner, scope, ctx.guards, rule.location));
        findings.push(...checkReadWhenActor(rule.when, owner, rule.location, ctx));
        findings.push(...checkReadWhenShape(rule.when, owner, entity, rule.location, ctx));
      }
      findings.push(...checkReadFilters(model, access));
      findings.push(...checkAccessFields(access, entity, model));
    }

    // binding は対象エンティティが一意に定まらないので、モデル全体の環境で見る。
    const globalScope = {
      entity: undefined,
      origin: undefined,
      index,
      env: buildDomainEnv(model),
      kinds: buildValueKindEnv(model),
      model,
    };
    for (const r of model.roles.roles) {
      if (r.binding === undefined) continue;
      findings.push(
        ...checkExpr(r.binding, 'binding', `ロール ${r.id}`, globalScope, ctx.guards, r.location),
      );
    }

    return findings;
  },
};
