/**
 * 画面の部品のフォーム(`kind: form`)の**生成の入力**(どの部品が・どの操作の・どの欄のフォームか)。
 *
 * 画面の部品のフォームの生成器(code-screen-forms.ts)・画面の配線表の葉の表(code-screens.ts)・
 * 期待ファイル木(structure-screen-expectations.ts)が同じ導出を見る —— 導出が 3 か所に別々にあると、
 * 生成物と期待と葉の表が別の集合を持ちうる(閉世界が片方だけ古くなる)。置き場をここ 1 か所にする。
 *
 * 欄の集合と並びの正は**操作の入力**(`code-operation-inputs.ts` が生成 zod として出すものと同じ
 * 導出 = 実行計画の `inputKeys`)で、並びだけを **entity_spec の宣言の順**に揃える
 * (設計メモ screen-generation-boundary.md §5 の 10。変えたければ宣言の順を変える)。
 * 入力欄の種類の決め方は保存点の 1 画面フォームと共有する(form-control-kind.ts)。
 *
 * この導出はアプリの語彙を 1 語も持たない(W1)。**決して throw しない** —— 実行計画を組み立てられない操作
 * (`runner: manual`)を載せた部品はフォームを持たない(計画の外の操作に欄を発明しない)。
 */

import type { SpecModel } from '../../model/types.js';
import { findEntityFields } from '../../semantics/domain-index.js';
import { buildOperationPlans } from '../../usecase/operation-plan.js';
import type { BuiltOperation } from '../../usecase/operation-plan.js';
import { canonicalActionId } from '../../semantics/action-ground.js';
import type { LayoutComponent, ScreenLayout, ScreenSpec } from '../../model/screen/types.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import { toCamelCase, toPascalCase } from '../../gen-kit/code-emit.js';
import { controlKindOf } from './form-control-kind.js';
import { confirmOverlayOf, confirmRequiredOf } from './screen-confirm-plan.js';
import type { ConfirmOverlayRef } from './screen-confirm-plan.js';
import type { FormControlKind } from './usecase-form-body.js';

/**
 * 部品の testid の後ろに付く**葉の名前**(固定語)。**葉の名前の正はここ 1 か所**で、フォームの本体
 * (screen-form-body.ts)と葉の表(code-screens.ts)が同じ定数を見る — 生成物の葉と表が別の綴りを持たない。
 *
 * 葉の名前は仕組みが決める固定語であり、製品の語ではない。製品のイベント id と綴りが重なりうる
 * (`submit` など)ので、その重なりは W1 の `KNOWN_COLLISIONS` に**理由つきで宣言してある**
 * (迂回して綴りを隠さない)。語を足すときはここに足して、W1 の宣言にも足す。
 */
export const SUBMIT_LEAF = 'submit';

/** 拒否の表示の葉の名前。 */
export const ERROR_LEAF = 'error';

/**
 * 参照の欄の選択肢(`kind: form` の `reads`。選択肢の形の読み `[id, 表示名]`)。
 * 器から `options`(読みの行)を受け、生成物が自分で選択肢にする。
 */
export interface RefChoice {
  /** 読みの source のエンティティ(参照先。選択肢の行の型の材料)。 */
  readonly entity: string;
  /** 表示名の欄(読みの projection の `id` 以外の 1 欄)。 */
  readonly labelField: string;
  /** 欄が必須か(必須でも未選択の選択肢を先頭に置く — 必須なら未選択では送れない)。 */
  readonly required: boolean;
}

/** 入力欄を出す欄 1 つ(参照の欄は `ref` を持つ)。 */
export interface ScreenFormControl {
  readonly field: string;
  readonly kind: FormControlKind;
  readonly ref?: RefChoice;
}

/** 部品のフォーム 1 つの生成の入力。 */
export interface ScreenFormPlan {
  /** 画面名(snake_case)。testid の名前空間。 */
  readonly screen: string;
  /** 部品名(snake_case)。 */
  readonly component: string;
  /**
   * 部品の testid のキー(`{画面名}TestIds` のキーと同じ。重ね表示の部品は `overlay.{id}.` が前置きされる)。
   * 例: `body.center.{部品}`。
   */
  readonly path: string;
  /** 部品の表示名(`label`。宣言があるときだけ。見出しと送信ボタンの文言の材料)。 */
  readonly label?: string;
  /** 載せる操作(正式な ID)。 */
  readonly action: string;
  /** 操作の形。 */
  readonly shape: 'create' | 'update';
  /** 操作の集約のエンティティ名({entity}FieldLabels の材料)。 */
  readonly entity: string;
  /** 入力欄を出す欄(entity_spec の宣言の順)。 */
  readonly controls: readonly ScreenFormControl[];
  /** 入力欄を出さず、器が `initial` で渡す欄(参照・識別子。編集の対象の識別子 `id` もここ)。 */
  readonly supplied: readonly string[];
  /** 選択欄(`enum`。参照の欄の選択肢は除く)を持つか(`{entity}.labels.ts` を引く)。 */
  readonly hasEnumLabels: boolean;
  /**
   * 送信の前に確認ダイアログを挟むか(操作の属性 `confirmRequired` = 方針の導出の結果)。
   * 真なら生成物は既存部品 `ConfirmDialog` を挟み、確認の文言は生成物 `action-attributes` から引く。
   */
  readonly confirmRequired: boolean;
  /**
   * 確認の器(その部品を `opened_by` に持ち、この操作を `actions` に含む重ね表示。S19 が宣言を要求する)。
   * 確認が要るのに重ね表示が無ければ持たない(検査が先に止める。生成物は確認の配線を出さない)。
   */
  readonly confirmOverlay?: ConfirmOverlayRef;
  /** 生成物のファイル名(`_screens/generated/` からの相対)。 */
  readonly file: string;
  /** 生成物の export 名。 */
  readonly exportName: string;
}

