/**
 * entity_spec(列)+ access_spec(`reads` / `fields_hidden`)→ **外から届く surface の計画**。
 *
 * surface は `api` スキーマのビュー 1 枚 / 表であり、その形は 3 つの宣言だけで決まりきっている。
 *
 * | surface の要素 | 導出元 |
 * |---|---|
 * | 列と並び | entity_spec の `fields` の宣言順(`select *` を使わないための全列挙) |
 * | マスクする列 | access_spec の `fields_hidden[].field` |
 * | マスクを解く条件 | `from` の**外側**にいて、かつその行を読めるロールの述語の論理和 |
 *
 * 述語は**刈り込む前の** select ポリシーの `using (…)` そのものであり、翻訳は RLS と同じ
 * 1 本(`rls-predicate.ts`)を使う —— 差し替えるのは実行者 id(`api.actor_id()`)と対象の行の
 * 別名(`rec`)だけである。刈り込まない理由は docs/design/api-views-generation.md §1-a。
 *
 * ここは SQL の文字列を持たない(組み立ては `api-migration.ts`)。期待表
 * (`code-api-expectations.ts`)もこの計画から出るので、**surface の正は 1 つ**である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, EntitySpec, RoleDef, SpecModel } from '../model/types.js';
import { readPlans } from '../world/index.js';
import { exposed } from './platform-sql.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import { policyPredicate, type PolicyProblem } from './rls-predicate.js';

/** マスク述語の中で対象の行に付ける別名(関数の引数名でもある)。 */
export const MASK_ROW_ALIAS = 'rec';

/** 隠し列 1 つ分の**見せてよい相手**(SQL を組み立てなくても決まる部分)。 */
export interface ApiMaskVisibility {
  /** 述語関数の名前(`can_see_{表}_{列}`。スキーマ修飾なし)。 */
  readonly name: string;
  /** 隠す列。 */
  readonly column: string;
  /** その列を見てよいロール(`from` の外側で、その行を読める相手。宣言順)。 */
  readonly visibleTo: readonly string[];
}

/** 隠し列 1 つ分の述語(見せてよい相手 + それを SQL に写したもの)。 */
export interface ApiMaskPlan extends ApiMaskVisibility {
  /** 全域(NULL を返さない)な SQL 述語。 */
  readonly predicate: string;
}

/** ビューに並べる列 1 つ。 */
export interface ApiColumnPlan {
  readonly name: string;
  /** 隠し列ならその述語、そうでなければ `null`。 */
  readonly mask: ApiMaskPlan | null;
}

/** ビュー 1 枚の計画。 */
export interface ApiViewPlan {
  /** ビュー名(= 表名)。 */
  readonly table: string;
  /** 元になった集約(仕組みが自分で持つ表では無い)。 */
  readonly entity: string | null;
  /** 列(entity_spec の宣言順)。 */
  readonly columns: readonly ApiColumnPlan[];
  /** 隠し列の述語(列の宣言順)。 */
  readonly masks: readonly ApiMaskPlan[];
}

/** 計画の組み立てに要る入力。 */
export interface ApiViewPlanInput {
  readonly access: AccessSpec;
  readonly entity: EntitySpec;
  /** そのエンティティの物理テーブル名。 */
  readonly table: string;
  readonly domain: SpecModel;
  /** 集約名 → 物理テーブル名。 */
  readonly tableOf: (entity: string) => string | null;
  readonly roles: readonly RoleDef[];
  /** プラットフォームの設定(surface を置くスキーマ・ロール名・セッション属性の枝)。 */
  readonly platform: PlatformProfile;
}

/** 組み立ての結果(写せなければ理由つきで失敗する。生成器は throw しない)。 */
export type ApiViewPlanResult =
  | { readonly ok: true; readonly plan: ApiViewPlan }
  | { readonly ok: false; readonly problems: readonly PolicyProblem[] };

/**
 * 1 つの集約から、surface に出すビュー 1 枚の計画を組み立てる。
 *
 * @param input 集約・表・ドメイン仕様・ロール定義
 * @returns ビューの計画、または理由つきの失敗
 */
export function apiViewPlan(input: ApiViewPlanInput): ApiViewPlanResult {
  const problems: PolicyProblem[] = [];
  const masks = new Map<string, ApiMaskPlan>();
  for (const rule of input.access.fieldsHidden) {
    const built = maskPlan(rule.field, rule.from, input);
    if (built.ok) masks.set(rule.field, built.plan);
    else problems.push(...built.problems);
  }
  if (problems.length > 0) return { ok: false, problems };
  const columns = input.entity.fields.map((field) => ({
    name: field.name,
    mask: masks.get(field.name) ?? null,
  }));
  return {
    ok: true,
    plan: {
      table: input.table,
      entity: input.entity.entity,
      columns,
      masks: columns.map((column) => column.mask).filter((mask): mask is ApiMaskPlan => mask !== null),
    },
  };
}

