/**
 * 変異器の**目録**(束 ⑳-5c)。仕様モデルを機械で 1 か所壊す純関数を並べる。
 *
 * 壊す先は「権限と条件の宣言」に絞る —— そこが**執行の要**であり、壊れたときに静かに
 * 通ってしまうと被害が大きい場所である(誰が実行できるか / いつ実行できるか / どの行が見えるか)。
 * 束 ⑳-3〜⑳-5b が手で行った変異確認(`by` を落とす・ガードを反転・`filters` を落とす)を
 * そのまま機械にしたものであり、**新しい種類の変異を発明してはいない**。
 *
 * どの変異も「1 か所だけ」を壊す。2 か所以上を同時に壊すと、捕った検査が
 * どちらを捕ったのか読めなくなる。
 *
 * **目録の範囲の説明**(何を壊す目録なのか・まだ壊せない宣言は何か)は `scope.ts` にあり、
 * 各変異器が宣言する `breaks` と合わせて 1 つの「範囲」を作る。**読み取り規則(`reads` の 3 つの
 * 軸)を壊す変異器は `operators-reads.ts`**、**不変条件の `formal` を壊す変異器は
 * `operators-invariants.ts`** にあり(壊す先ごとに分けてある)、全数はこのファイルの
 * `ALL_MUTATION_OPERATORS` が持つ。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, AggregateSpecs, EventDef, SpecModel } from '../model/types.js';
import { flipNullTest } from './operators-invariants.js';
import { dropReadFilters, dropReadWhen, widenReadScope } from './operators-reads.js';
import { addGroundWriter } from './operators-grounds.js';
import { dropAbuseCeiling, dropPublicReason, widenCreateToAnonymous } from './operators-abuse.js';
import type { Mutant, MutationOperator, MutationSite } from './types.js';

/** 比較演算子の反転(ガードの向きを裏返す)。 */
const FLIPPED: Readonly<Record<string, string>> = {
  '==': '!=',
  '!=': '==',
  '<=': '>',
  '>=': '<',
  '<': '>=',
  '>': '<=',
};

/** 比較演算子を見つける正規表現(2 文字の演算子を先に見る)。 */
const COMPARE_RE = /==|!=|<=|>=|<|>/u;

/** 集約 1 つを差し替えたモデル。 */
function withAggregate(model: SpecModel, name: string, specs: AggregateSpecs): SpecModel {
  const aggregates = new Map(model.aggregates);
  aggregates.set(name, specs);
  return { ...model, aggregates };
}

/** access_spec を差し替えたモデル。 */
function withAccess(model: SpecModel, name: string, specs: AggregateSpecs, access: AccessSpec): SpecModel {
  return withAggregate(model, name, { ...specs, access });
}

/** イベント 1 つを差し替えたモデル。 */
function withEvent(
  model: SpecModel,
  name: string,
  specs: AggregateSpecs,
  machineIndex: number,
  eventIndex: number,
  event: EventDef,
): SpecModel {
  const machines = specs.stateMachines.map((machine, mi) =>
    mi !== machineIndex
      ? machine
      : { ...machine, events: machine.events.map((current, ei) => (ei === eventIndex ? event : current)) },
  );
  return withAggregate(model, name, { ...specs, stateMachines: machines });
}

/** 書き込みの種別 → それを執行する定型 RPC の形。 */
const WRITE_SHAPE: Readonly<Record<'creates' | 'writes' | 'deletes', MutationSite['shape']>> = {
  creates: 'create',
  writes: 'update',
  deletes: 'delete',
};

/**
 * 壊した宣言の執行点の所在(`entity` が無い集約では所在を示さない)。
 *
 * 値があるときだけキーを持つ断片を返す(`exactOptionalPropertyTypes`)。
 */
function siteOf(
  specs: AggregateSpecs,
  shape: MutationSite['shape'],
  event?: string,
  by?: string,
): { readonly site?: MutationSite } {
  const entity = specs.access?.entity;
  if (entity === undefined) return {};
  return { site: { entity, shape, ...(event === undefined ? {} : { event }), ...(by === undefined ? {} : { by }) } };
}

/** `by` から 1 ロールを落とす(「誰が実行できるか」を広げる / 狭める)。 */
const dropRoleFromBy: MutationOperator = {
  id: 'drop_role_from_by',
  title: '遷移の `by` からロールを 1 つ落とす',
  breaks: 'by',

  mutate(model: SpecModel): readonly Mutant[] {
    const subtle: Mutant[] = [];
    const blunt: Mutant[] = [];
    for (const [name, specs] of model.aggregates) {
      specs.stateMachines.forEach((machine, machineIndex) => {
        machine.events.forEach((event, eventIndex) => {
          const dropped = event.by[0];
          if (dropped === undefined) return;
          const mutant: Mutant = {
            operator: dropRoleFromBy.id,
            at: `${name}.${event.id} の by から ${dropped} を落とした`,
            ...siteOf(specs, 'transition', `${machine.machine}.${event.id}`),
            model: withEvent(model, name, specs, machineIndex, eventIndex, {
              ...event,
              by: event.by.slice(1),
            }),
          };
          (event.by.length > 1 ? subtle : blunt).push(mutant);
        });
      });
    }
    return [...subtle, ...blunt];
  },
};