/** 部品のフォームの生成物のファイル名(`{画面名}.{部品名}.tsx`)。 */
export function screenFormFile(screen: string, component: string): string {
  return `${screen}.${component}.tsx`;
}

/** 部品のフォームの生成物の export 名(`{Pascal(画面名)}{Pascal(部品名)}`)。 */
export function screenFormExport(screen: string, component: string): string {
  return `${toPascalCase(screen)}${toPascalCase(component)}`;
}

/** 画面名 → testid の定数名(`{camel(画面名)}TestIds`)。生成物 testids.ts の命名規約と同じ。 */
export function screenTestIdsName(screen: string): string {
  return `${toCamelCase(screen)}TestIds`;
}

/** 画面名 → 表示名の表の定数名(`{camel(画面名)}Labels`)。 */
export function screenLabelsName(screen: string): string {
  return `${toCamelCase(screen)}Labels`;
}

/**
 * 全画面の `kind: form` の部品から、フォーム 1 つぶんの生成の入力を導く。
 *
 * @param model ドメイン仕様
 * @param ctx 生成の文脈(画面仕様・action_spec・data_table などの入力)
 * @returns フォームの生成の入力(画面の宣言順 → 画面本体の部品 → 重ね表示の部品)
 */
export function buildScreenForms(model: SpecModel, ctx: GenerateContext): readonly ScreenFormPlan[] {
  const screens = ctx.screens;
  if (screens === undefined || !screens.available) return [];
  const byOp = builtOperationsOf(model, ctx);
  const plans: ScreenFormPlan[] = [];
  for (const screen of screens.screens) {
    for (const found of formComponentsOf(screen)) {
      const plan = planOf(model, ctx, screen, found, byOp);
      if (plan !== null) plans.push(plan);
    }
  }
  return plans;
}

/** 実行計画を組み立て済みの操作(生成の文脈ごとに 1 回)。 */
const BUILT = new WeakMap<GenerateContext, { readonly model: SpecModel; readonly byOp: ReadonlyMap<string, BuiltOperation> }>();

/**
 * 操作 ID(正式な ID)→ 実行計画つきの操作。
 *
 * @param model ドメイン仕様
 * @param ctx 生成の文脈(action_spec・data_table・job_spec)
 * @returns 計画を組み立てられた操作の表(`runner: manual` の操作は載らない)
 */
export function builtOperationsOf(model: SpecModel, ctx: GenerateContext): ReadonlyMap<string, BuiltOperation> {
  const cached = BUILT.get(ctx);
  if (cached !== undefined && cached.model === model) return cached.byOp;
  const built = buildOperationPlans({
    domain: model,
    guards: ctx.guards,
    actions: ctx.actions,
    dataTables: ctx.dataTables,
    jobs: ctx.jobs,
  });
  const byOp = new Map(built.operations.map((operation) => [operation.op, operation]));
  BUILT.set(ctx, { model, byOp });
  return byOp;
}

/** 画面の `kind: form` の部品と、その testid のキー。 */
interface FoundForm {
  readonly component: LayoutComponent;
  readonly path: string;
}

/** 画面本体 → 重ね表示の順に `kind: form` の部品を拾う。 */
function formComponentsOf(screen: ScreenSpec): readonly FoundForm[] {
  return [
    ...foundIn(screen.layout, ''),
    ...screen.overlays.flatMap((overlay) => foundIn(overlay.layout, `overlay.${overlay.id}.`)),
  ];
}

/** レイアウトの `kind: form` の部品(`prefix` は重ね表示の名前空間)。 */
function foundIn(layout: ScreenLayout, prefix: string): readonly FoundForm[] {
  return layout.slots.flatMap((slot) =>
    slot.components
      .filter((component) => component.kind === 'form')
      .map((component) => ({ component, path: `${prefix}${slot.path}.${component.name}` })),
  );
}

