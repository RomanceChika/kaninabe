/**
 * V26 のうち、**一意の範囲**を見る部分(点検 12 回目 A12-3・13 回目 A13-1 / A13-3 / A13-4 / A13-5)。
 *
 * `when` と `filters` が閉じていても、一意の索引・排他制約・件数の上限は RLS の外で効く。鍵から境界の列を落とすと、ある社の作成が別の社の行と衝突し、
 * 拒否で「その値が他社にある」と分かる(読めない行の存在の漏れ。実 DB で `23505` を実測)うえ、先に登録して別の社の登録を止められる。
 *
 * ## 何を見るか
 *
 * 鍵は 2 つの口から来る。`uniqueness` / `exclusion` / `cardinality` の `keys` と、**不変条件を持たない一意の索引の `on`**(`indexes[]`)である。
 * 不変条件を持つ索引の `on` が `keys` と一致することは T23 が見るので、ここで 2 度数えない。鍵ごとに:
 *
 *   - 集約が境界を持つ(自分の境界の列か、生の参照で境界の列へ届く参照の欄がある。境界の根は行そのものがテナントで、鍵に足せる列が無いので対象外)
 *   - 鍵に、自分の境界の列も、境界へ届く参照の欄も無い
 *   - 鍵の欄のどれかを人の書き手が決められる(内部実行のロールでない作成の入力・編集の `fields`・遷移の入力・**その操作の `computes`**)
 *
 * の全部が成り立てば error。作成の action_spec が無ければ、入力で受ける欄を宣言から狭められないので、DB と実行器が埋める欄以外の全部を入力とみなす。
 * `computes` は純関数が何を読むかで分けない(入力に依らないと推測しない)。人の書き手の操作で決まる値はすべて人が決める値として数える。
 *
 * 内部表(entity_spec を持たない表)は人の書き手の宣言が 1 つも無いので、内部実行だけが書く鍵と同じ扱いで対象の外である。
 *
 * **隠し列の鍵**: 鍵の欄が `fields_hidden` で H から隠され、H(含意の先・未ログインを含む)がその欄を書けるなら error。候補の値で書いて、拒否で値の有無を知れる。受け入れは無い。
 *
 * ## 受け入れ
 *
 * 全体で一意が正しい鍵(公開の識別子など)は、その不変条件の `formal.global_key`(不変条件の無い索引は行の `global_key`)に鍵の列と理由を書く。
 * 鍵 1 本に置くので、同じ集約に後から足した別の鍵には効かない。何も受け入れていない・名指した列が今の鍵と違う `global_key` は腐った受け入れとして止める。
 *
 * **この検査はテナントの語を 1 つも持たない。**
 */

import type { AggregateSpecs, EntitySpec, InvariantDef, SourceLocation, SpecModel } from '../../model/types.js';
import type { GlobalKeyAccept } from '../../model/parse-global-key.js';
import type { ActionSpec } from '../../model/trace/types.js';
import { reachableRoles } from '../../semantics/copy-exposure.js';
import { isInputAbsent } from '../../model/types.js';
import { inputValue } from '../../kernel/input-state.js';
import { systemRoleId } from '../../model/role-hierarchy.js';
import { createInputFields } from '../../usecase/actor-bound.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext } from '../../check-api/contract.js';
import { matches, rawReach, type BoundaryField } from './tenant-boundary-model.js';

/** この検証器の ID(本体と同じ)。 */
const VERIFIER_ID = 'V26';

/** 鍵を持つ形式定義。 */
type KeyedFormal = Extract<NonNullable<InvariantDef['formal']>, { readonly keys: readonly string[] }>;

/** 鍵を持つ不変条件か。 */
function keyed(invariant: InvariantDef): KeyedFormal | null {
  const formal = invariant.formal;
  return formal !== undefined && 'keys' in formal ? formal : null;
}

/** 操作をする役(読めない handles は null = 人とみなす)。 */
function doersOf(model: SpecModel, action: ActionSpec): readonly string[] | null {
  const { machine, event } = action.handles;
  const access = model.aggregates.get(machine)?.access;
  if (event === 'create') return (access?.creates ?? []).map((rule) => rule.by);
  if (event === 'update') return (access?.writes ?? []).map((rule) => rule.by);
  if (event === 'delete') return (access?.deletes ?? []).map((rule) => rule.by);
  for (const specs of model.aggregates.values()) {
    const found = specs.stateMachines.find((candidate) => candidate.machine === machine)?.events.find((candidate) => candidate.id === event);
    if (found !== undefined) return found.by;
  }
  return null;
}

