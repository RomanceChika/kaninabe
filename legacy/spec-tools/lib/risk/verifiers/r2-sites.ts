/**
 * R2 の**書き込みの経路**を仕様から列挙する(役の根拠の欄 1 本ごとに、誰がどの宣言で書けるか)。
 *
 * 経路は 5 つで閉じている。
 *
 * | 経路 | 宣言 | 書き手 |
 * |---|---|---|
 * | 編集 | access_spec の `writes[].fields` | `writes[].by` |
 * | 作成の初期値 | `{集約}.create` の action_spec の `input` / `computes`、役を与える既定値・初期状態 | `creates[].by` |
 * | 遷移 | state_spec の `to`(状態の `claim` の欄)、`records_actor`、遷移の action_spec の `input` / `computes` | `events[].by` |
 * | 計算値(自分の集約の作成・遷移の外) | 別の集約の作成・遷移の action_spec の `computes`、編集(`{集約}.update`)の `computes` | その操作の `creates[].by` / `events[].by` / `writes[].by` |
 * | 内部実行の入口 | 上のどれかの書き手が `kind: system` のロール | 追える入口(`r2-trace.ts`) |
 *
 * 計算で決まる値は `writes` に行を持たない(2026-10-20 の裁定。V18)ので、編集の `computes` と別の集約の操作の `computes` は
 * 編集の経路(`writes[].fields`)に現れない。それでも書いているのはその操作であり、書き手はその操作を起こせるロールなので、
 * 別の行で数える(以前は `writes` の `by: system` の行が近似として拾っていた。行を消すと黙って取り逃がす)。
 *
 * `clears`(空にする)は役を与えないので経路に数えない。削除も役を与えないので数えない。
 * **作成の持ち主の欄**(action_spec の `owner` で明示した、作成者で埋める欄)は作成の書き手として数える(経路 `create_owner`)。
 * 作成者がその欄の役を自分の行に持つので、書き手(`creates[].by`)がその役を持たないなら、その規則に欄 × 役を名指した
 * `self_assign` が要る。以前は「必須で入力に無い実行者への参照」を推測で持ち主と見なし、候補が 1 本なら数えなかった ——
 * 推測が母集合の取り方で 4 度漏れたので(点検 9 回目 A9-1)、推測を無くし、明示した欄を毎回名指しで受け入れる形にした。
 * ユースケースの `self: true`(自分として)は数えない —— 入力に宣言された欄を自分に絞るか、利用者の明示の操作である。
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AggregateSpecs, CreateRule, EventDef, FieldDef, SelfAssignDecl, SourceLocation, SpecModel, WriteRule } from '../../model/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import type { Ground } from './r2-grounds.js';
import { groundOperation } from '../../semantics/operation-ground.js';
import { entityNameOfAggregate } from '../../semantics/domain-index.js';
import { declaredOwner } from '../../usecase/actor-bound.js';
import { defaultGrant } from './default-literal.js';

/** 書き込みの経路の種類。 */
export type SitePath =
  | 'writes'
  | 'edit_computes'
  | 'create_input'
  | 'create_initial'
  | 'create_system'
  | 'create_owner'
  | 'transition'
  | 'transition_input'
  | 'records_actor';

/** 受け入れ(`self_assign`)を書く場所(受け入れの要素は欄 × 役 × 書き手を名指す。名指していない根拠・書き手には効かない)。 */
export interface AcceptHolder {
  /** 受け入れを書く宣言の種類(`writes` の規則・`creates` の規則・遷移のイベント)。 */
  readonly kind: 'writes' | 'creates' | 'event';
  /** 宣言を一意に指す鍵(腐った受け入れの検出に使う)。 */
  readonly key: string;
  /** 人が読む宣言の名前。 */
  readonly label: string;
  /** 宣言の書き手(規則の `by` 1 ロール・遷移の `by` の並び)。要素の `by` はこの部分集合でなければならない(A10-1)。 */
  readonly writers: readonly string[];
  /** 宣言に書かれた受け入れ(欄 × 役を名指す要素。無ければ空)。 */
  readonly selfAssign: readonly SelfAssignDecl[];
  readonly location: SourceLocation;
}

/** 書き込みの経路 1 本(根拠の欄 × 書き手 × 宣言)。 */
export interface WriteSite {
  readonly ground: Ground;
  /** 書き手のロール ID。 */
  readonly writer: string;
  readonly path: SitePath;
  /** 受け入れを書く宣言。 */
  readonly holder: AcceptHolder;
  /** 遷移の経路なら `{機械}.{イベント}`。 */
  readonly event?: string;
  /** 作成の経路で、作る集約が根拠の欄の集約と違うとき(別の集約の作成の計算値)の、作るエンティティ。 */
  readonly creator?: string;
  /** 人が読む補足(初期値の値・入力の欄)。 */
  readonly detail?: string;
}

