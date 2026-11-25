/**
 * 人向けの表示の章が扱う**範囲**(どの集約を、どの章に出すか)の導出。
 *
 * 重さと従属は仕様の宣言から導く(宣言を増やさない。book-human-face.md §7-3)。導出そのものは意味解析の層
 * (`semantics/aggregate-structure.ts`)が持ち、ここは文脈(操作・表)を渡して**章の範囲**に写す側である:
 *
 * - **重さ** … 章を重い順に並べる材料(順位をパンくずに出す)。人向けの表示を重さの上位 N 章だけに絞る宣言
 *   (`humanFaceChapters` が数のとき)の選び方にも使う。束 ④ で全章に展開した
 * - **従属** … 所有の向き。従属する集約は親の章の節に畳む。全章に展開しているとき(`humanFaceChapters` が
 *   `'all'`)は、従属する集約は自分の章を持たない(`bookLayout`)
 * - **写した公理** = 範囲の外の集約の公理のうち、`entities` に親のエンティティを含むもの
 *   (異議を出す先は原本の章。同じ形で章をまたぐ)
 */

import {
  actionOwner,
  aggregateOwnership,
  aggregateWeights as deriveWeights,
  cascadeReach,
  descendantsOf,
  entityOwners,
  machineOwners,
  rootOf,
  type AggregateOwnership,
  type AggregateWeight,
} from '../../../semantics/aggregate-structure.js';
import type { AggregateSpecs, InvariantDef, SpecModel } from '../../../model/types.js';
import type { ActionSpec } from '../../../model/trace/types.js';
import type { DataTableSpec } from '../../../model/data/types.js';
import type { UsecaseSpec } from '../../../model/usecase/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';

export { actionOwner, type AggregateWeight };

/** 章の立て方(重さの順位と所有の向き)。 */
export interface BookLayout {
  /**
   * 従属する集約が自分の章を持たず、親の章の節になるか。人向けの表示を全章に展開しているときだけ true
   * (畳んだ先の節を書くのは人向けの表示の章だけなので)。
   */
  readonly nested: boolean;
  /** 全集約の重さ(重い順)。 */
  readonly weights: readonly AggregateWeight[];
  /** 所有の向き。 */
  readonly ownership: AggregateOwnership;
  /** 章を持つ集約(重い順)。畳まないときは全集約。 */
  readonly roots: readonly string[];
  /** 集約 → その内容が載る章の集約(畳まないときは自分自身)。 */
  readonly chapterOf: (name: string) => string;
  /** テーブル仕様のファイル → 章に寄せる集約(寄せないとき・集約に結ばれない表は undefined)。 */
  readonly tableAggregateOf: (file: string) => string | undefined;
}

/** 同じ生成の中で何度も呼ばれるので、文脈ごとに 1 回だけ導く。 */
const layouts = new WeakMap<GenerateContext, { readonly model: SpecModel; readonly layout: BookLayout }>();

/** 章の立て方を導く(文脈ごとに 1 回)。 */
export function bookLayout(model: SpecModel, ctx: GenerateContext): BookLayout {
  const cached = layouts.get(ctx);
  if (cached !== undefined && cached.model === model) return cached.layout;
  const weights = deriveWeights(model, ctx.actions?.actions ?? []);
  const tables = ctx.dataTables?.available === true ? ctx.dataTables.tables : [];
  const ownership = aggregateOwnership(model, tables, weights);
  const nested = ctx.humanFaceChapters === 'all';
  const roots = weights.map((weight) => weight.name).filter((name) => !nested || !ownership.owned.has(name));
  const entityAggregate = new Map<string, string>();
  for (const [name, specs] of model.aggregates) if (specs.entity !== undefined) entityAggregate.set(specs.entity.entity, name);
  const tableAggregate = new Map<string, string>();
  for (const table of tables) {
    const owner = table.entity === undefined ? undefined : entityAggregate.get(table.entity);
    if (owner !== undefined) tableAggregate.set(table.location.file, owner);
  }
  const layout: BookLayout = {
    nested,
    weights,
    ownership,
    roots,
    chapterOf: (name) => (nested ? rootOf(ownership, name) : name),
    tableAggregateOf: (file) => (nested ? tableAggregate.get(file) : undefined),
  };
  layouts.set(ctx, { model, layout });
  return layout;
}

/** 従属する集約の節の見出しに付けるアンカー(親の章の中で、その節へ飛ぶため)。 */
export function sectionAnchor(name: string): string {
  return `sub-${name}`;
}

/**
 * 集約の内容が載る場所へのリンク先(章のファイル名。従属する集約は、親の章の先頭でなく、その節のアンカー付き)。
 * 章のファイルと同じ階層(`./{章}.md`)からの相対で返す。
 */