/** ガードの比較演算子を反転する(「いつ実行できるか」を裏返す)。 */
const flipGuardCompare: MutationOperator = {
  id: 'flip_guard_compare',
  title: 'ガードの比較演算子を 1 つ反転する',
  breaks: 'guard',

  mutate(model: SpecModel): readonly Mutant[] {
    const mutants: Mutant[] = [];
    for (const [name, specs] of model.aggregates) {
      specs.stateMachines.forEach((machine, machineIndex) => {
        machine.events.forEach((event, eventIndex) => {
          const flipped = flip(event.guard);
          if (flipped === null || event.guard === undefined) return;
          mutants.push({
            operator: flipGuardCompare.id,
            at: `${name}.${event.id} の guard "${event.guard}" を "${flipped}" に反転した`,
            ...siteOf(specs, 'transition', `${machine.machine}.${event.id}`),
            model: withEvent(model, name, specs, machineIndex, eventIndex, { ...event, guard: flipped }),
          });
        });
      });
    }
    return mutants;
  },
};

/** 式の最初の比較演算子を反転する(比較が無ければ null)。 */
function flip(source: string | undefined): string | null {
  if (source === undefined) return null;
  const found = COMPARE_RE.exec(source);
  const operator = found?.[0];
  if (found === null || operator === undefined) return null;
  const replacement = FLIPPED[operator] ?? operator;
  return `${source.slice(0, found.index)}${replacement}${source.slice(found.index + operator.length)}`;
}

/** `creates` / `writes` / `deletes` の `when` を落とす。 */
const dropWriteWhen: MutationOperator = {
  id: 'drop_write_when',
  title: '作成・編集・削除の `when`(許可する条件)を落とす',
  breaks: 'when',

  mutate(model: SpecModel): readonly Mutant[] {
    const mutants: Mutant[] = [];
    for (const [name, specs] of model.aggregates) {
      const access = specs.access;
      if (access === undefined) continue;
      const add = (kind: 'creates' | 'writes' | 'deletes', index: number, by: string, when: string): void => {
        const rules = access[kind].map((rule, i) => {
          if (i !== index) return rule;
          const { when: _dropped, ...rest } = rule;
          return rest;
        });
        mutants.push({
          operator: dropWriteWhen.id,
          at: `${access.entity} の ${kind}(by: ${by})から when "${when}" を落とした`,
          ...siteOf(specs, WRITE_SHAPE[kind], undefined, by),
          model: withAccess(model, name, specs, { ...access, [kind]: rules } as AccessSpec),
        });
      };
      access.creates.forEach((rule, i) => rule.when !== undefined && add('creates', i, rule.by, rule.when));
      access.writes.forEach((rule, i) => rule.when !== undefined && add('writes', i, rule.by, rule.when));
      access.deletes.forEach((rule, i) => rule.when !== undefined && add('deletes', i, rule.by, rule.when));
    }
    return mutants;
  },
};

/** ロール階層(`implies`)から 1 つ落とす。 */
const dropRoleImplies: MutationOperator = {
  id: 'drop_role_implies',
  title: 'ロール階層(`implies`)から 1 つ落とす',
  breaks: 'implies',

  mutate(model: SpecModel): readonly Mutant[] {
    const mutants: Mutant[] = [];
    model.roles.roles.forEach((role, index) => {
      const dropped = role.implies?.[0];
      if (dropped === undefined) return;
      const roles = model.roles.roles.map((current, i) =>
        i === index ? { ...current, implies: (current.implies ?? []).slice(1) } : current,
      );
      mutants.push({
        operator: dropRoleImplies.id,
        at: `ロール ${role.id} の implies から ${dropped} を落とした`,
        model: { ...model, roles: { ...model.roles, roles } },
      });
    });
    return mutants;
  },
};

/** 変異器の全数(対応表の行の順序もこの順)。 */
export const ALL_MUTATION_OPERATORS: readonly MutationOperator[] = [
  dropRoleFromBy,
  flipGuardCompare,
  flipNullTest,
  dropReadFilters,
  dropReadWhen,
  widenReadScope,
  dropWriteWhen,
  dropRoleImplies,
  addGroundWriter,
  dropAbuseCeiling,
  widenCreateToAnonymous,
  dropPublicReason,
];