/** 操作の入力から導く、フォームの欄(入力欄を出す欄 `controls` と、器が `initial` で渡す欄 `supplied`)。 */
export interface FormDerivation {
  readonly shape: 'create' | 'update';
  readonly entity: string;
  readonly controls: readonly ScreenFormControl[];
  readonly supplied: readonly string[];
}

/**
 * 作成・編集の操作から、フォームの欄を導く(フォームの部品と、編集する表の行が同じ導出を見る)。
 *
 * @param model ドメイン仕様
 * @param ctx 生成の文脈
 * @param operation 実行計画つきの操作(作成か編集でなければ null)
 * @param optionsRead 参照の欄の選択肢の読みを載せた部品(`kind: form` の `reads`。無ければ undefined)
 * @returns 欄の導出。作成でも編集でもない・計画の外の操作は null
 */
export function deriveFormFields(
  model: SpecModel,
  ctx: GenerateContext,
  operation: BuiltOperation | undefined,
  optionsRead: LayoutComponent | undefined,
): FormDerivation | null {
  const step = operation?.plan.steps[0];
  if (operation === undefined || step === undefined) return null;
  if (step.kind !== 'create' && step.kind !== 'update') return null;
  const order = (findEntityFields(model, step.entity) ?? []).map((field) => field.name);
  const keys = [...(operation.facts.steps[0]?.inputKeys ?? [])].sort(
    (a, b) => position(order, a) - position(order, b),
  );
  const controls: ScreenFormControl[] = [];
  const supplied: string[] = [];
  const refs = optionsRead === undefined ? new Map<string, RefChoice>() : refChoicesOf(model, ctx, optionsRead, step.entity, keys);
  for (const key of keys) {
    const field = (findEntityFields(model, step.entity) ?? []).find((candidate) => candidate.name === key);
    const kind = field === undefined ? null : controlKindOf(field.type.kind);
    const ref = refs.get(key);
    if (ref !== undefined) controls.push({ field: key, kind: 'select', ref });
    else if (kind === null) supplied.push(key);
    else controls.push({ field: key, kind });
  }
  return { shape: step.kind, entity: step.entity, controls, supplied };
}

/** 部品 1 つの計画(操作を読めない・計画の外の操作・作成でも編集でもないものは null)。 */
function planOf(
  model: SpecModel,
  ctx: GenerateContext,
  screen: ScreenSpec,
  found: FoundForm,
  byOp: ReadonlyMap<string, BuiltOperation>,
): ScreenFormPlan | null {
  const id = found.component.actionRefs?.[0]?.id;
  if (id === undefined) return null;
  const op = canonicalActionId(model, id) ?? id;
  const derived = deriveFormFields(model, ctx, byOp.get(op), found.component);
  if (derived === null) return null;
  const confirmRequired = confirmRequiredOf(model, ctx, op);
  const confirmOverlay = confirmRequired ? confirmOverlayOf(model, screen, found.component.name, op) : undefined;
  return {
    screen: screen.name,
    component: found.component.name,
    path: found.path,
    ...(found.component.label === undefined ? {} : { label: found.component.label }),
    action: op,
    shape: derived.shape,
    entity: derived.entity,
    controls: derived.controls,
    supplied: derived.supplied,
    hasEnumLabels: derived.controls.some((control) => control.kind === 'select' && control.ref === undefined),
    confirmRequired,
    ...(confirmOverlay === undefined ? {} : { confirmOverlay }),
    file: screenFormFile(screen.name, found.component.name),
    exportName: screenFormExport(screen.name, found.component.name),
  };
}

/**
 * 部品の `reads`(選択肢の読み)が効く参照の欄(欄の名前 → 選択肢)。
 *
 * 効くのは**読みの source を指す ref の欄がちょうど 1 つ**のときだけ(S18 が 0 / 2 つ以上を error にしている — 検査を
 * 通った仕様では常に 1 つ。生成器は throw せず、読めなければ効かせない)。表示名の欄は projection の `id` 以外の 1 欄。
 */
function refChoicesOf(
  model: SpecModel,
  ctx: GenerateContext,
  component: LayoutComponent,
  entity: string,
  keys: readonly string[],
): ReadonlyMap<string, RefChoice> {
  const query = ctx.queries?.queries.find((candidate) => candidate.id === component.readRef?.id);
  const labelField = query?.projection.find((field) => field.name !== 'id')?.name;
  if (query === undefined || labelField === undefined || query.projection.length !== 2) return new Map();
  const matching = (findEntityFields(model, entity) ?? []).filter(
    (field) => keys.includes(field.name) && field.type.kind === 'ref' && field.type.entity === query.source,
  );
  const [only] = matching;
  if (only === undefined || matching.length !== 1) return new Map();
  return new Map([[only.name, { entity: query.source, labelField, required: only.required }]]);
}

/** 宣言の順での位置(宣言に無い欄は末尾)。 */
function position(order: readonly string[], key: string): number {
  const at = order.indexOf(key);
  return at === -1 ? order.length : at;
}