/** 経路を列挙する材料。 */
export interface SiteInput {
  readonly model: SpecModel;
  readonly actions: ActionSpecModel | undefined;
  readonly dataTables: DataTableSpecModel | undefined;
  /** 実行者の集約(無ければ null)。 */
  readonly actorEntity: string | null;
  /** 内部実行のロール ID(無ければ undefined)。 */
  readonly systemRole: string | undefined;
}

/** 遷移の対象の行の鍵(書き込みではない)。 */
const KEY_FIELD = 'id';

/** 状態の値で `claim` が立つか(boolean の欄は真・値の集合の欄は集合に入る)。既定値の式は `defaultGrant` が読む。 */
function grants(ground: Ground, value: string): boolean {
  if (ground.values === null || ground.values === undefined) return value === 'true';
  return ground.values.includes(value);
}

/** 集約名・エンティティ名から集約の仕様を引く。 */
function aggregateOf(model: SpecModel, entity: string): AggregateSpecs | undefined {
  return [...model.aggregates.values()].find((specs) => specs.entity?.entity === entity);
}

/** `writes` の規則の受け入れの場所。 */
function writesHolder(entity: string, index: number, rule: WriteRule): AcceptHolder {
  return { kind: 'writes', key: `writes|${entity}|${index}`, label: `${entity} の writes[${index}](by: ${rule.by})`, writers: [rule.by], selfAssign: rule.selfAssign ?? [], location: rule.location };
}

/** `creates` の規則の受け入れの場所。 */
function createsHolder(entity: string, index: number, rule: CreateRule): AcceptHolder {
  return { kind: 'creates', key: `creates|${entity}|${index}`, label: `${entity} の creates[${index}](by: ${rule.by})`, writers: [rule.by], selfAssign: rule.selfAssign ?? [], location: rule.location };
}

/** イベントの受け入れの場所。 */
function eventHolder(id: string, event: EventDef): AcceptHolder {
  return { kind: 'event', key: `event|${id}`, label: `遷移 ${id}`, writers: event.by, selfAssign: event.selfAssign ?? [], location: event.location };
}

/** 操作の action_spec が、その欄を入力か計算で書くか。 */
function operationWrites(actions: ActionSpecModel | undefined, op: string, ground: Ground): string | null {
  const action = actions?.actions.find((candidate) => candidate.handles.raw === op);
  if (action === undefined) return null;
  const input = action.input.find((ref) => ref.entity === ground.entity && ref.field === ground.field);
  if (input !== undefined) return `input ${input.raw}`;
  const computed = action.computes.find((decl) => decl.entity === ground.entity && decl.field === ground.field);
  return computed === undefined ? null : `computes ${computed.raw}`;
}

/** 作成の初期値が役を与えるか(役を与えるなら、その値の説明。与えないなら null)。 */
function grantingInitial(input: SiteInput, specs: AggregateSpecs, field: FieldDef, ground: Ground): string | null {
  if (ground.kind !== 'claim') return null;
  if (field.suppliedBy === 'db') return 'supplied_by: db(DB が決める値は仕様から追えない)';
  if (field.type.kind === 'state') {
    const machine = specs.stateMachines.find((candidate) => candidate.machine === (field.type.kind === 'state' ? field.type.machine : ''));
    return machine !== undefined && grants(ground, machine.initial) ? `初期状態 ${machine.initial}` : null;
  }
  const table = input.dataTables?.tables.find((candidate) => candidate.entity === ground.entity);
  const raw = table?.defaults[field.name];
  if (raw === undefined) return null;
  const grant = defaultGrant(raw, ground.values);
  if (grant === 'unreadable') return `既定値 ${raw}(式を読めない値は仕様から追えない。supplied_by: db と同じ扱い)`;
  return grant === 'grants' ? `既定値 ${raw}` : null;
}

/** 編集の経路。 */
function writeSites(specs: AggregateSpecs, ground: Ground): WriteSite[] {
  return (specs.access?.writes ?? []).flatMap((rule, index) =>
    rule.fields.includes(ground.field) ? [{ ground, writer: rule.by, path: 'writes' as const, holder: writesHolder(ground.entity, index, rule) }] : [],
  );
}

/** 作成の経路。 */
function createSites(input: SiteInput, specs: AggregateSpecs, field: FieldDef, ground: Ground): WriteSite[] {
  const op = `${ground.entity}.create`;
  const sites: WriteSite[] = [];
  const owner = declaredOwner(input.actions, ground.entity);
  (specs.access?.creates ?? []).forEach((rule, index) => {
    const holder = createsHolder(ground.entity, index, rule);
    const site = (path: SitePath, detail: string): void => {
      sites.push({ ground, writer: rule.by, path, holder, detail });
    };
    const written = operationWrites(input.actions, op, ground);
    if (written !== null) site('create_input', written);
    else if (owner === ground.field) site('create_owner', `${ground.field} を作成者で埋める(action_spec ${op} の owner)`);
    else if (rule.by === input.systemRole && ground.kind !== 'claim' && !field.auto && field.suppliedBy !== 'db') site('create_system', `${ground.field} の値を内部実行が決める`);
    const initial = grantingInitial(input, specs, field, ground);
    if (initial !== null && written === null) site('create_initial', initial);
  });
  return sites;
}

