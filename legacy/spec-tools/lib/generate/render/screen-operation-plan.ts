/**
 * 操作を載せる表・ボタン列(`kind: table` の `edit` / `actions`・`kind: actions`)の**生成の入力**
 * (どの操作が行の編集か・どの操作が行のボタンか・確認の器はどの重ね表示か)。
 *
 * 表・ボタン列の生成器(code-screen-tables.ts)・画面の配線表の葉の表(code-screens.ts)・期待ファイル木が同じ導出を
 * 見る(読む表と同じ理由 — screen-read-plan.ts)。ADR-0015 の改訂 2 の実装である。
 *
 * - **編集**: `edit` の操作(`shape: update`)の入力から、入力欄を出す欄と器が渡す欄を導く(フォームの部品と同じ導出)。
 * - **ボタン**: `actions` の要素のうち、`reads` の source の状態機械のイベント(遷移)と source の削除(`delete`)。
 *   遷移は**遷移表の宣言順**(機械ごと)、削除はそのあと宣言順。作成・編集・source でない操作は載せない
 *   (S19 が先に止める — 生成器は throw せず、読めない宣言は黙って落とす)。
 * - **確認の器**: 確認が要る操作(`confirm_required`)には、その部品を `opened_by` に持つ重ね表示(screen-confirm-plan.ts)。
 *
 * この導出はアプリの語彙を 1 語も持たない(W1)。**決して throw しない**。
 */

import type { SpecModel } from '../../model/types.js';
import { canonicalActionId } from '../../semantics/action-ground.js';
import type { LayoutComponent, ScreenSpec } from '../../model/screen/types.js';
import { findDelete, findEntityFields, findEvent, isDeleteId } from '../../semantics/domain-index.js';
import { findDisplayField } from '../../semantics/entity-display.js';
import type { BuiltOperation } from '../../usecase/operation-plan.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import { confirmOverlayOf, confirmRequiredOf } from './screen-confirm-plan.js';
import type { ConfirmOverlayRef } from './screen-confirm-plan.js';
import { deriveFormFields } from './screen-form-plan.js';
import type { ScreenFormControl } from './screen-form-plan.js';

/** 行の保存ボタンの葉の名前(固定語。生成物と葉の表が同じ定数を見る)。 */
export const SAVE_LEAF = 'save';

/** 行の保存の拒否の表示の葉の名前。 */
export const ROW_ERROR_LEAF = 'row_error';

/** 行をその場で編集する操作(`edit`)の生成の入力。 */
export interface TableEdit {
  /** 編集の操作(正式な ID)。 */
  readonly action: string;
  /** 編集の対象のエンティティ名({entity}FieldLabels の材料)。 */
  readonly entity: string;
  /** 入力欄を出す欄(entity_spec の宣言の順)。 */
  readonly controls: readonly ScreenFormControl[];
  /** 入力欄を出さず、行から `initial` に写す欄(識別子・参照)。 */
  readonly supplied: readonly string[];
  /** 選択欄(`enum`)を持つか(`{entity}EnumLabels` を引く)。 */
  readonly hasEnumLabels: boolean;
}

/** 行のボタン 1 つ(遷移か削除)。 */
export interface ButtonOperation {
  /** 操作(正式な ID)。 */
  readonly op: string;
  /** ボタンの葉の名前(遷移はイベントの名前・削除は `delete`)。 */
  readonly leaf: string;
  readonly kind: 'transition' | 'delete';
  /** 遷移のとき: 状態機械の名前。 */
  readonly machine?: string;
  /** 遷移のとき: イベントの名前(`{machine}.{event}` の後半)。 */
  readonly event?: string;
  /** 遷移のとき: イベントが `label` を持つか(無ければボタンの文言はイベントの名前)。 */
  readonly labelled?: boolean;
  /** 遷移のとき: 行の型の中の状態の欄(source エンティティの欄の名前。snake_case)。 */
  readonly stateField?: string;
  /** 確認が要るとき: 確認の器(重ね表示)。 */
  readonly overlay?: ConfirmOverlayRef;
  /**
   * 入力の型(生成 zod `operationInputSchemas`)を持つか。実行計画で走る操作は持つ。`runner: manual` の操作は
   * 計画の外にあり持たない — その入力は対象の識別子だけ(遷移・削除のボタンが渡すのは `{ id }`)として型を書く。
   */
  readonly typed: boolean;
}

/** 部品のボタンの生成の入力。 */
export interface ButtonsPlan {
  /** 行のボタン(遷移 → 削除の順)。 */
  readonly operations: readonly ButtonOperation[];
  /** 遷移のボタンがあるか(実行者のロールを器から受ける)。 */
  readonly needsRole: boolean;
  /**
   * 確認の本文に出す行の名前の欄(source の集約の `display_field`)。確認の器を持つボタンがあり、読みの projection が
   * その欄を返すときだけ持つ(行の型にその欄が要るので、返さない読みには要求しない)。名前は生成物が client 側で行から引く。
   */
  readonly subjectField?: string;
}

/** 部品の操作の生成の入力(編集・ボタン・行の型に足す欄)。 */
export interface OperationParts {
  readonly edit?: TableEdit;
  readonly buttons?: ButtonsPlan;
  /** 行の型に足す欄(読みの `shows` の欄のほかに、編集の入力欄と状態の欄が要る)。source エンティティの欄の名前。 */
  readonly extraFields: readonly string[];
}