export function chapterHref(layout: BookLayout, name: string): string {
  const folded = layout.nested && layout.ownership.owned.has(name);
  return `${layout.chapterOf(name)}.md${folded ? `#${sectionAnchor(name)}` : ''}`;
}

/** 全集約の重さを、重い順に返す(`semantics/aggregate-structure.ts` の導出)。 */
export function aggregateWeights(model: SpecModel, ctx: GenerateContext): AggregateWeight[] {
  return [...bookLayout(model, ctx).weights];
}

/** その集約の章を人向けの表示で出すか(文脈が宣言した、全章か重さの上位 N 章に入るか)。 */
export function hasFace(model: SpecModel, ctx: GenerateContext, name: string): boolean {
  if (ctx.humanFaceChapters === 'all') return model.aggregates.has(name);
  return aggregateWeights(model, ctx)
    .slice(0, ctx.humanFaceChapters ?? 0)
    .some((weight) => weight.name === name);
}

/** 従属の判定の根拠(章の「数の出どころ」に出す)。 */
export interface SubordinateBasis {
  /** 親を消すと外部キーの `on delete cascade` で一緒に消える集約(連なる先も含む。従属の候補)。 */
  readonly cascading: readonly AggregateSpecs[];
  /** 親の章に畳むもの(子・孫…。作る・消すロールがすべて、生きている親の行を動かす人であるもの)。 */
  readonly folded: readonly AggregateSpecs[];
}

/** 従属する集約を導く。表の仕様が無い環境では、候補も畳むものも無い。 */
export function subordinates(model: SpecModel, ctx: GenerateContext, parent: AggregateSpecs): SubordinateBasis {
  const tables = ctx.dataTables;
  if (tables === undefined || !tables.available) return { cascading: [], folded: [] };
  const layout = bookLayout(model, ctx);
  const pick = (names: readonly string[]): AggregateSpecs[] =>
    names.flatMap((name) => model.aggregates.get(name) ?? []);
  return {
    cascading: pick(cascadeReach(tables.tables, model, parent.name)),
    folded: pick(descendantsOf(layout.ownership, layout.weights, parent.name)),
  };
}

/** 写した公理(範囲の外の集約の公理で、親のエンティティを `entities` に含むもの)。 */
export interface CarriedInvariant {
  readonly invariant: InvariantDef;
  /** 原本の集約。 */
  readonly owner: AggregateSpecs;
}

/** 写した公理を、集約の並び → 宣言順で返す。 */
export function carriedInvariants(
  model: SpecModel,
  parent: AggregateSpecs,
  scope: readonly AggregateSpecs[],
): CarriedInvariant[] {
  const entity = parent.entity?.entity;
  if (entity === undefined) return [];
  const inScope = new Set(scope.map((specs) => specs.name));
  const carried: CarriedInvariant[] = [];
  for (const owner of model.aggregates.values()) {
    if (inScope.has(owner.name)) continue;
    for (const invariant of owner.invariants?.invariants ?? []) {
      if (invariant.entities.includes(entity)) carried.push({ invariant, owner });
    }
  }
  return carried;
}

/** 章の範囲(親 + 畳んだ従属)の action_spec。 */
export function scopeActions(model: SpecModel, ctx: GenerateContext, scope: readonly AggregateSpecs[]): ActionSpec[] {
  const names = new Set(scope.map((specs) => specs.name));
  return (ctx.actions?.actions ?? []).filter((action) => {
    const owner = actionOwner(model, action);
    return owner !== undefined && names.has(owner);
  });
}

/** 章の範囲のテーブル仕様(表の `entity` が範囲の集約のエンティティ)。 */
export function scopeTables(ctx: GenerateContext, scope: readonly AggregateSpecs[]): DataTableSpec[] {
  const entities = new Set(scope.map((specs) => specs.entity?.entity).filter((entity) => entity !== undefined));
  return (ctx.dataTables?.tables ?? []).filter((table) => table.entity !== undefined && entities.has(table.entity));
}

/** 手順の `op`(`{machine}.{event}` または `{entity}.create` など)が結ばれた集約。 */
function opOwner(model: SpecModel, op: string): string | undefined {
  const head = op.split('.')[0] ?? op;
  return machineOwners(model).get(head) ?? entityOwners(model).get(head);
}

/** 章の範囲のタスク(保存点の手順がすべて範囲の集約の操作であるユースケース)。 */
export function scopeUsecases(model: SpecModel, ctx: GenerateContext, scope: readonly AggregateSpecs[]): UsecaseSpec[] {
  const names = new Set(scope.map((specs) => specs.name));
  return (ctx.usecases?.usecases ?? []).filter((usecase) => {
    const ops = usecase.saves.flatMap((save) => save.steps.map((step) => step.op));
    return ops.length > 0 && ops.every((op) => {
      const owner = opOwner(model, op);
      return owner !== undefined && names.has(owner);
    });
  });
}