/** 条件を満たす書き手が決められる欄(作成の入力・編集の `fields`・遷移の入力・その操作の `computes`)。 */
function writableBy(specs: AggregateSpecs, entity: EntitySpec, model: SpecModel, ctx: VerifyContext, writer: (role: string) => boolean): ReadonlySet<string> {
  const actions = inputValue(ctx.actions);
  const access = specs.access;
  const written = new Set((access?.writes ?? []).filter((rule) => writer(rule.by)).flatMap((rule) => rule.fields));
  // 作るときの値を DB が決める欄(`supplied_by: db`)でも、`writes` に載れば人が書き換えられる(点検 24 回目 B24-1 の末尾の番号)。
  const rewritten = new Set(written);
  if ((access?.creates ?? []).some((rule) => writer(rule.by))) {
    const declared = actions?.actions.some((action) => action.handles.raw === `${entity.entity}.create`) === true;
    const inputs = declared ? createInputFields(actions, entity.entity) : entity.fields.filter((field) => !isInputAbsent(field)).map((field) => field.name);
    inputs.forEach((name) => written.add(name));
  }
  for (const machine of specs.stateMachines) {
    for (const event of machine.events.filter((candidate) => candidate.by.some(writer))) {
      const action = actions?.actions.find((candidate) => candidate.handles.raw === `${machine.machine}.${event.id}`);
      for (const ref of action?.input ?? []) if (ref.entity === entity.entity) written.add(ref.field);
    }
  }
  for (const action of actions?.actions ?? []) {
    if (!(doersOf(model, action) ?? [...model.roles.roles.map((role) => role.id)]).some(writer)) continue;
    for (const compute of action.computes) if (compute.entity === entity.entity) written.add(compute.field);
  }
  return new Set(entity.fields.filter((field) => written.has(field.name) && (!isInputAbsent(field) || rewritten.has(field.name))).map((field) => field.name));
}

/** 実行者のいる書き手が決められる欄。 */
function humanWritable(model: SpecModel, specs: AggregateSpecs, entity: EntitySpec, ctx: VerifyContext): ReadonlySet<string> {
  const system = systemRoleId(model.roles.roles);
  return writableBy(specs, entity, model, ctx, (role) => role !== system);
}

/** 鍵が結べていない境界の欄(宣言順)。 */
function unboundBoundaries(model: SpecModel, entity: EntitySpec, boundaries: readonly BoundaryField[], keys: readonly string[]): readonly string[] {
  return boundaries.flatMap((boundary) => {
    const own = entity.fields.filter((field) => matches(field, boundary)).map((field) => field.name);
    const scoping = [...own, ...rawReach(model, entity, boundary)];
    return scoping.length === 0 || scoping.some((column) => keys.includes(column)) ? [] : [boundary.name];
  });
}

/** 鍵 1 本(不変条件の `keys` か、不変条件の無い一意の索引の `on`)。 */
interface KeySource {
  /** 指摘に載せる名前(不変条件 ID か索引の名前)。 */
  readonly name: string;
  readonly keys: readonly string[];
  readonly globalKey: GlobalKeyAccept | undefined;
  readonly location: SourceLocation;
  /** 反例の名指しのキー。 */
  readonly label: 'invariant' | 'index';
  /** 鍵の語(指摘の文面)。 */
  readonly keyWord: 'keys' | 'on';
}

/** 鍵が境界を落としている指摘。 */
function droppedFinding(entity: EntitySpec, key: KeySource, boundary: string, writable: readonly string[]): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message:
      `${key.name} の ${key.keyWord} [${key.keys.join(', ')}] は ${entity.entity} の境界 ${boundary} を含まず、人の入力で ${writable.join(', ')} を書けます —— ` +
      '他のテナントの値との衝突が拒否で分かり、先に登録して他のテナントの登録を止められる形です',
    location: key.location,
    suggestion:
      `鍵に境界の列か、境界へ届く参照の欄を足す(不変条件と data_table の索引の両方)。全体で一意が正しい鍵なら "global_key: {keys: [${key.keys.join(', ')}], reason: なぜ全体で一意か}" を書く` +
      (key.label === 'index' ? '(この索引の行に書く)' : '(formal に書く)'),
    counterexample: { [key.label]: key.name, entity: entity.entity, keys: key.keys.join(', '), boundary },
  };
}