/**
 * 部品の `edit` / `actions` から、操作の生成の入力を導く。
 *
 * @param model ドメイン仕様
 * @param ctx 生成の文脈
 * @param screen 部品が居る画面
 * @param component 部品
 * @param source 部品が読む読みの source のエンティティ名
 * @param projection 部品が読む読みの projection の欄の名前(行の名前の欄を返すかを見る)
 * @param byOp 実行計画つきの操作
 * @returns 編集とボタンと行の型に足す欄(宣言が無ければ空)
 */
export function operationPartsOf(
  model: SpecModel,
  ctx: GenerateContext,
  screen: ScreenSpec,
  component: LayoutComponent,
  source: string,
  projection: readonly string[],
  byOp: ReadonlyMap<string, BuiltOperation>,
): OperationParts {
  const edit = editOf(model, ctx, component, source, byOp);
  const buttons = withSubject(model, source, projection, buttonsOf(model, ctx, screen, component, source, byOp));
  const extraFields = [
    ...(edit === undefined ? [] : [...edit.controls.map((control) => control.field), ...edit.supplied]),
    ...(buttons?.operations.flatMap((operation) => (operation.stateField === undefined ? [] : [operation.stateField])) ?? []),
    ...(buttons?.subjectField === undefined ? [] : [buttons.subjectField]),
  ];
  return {
    ...(edit === undefined ? {} : { edit }),
    ...(buttons === undefined ? {} : { buttons }),
    extraFields: [...new Set(extraFields)],
  };
}

/**
 * 確認の器を持つボタンがあり、source の集約が `display_field` を宣言し、読みがその欄を返すときだけ、確認の本文に出す
 * 行の名前の欄を計画に足す。**読みが返さない欄は要求しない**(要求すると、器が渡す行の型が満たせずアプリの型検査で落ちる —
 * 生成は throw せず、名前を出さない側に倒す)。
 */
function withSubject(
  model: SpecModel,
  source: string,
  projection: readonly string[],
  buttons: ButtonsPlan | undefined,
): ButtonsPlan | undefined {
  if (buttons === undefined || !buttons.operations.some((operation) => operation.overlay !== undefined)) return buttons;
  const field = findDisplayField(model, source);
  return field === undefined || !projection.includes(field) ? buttons : { ...buttons, subjectField: field };
}

/** `edit`(編集で、source のエンティティの編集のときだけ)。 */
function editOf(
  model: SpecModel,
  ctx: GenerateContext,
  component: LayoutComponent,
  source: string,
  byOp: ReadonlyMap<string, BuiltOperation>,
): TableEdit | undefined {
  const id = component.editRef?.id;
  if (id === undefined) return undefined;
  const action = canonicalActionId(model, id) ?? id;
  const derived = deriveFormFields(model, ctx, byOp.get(action), undefined);
  if (derived === null || derived.shape !== 'update' || derived.entity !== source) return undefined;
  return {
    action,
    entity: derived.entity,
    controls: derived.controls,
    supplied: derived.supplied,
    hasEnumLabels: derived.controls.some((control) => control.kind === 'select'),
  };
}

/** `actions`(遷移 → 削除の順。作成・編集・source でない操作は落とす)。 */
function buttonsOf(
  model: SpecModel,
  ctx: GenerateContext,
  screen: ScreenSpec,
  component: LayoutComponent,
  source: string,
  byOp: ReadonlyMap<string, BuiltOperation>,
): ButtonsPlan | undefined {
  const refs = (component.buttonRefs ?? []).map((ref) => canonicalActionId(model, ref.id) ?? ref.id);
  if (refs.length === 0) return undefined;
  const ordered = [...transitionsOf(model, source, refs), ...deletesOf(model, source, refs)];
  const operations = ordered.map((operation) => {
    const overlay = confirmRequiredOf(model, ctx, operation.op) ? confirmOverlayOf(model, screen, component.name, operation.op) : undefined;
    const typed = byOp.has(operation.op);
    return { ...operation, typed, ...(overlay === undefined ? {} : { overlay }) };
  });
  return operations.length === 0 ? undefined : { operations, needsRole: operations.some((operation) => operation.kind === 'transition') };
}

/** 遷移のボタン(source の状態機械のイベント。機械は宣言された順・イベントは遷移表の宣言順)。`typed` は呼び側が決める。 */
function transitionsOf(model: SpecModel, source: string, ids: readonly string[]): readonly Untyped[] {
  const entries = ids.flatMap((id) => {
    const entry = findEvent(model, id);
    const field = (findEntityFields(model, source) ?? []).find(
      (candidate) => candidate.type.kind === 'state' && candidate.type.machine === entry?.machine.machine,
    );
    return entry === null || field === undefined ? [] : [{ entry, field: field.name }];
  });
  const machines = [...new Set(entries.map(({ entry }) => entry.machine.machine))];
  return entries
    .map((found) => ({
      found,
      rank: machines.indexOf(found.entry.machine.machine) * 10_000 + found.entry.machine.events.findIndex((event) => event.id === found.entry.event.id),
    }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ found }) => ({
      op: found.entry.id,
      leaf: found.entry.event.id,
      kind: 'transition' as const,
      machine: found.entry.machine.machine,
      event: found.entry.event.id,
      labelled: found.entry.event.label !== undefined,
      stateField: found.field,
    }));
}

/** 入力の型の有無を決める前のボタン。 */
type Untyped = Omit<ButtonOperation, 'typed'>;

/** 削除のボタン(source の削除。宣言順)。 */
function deletesOf(model: SpecModel, source: string, ids: readonly string[]): readonly Untyped[] {
  return ids
    .filter((id) => isDeleteId(id) && findDelete(model, id)?.entity === source)
    .map((id) => ({ op: id, leaf: 'delete', kind: 'delete' as const }));
}
