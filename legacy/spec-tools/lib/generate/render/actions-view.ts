/**
 * 操作の索引(book/actions-page.ts と actions-index.ts が共有するデータ)の組み立て。
 *
 * どちらも「action_spec 1 本 = 1 行」の同じ情報を見せる —
 * ハンドブックの章は集約ごとに束ねて全列を、specs 側の索引は簡潔な列だけを出す。
 * 見せ方が違うだけで中身は同じでなければならないため、行の組み立てはここに 1 つだけ置く
 * (2 か所で別々に組み立てると「章と索引で操作の集合がずれる」穴になる)。
 *
 * 操作 ID のドメイン仕様への接地(状態遷移 / 作成 / 削除 / 編集)は spec-body.ts の
 * groundOperation を再利用する(action-body.ts と同じ土台。二重実装しない)。
 */

import type { SpecModel } from '../../model/types.js';
import type { ActionSpec, ActionSpecModel } from '../../model/trace/types.js';
import type { EventEntry, UpdateEntry } from '../../semantics/domain-index.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import { deriveActionAttributes, type ActionAttributes } from './action-attributes-derive.js';
import { groundingRoles } from './spec-body.js';
import { groundOperation, type OperationGrounding } from '../../semantics/operation-ground.js';
import { withLabel } from '../../gen-kit/state-machine-table.js';

/** 操作索引の 1 行(action_spec 1 本分)。 */
export interface ActionRow {
  /** 元の action_spec(handles / input / test_cases / relPath の出どころ)。 */
  readonly action: ActionSpec;
  /** 接地先の集約名(specs/domain のディレクトリ名)。接地できていなければ空文字。 */
  readonly aggregate: string;
  /** 何をするか(状態遷移: `from → to(label)` / 作成・削除・編集の日本語)。 */
  readonly doingText: string;
  /** 実行できるロール(宣言順。system も含む)。 */
  readonly byRoles: readonly string[];
  /** この操作で起きる副作用(state_spec の effects。作成・削除・編集は常に空)。 */
  readonly effects: readonly string[];
  /** 事実 9 属性 + 方針(action-spec-writing.md「方針の導出」)。 */
  readonly attributes: ActionAttributes;
}

/**
 * action_spec の全件から索引の行を組み立てる。
 *
 * `actions.actions` の宣言順(ローダーがディレクトリを歩いた順)をそのまま保つ —
 * 章側はここから集約ごとに絞り込み(`actionRowsByAggregate`)、索引側はこの順のまま使う。
 *
 * @param model ドメイン仕様全体(handles の接地先)
 * @param actions 読み込み済みの action_spec 一式
 * @param ctx 生成器の共有文脈(属性導出が読む dataTables / jobs / notifications)
 */
export function buildActionRows(model: SpecModel, actions: ActionSpecModel, ctx: GenerateContext): ActionRow[] {
  return actions.actions.map((action) => {
    const grounding = groundOperation(model, action.handles.raw);
    return {
      action,
      aggregate: aggregateOf(grounding),
      doingText: doingTextOf(grounding),
      byRoles: groundingRoles(grounding),
      effects: effectsOf(grounding),
      attributes: deriveActionAttributes(model, ctx, action),
    };
  });
}

/**
 * 索引の行を集約ごとに束ねる(ハンドブックの章が集約の節を切るための入力)。
 *
 * 束ねる順は `model.aggregates` の宣言順(ドメイン仕様の集約の並びと同じ)にする —
 * 集約の章(html/aggregate-chapter.ts)・可視性の章と同じ並びで読めるようにするため。
 * 1 本も操作を持たない集約は出さない(空の節を並べても読み手には何も伝わらない)。
 *
 * @param model ドメイン仕様全体(集約の宣言順の出どころ)
 * @param rows buildActionRows が返した全行
 */
export function actionRowsByAggregate(
  model: SpecModel,
  rows: readonly ActionRow[],
): ReadonlyMap<string, ActionRow[]> {
  const byAggregate = new Map<string, ActionRow[]>();
  for (const name of model.aggregates.keys()) {
    const forAggregate = rows.filter((row) => row.aggregate === name);
    if (forAggregate.length > 0) byAggregate.set(name, forAggregate);
  }
  return byAggregate;
}

/** 接地結果から集約名を引く。接地できていなければ空文字(verify 通過後には現れない)。 */
function aggregateOf(grounding: OperationGrounding): string {
  return grounding.kind === 'unknown' ? '' : grounding.entry.aggregate;
}

/** 「何をするか」の表記(種別ごとに形が違う)。 */
function doingTextOf(grounding: OperationGrounding): string {
  switch (grounding.kind) {
    case 'transition':
      return transitionText(grounding.entry);
    case 'create':
      return '作成';
    case 'delete':
      return '削除';
    case 'update':
      return `編集(${updateFieldsText(grounding.entry)})`;
    default:
      return '?(ドメイン仕様に接地先が見つからない)';
  }
}

/** 状態遷移の表記: `from → to`(state_spec のイベント label があれば併記)。 */
function transitionText(entry: EventEntry): string {
  const { machine, event } = entry;
  const state = (id: string): string => withLabel(id, machine.stateLabels[id]);
  const transition = `${event.from.map(state).join(', ')} → ${state(event.to)}`;
  return event.label === undefined ? transition : `${transition}(${event.label})`;
}

/** 編集の対象フィールド(全ロールの writes を合わせた重複無しの一覧)。 */
function updateFieldsText(entry: UpdateEntry): string {
  const fields = new Set<string>();
  for (const rule of entry.rules) {
    for (const field of rule.fields) fields.add(field);
  }
  return [...fields].join(', ');
}

/**
 * 起きること(state_spec の effects)。作成・削除・編集は access_spec の宣言に effects が
 * 無いため常に空(action-body.ts の groundingTable と同じ絞り込み)。
 */
function effectsOf(grounding: OperationGrounding): readonly string[] {
  if (grounding.kind !== 'transition') return [];
  const { machine, event } = grounding.entry;
  return machine.effects
    .filter((effect) => effect.on === event.id || effect.on === `${machine.machine}.${event.id}`)
    .flatMap((effect) => effect.do);
}