/** 腐った受け入れの指摘。 */
function rottenFinding(entity: EntitySpec, key: KeySource, why: string): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message: `${key.name} の global_key は何も受け入れていません(${why})`,
    location: key.location,
    suggestion: '効いていない受け入れは消す。鍵を変えたなら、理由も見直して keys を今の鍵に合わせる',
    counterexample: { [key.label]: key.name, entity: entity.entity },
  };
}

/** 2 つの列の並びが同じ集合か。 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
}

/** 鍵 1 本の範囲を見る。 */
function checkKey(model: SpecModel, specs: AggregateSpecs, entity: EntitySpec, key: KeySource, boundaries: readonly BoundaryField[], ctx: VerifyContext): Finding[] {
  const writable = [...humanWritable(model, specs, entity, ctx)].filter((name) => key.keys.includes(name));
  const dropped = writable.length === 0 ? [] : unboundBoundaries(model, entity, boundaries, key.keys);
  if (key.globalKey === undefined) return dropped.map((boundary) => droppedFinding(entity, key, boundary, writable));
  if (dropped.length === 0) return [rottenFinding(entity, key, '鍵が境界を結んでいる・境界が無い・人の入力で書けない、のどれかです')];
  return sameSet(key.globalKey.keys, key.keys) ? [] : [rottenFinding(entity, key, `名指した列 [${key.globalKey.keys.join(', ')}] が今の鍵 [${key.keys.join(', ')}] と違います`)];
}

/** 隠し列を鍵にして、隠した相手がその欄を書ける形。 */
function checkHiddenKey(model: SpecModel, specs: AggregateSpecs, entity: EntitySpec, key: KeySource, ctx: VerifyContext): Finding[] {
  return (specs.access?.fieldsHidden ?? [])
    .filter((rule) => key.keys.includes(rule.field))
    .flatMap((rule) =>
      rule.from.flatMap((role): Finding[] => {
        const reachable = reachableRoles(model.roles.roles, role);
        if (!writableBy(specs, entity, model, ctx, (writer) => reachable.has(writer)).has(rule.field)) return [];
        return [
          {
            verifier: VERIFIER_ID,
            severity: 'error',
            message: `${key.name} の鍵 ${rule.field} は ${role} から隠した列で、${role} が書けます —— 候補の値を書くと、拒否で値の有無が分かる形です`,
            location: key.location,
            suggestion: `鍵から ${rule.field} を外す・${role} に書かせない・隠すのをやめる、のどれかにする`,
            counterexample: { [key.label]: key.name, field: rule.field, role },
          },
        ];
      }),
    );
}

/** 集約の不変条件の鍵。 */
function invariantKeys(specs: AggregateSpecs): readonly KeySource[] {
  return (specs.invariants?.invariants ?? []).flatMap((invariant) => {
    const formal = keyed(invariant);
    return formal === null ? [] : [{ name: invariant.id, keys: formal.keys, globalKey: formal.globalKey, location: invariant.location, label: 'invariant' as const, keyWord: 'keys' as const }];
  });
}

/** 集約の表の、不変条件を持たない一意の索引の鍵。 */
function bareIndexKeys(entity: EntitySpec, ctx: VerifyContext): readonly KeySource[] {
  const tables = inputValue(ctx.dataTables)?.tables ?? [];
  return tables
    .filter((table) => table.entity === entity.entity)
    .flatMap((table) =>
      table.indexes
        .filter((index) => index.unique && index.invariant === undefined)
        .map((index) => ({ name: index.name, keys: index.on, globalKey: index.globalKey, location: { ...table.location, pointer: `indexes.${index.name}` }, label: 'index' as const, keyWord: 'on' as const })),
    );
}

/**
 * 全集約の鍵を見る(境界が無い製品でも、腐った `global_key` は止める)。
 *
 * @param model ドメイン仕様
 * @param boundaries 境界の欄
 * @param ctx 検証の文脈
 * @returns 違反のリスト
 */
export function checkUniqueKeys(model: SpecModel, boundaries: readonly BoundaryField[], ctx: VerifyContext): Finding[] {
  const findings: Finding[] = [];
  for (const specs of model.aggregates.values()) {
    const entity = specs.entity;
    if (entity === undefined) continue;
    for (const key of [...invariantKeys(specs), ...bareIndexKeys(entity, ctx)]) {
      findings.push(...checkKey(model, specs, entity, key, boundaries, ctx), ...checkHiddenKey(model, specs, entity, key, ctx));
    }
  }
  return findings;
}