/** 遷移の経路。 */
function transitionSites(input: SiteInput, specs: AggregateSpecs, field: FieldDef, ground: Ground): WriteSite[] {
  const sites: WriteSite[] = [];
  for (const machine of specs.stateMachines) {
    const ownsState = field.type.kind === 'state' && field.type.machine === machine.machine;
    for (const event of machine.events) {
      const id = `${machine.machine}.${event.id}`;
      const holder = eventHolder(id, event);
      const push = (path: SitePath, detail: string): void => {
        for (const writer of event.by) sites.push({ ground, writer, path, holder, event: id, detail });
      };
      if (ownsState && ground.kind === 'claim' && grants(ground, event.to) && event.from.some((from) => !grants(ground, from))) {
        push('transition', `${event.from.join('|')} → ${event.to}`);
      }
      if (event.recordsActor?.includes(ground.field) === true) push('records_actor', `records_actor ${ground.field}`);
      if (ground.field === KEY_FIELD) continue;
      const written = operationWrites(input.actions, id, ground);
      if (written !== null) push('transition_input', written);
    }
  }
  return sites;
}

/**
 * 計算値の経路のうち、自分の集約の作成(`createSites`)と遷移(`transitionSites`)が数えないもの。
 *
 * 別の集約の遷移・作成が計算して書く形と、編集(`{集約}.update`)の計算値である。書き手はその操作を起こせるロール
 * (遷移の `by`・作成の `creates[].by`・編集の `writes[].by`)で、受け入れの場所もその規則である。
 */
function computeSites(input: SiteInput, ground: Ground): WriteSite[] {
  const sites: WriteSite[] = [];
  for (const action of input.actions?.actions ?? []) {
    const decl = action.computes.find((candidate) => candidate.entity === ground.entity && candidate.field === ground.field);
    if (decl === undefined) continue;
    const detail = `computes ${decl.raw}`;
    const grounding = groundOperation(input.model, action.handles.raw);
    if (grounding.kind === 'transition') {
      if (entityNameOfAggregate(input.model, grounding.entry.aggregate) === ground.entity) continue;
      const holder = eventHolder(grounding.entry.id, grounding.entry.event);
      for (const writer of grounding.entry.event.by) sites.push({ ground, writer, path: 'transition_input', holder, event: grounding.entry.id, detail });
    } else if (grounding.kind === 'create' && grounding.entry.entity !== ground.entity) {
      const entity = grounding.entry.entity;
      grounding.entry.rules.forEach((rule, index) => sites.push({ ground, writer: rule.by, path: 'create_input', holder: createsHolder(entity, index, rule), detail, creator: entity }));
    } else if (grounding.kind === 'update') {
      const entity = grounding.entry.entity;
      grounding.entry.rules.forEach((rule, index) => sites.push({ ground, writer: rule.by, path: 'edit_computes', holder: writesHolder(entity, index, rule), detail }));
    }
  }
  return sites;
}

/**
 * 根拠の欄 1 本の、全ての書き込みの経路。
 *
 * @param input 材料
 * @param ground 根拠の欄
 * @returns 経路(欄が entity_spec に無ければ空。実在は V2 / V11 が見る)
 */
export function sitesOf(input: SiteInput, ground: Ground): WriteSite[] {
  const specs = aggregateOf(input.model, ground.entity);
  const field = specs?.entity?.fields.find((candidate) => candidate.name === ground.field);
  if (specs === undefined || field === undefined) return [];
  return [
    ...writeSites(specs, ground),
    ...createSites(input, specs, field, ground),
    ...transitionSites(input, specs, field, ground),
    ...computeSites(input, ground),
  ];
}

/**
 * 受け入れ(`self_assign`)を書いた宣言の全数(腐った受け入れを見つけるため)。
 *
 * @param model ドメイン仕様全体
 * @returns 受け入れを書いた宣言
 */
export function declaredAccepts(model: SpecModel): AcceptHolder[] {
  const holders: AcceptHolder[] = [];
  for (const specs of model.aggregates.values()) {
    const entity = specs.access?.entity ?? specs.entity?.entity ?? specs.name;
    specs.access?.writes.forEach((rule, index) => {
      if ((rule.selfAssign ?? []).length > 0) holders.push(writesHolder(entity, index, rule));
    });
    specs.access?.creates.forEach((rule, index) => {
      if ((rule.selfAssign ?? []).length > 0) holders.push(createsHolder(entity, index, rule));
    });
    for (const machine of specs.stateMachines) {
      for (const event of machine.events) {
        if ((event.selfAssign ?? []).length > 0) holders.push(eventHolder(`${machine.machine}.${event.id}`, event));
      }
    }
  }
  return holders;
}
