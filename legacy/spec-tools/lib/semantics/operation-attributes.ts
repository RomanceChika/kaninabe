/**
 * 操作 1 本の「事実 9 属性 + 確認方針」の導出(意味解析の層)。
 *
 * 正: docs/rules/process/backend/specification/standards/action-spec-writing.md
 *     「方針の導出（confirm_required / variant）と ux（上書き）」。
 *
 * **検証(Y5 の確認の数え方)も、画面・文書の生成も、この 1 つの関数の結果を読む。**
 * 入力は「ドメイン仕様のモデル + カタログ(テーブル仕様・ジョブ・通知)+ 操作 ID + その action_spec」
 * だけで、出力は事実と方針の**真偽と材料**である。日本語の文言(根拠・確認ダイアログの注意書き)は
 * ここに無い —— 出力側(`generate/render/action-attributes-derive.ts`)が、ここで返した材料から
 * 組み立てる。導出は「宣言から機械的に決まるもの」に限り、表現できない意味は宣言(tone / settles /
 * ux)を足して解決する(この関数の中に業務判断を書かない)。
 */

import type { SpecModel, StateMachineSpec, StateTone } from '../model/types.js';
import type { ActionSpec, InputFieldRef } from '../model/trace/types.js';
import { groundOperation, type OperationGrounding } from './operation-ground.js';
import type { OperationCatalogs } from './operation-catalogs.js';
import {
  clearedPersonalColumns,
  hasNonOwnerRole,
  inputTouchesPersonal,
  isScheduled,
  notificationRecipientKind,
  reachableFrom,
  requiresElevatedRole,
} from './operation-facts.js';
import { cascadeFacts, type CascadeFacts } from './operation-cascade.js';

/** 遷移形の根拠の材料(どの宣言から事実が決まったか)。 */
export interface TransitionEvidence {
  readonly kind: 'transition';
  readonly machine: string;
  readonly eventId: string;
  readonly from: readonly string[];
  readonly to: string;
  /** to から from のどれかへ戻る経路が有るか(irreversible の反対)。 */
  readonly hasReturnPath: boolean;
  readonly tone: StateTone | undefined;
  /** 着地の状態が確定させるものの id(宣言順)。 */
  readonly settlesIds: readonly string[];
  /** 実行できるロール(`by`)。 */
  readonly by: readonly string[];
  /** `by` に対象行の所有者でない実行者が混ざるか。 */
  readonly nonOwner: boolean;
  /** この遷移の effects に並ぶジョブ ID。 */
  readonly jobIds: readonly string[];
  /** 連鎖(同じトランザクションで他の行に及ぶ書き込み)の事実。 */
  readonly cascade: CascadeFacts;
  /** この遷移が空にする personal 列(state_spec の `clears` ∩ personal。destructive / touches_personal の材料)。 */
  readonly clearedPersonal: readonly string[];
}

/** 作成・削除・編集(予約 ID)形の根拠の材料。 */
export interface AccessEvidence {
  readonly kind: 'access';
  readonly entity: string;
  readonly op: 'create' | 'delete' | 'update';
  readonly by: readonly string[];
  readonly nonOwner: boolean;
  /** 削除が、personal 列を持つ行を消すか。 */
  readonly deletesPersonalRow: boolean;
}

/** 根拠の材料。`unknown` は接地先が無い(verify 通過後には現れない)。 */
export type OperationEvidence = TransitionEvidence | AccessEvidence | { readonly kind: 'unknown' };

/** 事実 9 属性 + 確認方針 + 根拠の材料。 */
export interface OperationAttributes {
  readonly irreversible: boolean;
  readonly terminal: boolean;
  readonly destructive: boolean;
  readonly affectsOthers: boolean;
  readonly outbound: boolean;
  readonly bulk: boolean;
  readonly scheduled: boolean;
  readonly privileged: boolean;
  readonly touchesPersonal: boolean;
  /** tone: negative への遷移か(9 属性そのものではないが、方針の導出の直接の入力)。 */
  readonly negativeTone: boolean;
  /** settles を持つ状態への遷移か(同上)。 */
  readonly settles: boolean;
  /** 着地の状態が確定させるものの表示名(確認文言の材料。無ければ空)。 */
  readonly settlesLabels: readonly string[];
  /** 導出結果(ux による上書き適用後)。**確認ダイアログが要るか**の唯一の答え。 */
  readonly confirmRequired: boolean;
  readonly variant: 'default' | 'danger';
  /** ux の上書きを適用したか。 */
  readonly overridden: boolean;
  readonly evidence: OperationEvidence;
}

/** 事実だけ(方針を決める前)。 */
type Facts = Omit<OperationAttributes, 'confirmRequired' | 'variant' | 'overridden'>;

/** 未接地(unknown)なときの安全側の既定値。 */
function unknownFacts(): Facts {
  return {
    irreversible: false,
    terminal: false,
    destructive: false,
    affectsOthers: false,
    outbound: false,
    bulk: false,
    scheduled: false,
    privileged: false,
    touchesPersonal: false,
    negativeTone: false,
    settles: false,
    settlesLabels: [],
    evidence: { kind: 'unknown' },
  };
}