/**
 * **仕組みが自分で持つ表**(設計図が列の正を持つ内部テーブル)の surface の計画。
 *
 * 隠し列は無い —— `fields_hidden` は access_spec の宣言であり、この 2 表はドメイン仕様に
 * 現れないので隠す相手もいない。surface のロールに `select` を与えないこと(= 外から完全に見えない)
 * は権限の側で表され、ここは**列を宣言順に並べるだけ**である。
 *
 * @param table 物理テーブル名(= ビュー名)
 * @param columns 設計図が持つ列の名前(宣言順)
 * @returns ビューの計画
 */
export function frameworkApiViewPlan(table: string, columns: readonly string[]): ApiViewPlan {
  return {
    table,
    entity: null,
    columns: columns.map((name) => ({ name, mask: null })),
    masks: [],
  };
}

/**
 * 隠し列ごとの**見せてよい相手**(SQL を組み立てずに決まる部分)。
 *
 * 期待表(`code-api-expectations.ts`)はこちらだけを読む —— 述語が写せない宣言でも「その列を
 * 隠すこと」と「見てよい相手」は決まっており、そこを落とすと突合が静かに緩む。SQL が写せない
 * ことは生成器(`code-api-views.ts`)が T7 を示して止める。
 *
 * @param access その集約のアクセス宣言
 * @param table 物理テーブル名
 * @param roles role_spec の全ロール定義
 * @returns 隠し列ごとの見せてよい相手(`fields_hidden` の宣言順)
 */
export function maskVisibilities(
  access: AccessSpec,
  table: string,
  roles: readonly RoleDef[],
): readonly ApiMaskVisibility[] {
  return access.fieldsHidden.map((rule) => ({
    name: maskFunctionName(table, rule.field),
    column: rule.field,
    visibleTo: visiblePlans(access, table, roles, rule.from).map((plan) => plan.by),
  }));
}

/**
 * 刈り込む前の計画から、隠す相手を落とした残り。
 *
 * `scope: none` と内部実行ロールは `readPlans` が既に落としている(前者は行ごと見えず、
 * 後者はマスクの CASE が無条件に解く)。
 */
function visiblePlans(
  access: AccessSpec,
  table: string,
  roles: readonly RoleDef[],
  hiddenFrom: readonly string[],
): ReturnType<typeof readPlans> {
  return readPlans(access, table, roles).filter((plan) => !hiddenFrom.includes(plan.by));
}

/** 隠し列 1 つ分の述語を組み立てる。 */
function maskPlan(
  column: string,
  hiddenFrom: readonly string[],
  input: ApiViewPlanInput,
): { readonly ok: true; readonly plan: ApiMaskPlan } | { readonly ok: false; readonly problems: readonly PolicyProblem[] } {
  const name = maskFunctionName(input.table, column);
  const plans = visiblePlans(input.access, input.table, input.roles, hiddenFrom);
  const predicateInput = {
    entity: input.entity.entity,
    // 対象の行は関数の引数(レコード)である。ポリシーでは表名が別名だった位置に入る。
    table: MASK_ROW_ALIAS,
    domain: input.domain,
    tableOf: input.tableOf,
    roles: input.roles,
    // surface の側で実行者 id を与える式(土台の関数。`lib/sql/api-base.ts` が作る)。
    actorId: exposed(input.platform, 'actor_id()'),
    platform: input.platform,
  };
  const problems: PolicyProblem[] = [];
  const terms: string[] = [];
  for (const plan of plans) {
    const result = policyPredicate({ ...plan, name }, predicateInput);
    if (result.ok) terms.push(result.sql);
    else problems.push(...result.problems);
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    plan: {
      name,
      column,
      visibleTo: plans.map((plan) => plan.by),
      // 見てよい相手が 1 人もいなければ、その列は誰にも解けない(`false` は全域である)。
      predicate: terms.length === 0 ? 'false' : terms.length === 1 ? (terms[0] ?? 'false') : terms.join(' or '),
    },
  };
}

/**
 * 隠し列の述語関数の名前。
 *
 * @param table 表名
 * @param column 列名
 * @returns 関数名(スキーマ修飾なし)
 */
export function maskFunctionName(table: string, column: string): string {
  return `can_see_${table}_${column}`;
}

/**
 * その集約が surface に出るか(entity_spec と access_spec の両方を持つこと)。
 *
 * @param model ドメイン仕様
 * @returns surface に出る集約の `{ access, entity }` の組(集約名の宣言順)
 */
export function surfacedAggregates(model: SpecModel): readonly { readonly access: AccessSpec; readonly entity: EntitySpec }[] {
  return [...model.aggregates.values()]
    .map((specs) => ({ access: specs.access, entity: specs.entity }))
    .filter(
      (pair): pair is { access: AccessSpec; entity: EntitySpec } =>
        pair.access !== undefined && pair.entity !== undefined,
    );
}