/** 状態遷移(transition 形)の属性を導出する。 */
function transitionFacts(
  model: SpecModel,
  catalogs: OperationCatalogs,
  input: readonly InputFieldRef[],
  aggregate: string,
  machine: StateMachineSpec,
  eventId: string,
): Facts {
  const event = machine.events.find((e) => e.id === eventId);
  if (event === undefined) return unknownFacts();

  const hasReturnPath = event.from.some((f) => reachableFrom(machine, event.to).has(f));
  const irreversible = !hasReturnPath;
  const settlesIds = machine.stateSettles[event.to] ?? [];
  const tone = machine.stateTone[event.to];
  const nonOwner = hasNonOwnerRole(event.by, model.roles.roles, aggregate);

  const jobIds = machine.effects.filter((e) => e.on === eventId).flatMap((e) => e.do);
  const hasSnapshot = machine.effects.some((e) => e.on === eventId && e.snapshot !== undefined);
  const outboundPublic = jobIds.some((id) => notificationRecipientKind(catalogs, id) === 'channel');
  const cascade = cascadeFacts(model, catalogs, { aggregate, machine: machine.machine, event: `${machine.machine}.${eventId}`, jobIds });
  const clearedPersonal = clearedPersonalColumns(model.aggregates.get(aggregate)?.entity, event);

  return {
    irreversible,
    terminal: machine.final.includes(event.to),
    // 空にする個人列は、その遷移で値が消える(scrub と同じ重さ)。
    destructive: cascade.destructive || clearedPersonal.length > 0,
    affectsOthers: nonOwner || cascade.touchesOtherAggregate,
    outbound: outboundPublic || hasSnapshot,
    // bulk: この 1 回の操作が複数のものを同時に動かすか。「予約 ID update」は複数フィールド、
    // 「複合 RPC」は複数テーブルを同時に書く、という 2 つの実例をどちらも bulk として扱う
    // (action-spec-writing.md「方針の導出」の bulk 注釈。遷移には予約 update の側は無い)。
    bulk: cascade.compositeUsed,
    scheduled: isScheduled(event.by, [event.guard], model.roles.roles),
    privileged: requiresElevatedRole(event.by, model.roles.roles),
    touchesPersonal: inputTouchesPersonal(model, input) || cascade.touchesPersonal || clearedPersonal.length > 0,
    negativeTone: tone === 'negative',
    settles: settlesIds.length > 0,
    settlesLabels: settlesIds.map((id) => machine.settlesVocabulary[id] ?? id),
    evidence: {
      kind: 'transition',
      machine: machine.machine,
      eventId,
      from: event.from,
      to: event.to,
      hasReturnPath,
      tone,
      settlesIds,
      by: event.by,
      nonOwner,
      jobIds,
      cascade,
      clearedPersonal,
    },
  };
}

/** create / delete / update(予約 ID)形の属性を導出する。 */
function accessFacts(
  model: SpecModel,
  input: readonly InputFieldRef[],
  grounding: Extract<OperationGrounding, { kind: 'create' | 'delete' | 'update' }>,
): Facts {
  const { entry } = grounding;
  const by = [...new Set(entry.rules.map((rule) => rule.by))];
  const guards = entry.rules.map((rule) => rule.when);
  const isDelete = grounding.kind === 'delete';
  const nonOwner = hasNonOwnerRole(by, model.roles.roles, entry.aggregate);

  // 削除は対象行を丸ごと消す — 行が personal 列を 1 つでも持てば、その値も消える
  // (entity_spec: 由来は個々のフィールドではなく「行そのもの」)。
  const entityFields = model.aggregates.get(entry.aggregate)?.entity?.fields ?? [];
  const deletesPersonalRow = isDelete && entityFields.some((field) => field.personal);

  return {
    irreversible: isDelete,
    terminal: isDelete,
    destructive: isDelete,
    affectsOthers: nonOwner,
    outbound: false,
    bulk: grounding.kind === 'update',
    scheduled: isScheduled(by, guards, model.roles.roles),
    privileged: requiresElevatedRole(by, model.roles.roles),
    touchesPersonal: inputTouchesPersonal(model, input) || deletesPersonalRow,
    // create / delete / update(予約 ID)は state_spec の状態を持たないため tone / settles は無い。
    negativeTone: false,
    settles: false,
    settlesLabels: [],
    evidence: { kind: 'access', entity: entry.entity, op: grounding.kind, by, nonOwner, deletesPersonalRow },
  };
}

/** 方針(confirm_required / variant)を事実と ux 上書きから決める。 */
function resolvePolicy(
  facts: Facts,
  action: ActionSpec | undefined,
): Pick<OperationAttributes, 'confirmRequired' | 'variant' | 'overridden'> {
  const derived = facts.negativeTone || facts.destructive || (facts.irreversible && facts.affectsOthers) || facts.settles;
  const override = action?.ux;
  const confirmRequired = override === undefined ? derived : override.confirm === 'required';
  return {
    confirmRequired,
    variant: confirmRequired ? 'danger' : 'default',
    overridden: override !== undefined,
  };
}

/**
 * 操作 1 本の属性(事実 9 属性 + 確認方針)を導出する。
 *
 * @param model ドメイン仕様全体
 * @param catalogs テーブル仕様・ジョブ・通知のカタログ(生成でも検証でも同じものを渡す)
 * @param op 操作 ID(`{machine}.{event}` または予約 ID)
 * @param action その操作の action_spec(`input` の personal 判定と `ux` の上書きに使う。無ければ両方なし)
 * @returns 事実と方針と、根拠の材料
 */
export function deriveOperationAttributes(
  model: SpecModel,
  catalogs: OperationCatalogs,
  op: string,
  action: ActionSpec | undefined,
): OperationAttributes {
  const grounding = groundOperation(model, op);
  const input = action?.input ?? [];
  const facts: Facts =
    grounding.kind === 'transition'
      ? transitionFacts(model, catalogs, input, grounding.entry.aggregate, grounding.entry.machine, grounding.entry.event.id)
      : grounding.kind === 'unknown'
        ? unknownFacts()
        : accessFacts(model, input, grounding);
  return { ...facts, ...resolvePolicy(facts, action) };
}
