/**
 * 操作(action_spec)の事実 9 属性 + 方針(confirm_required / variant)の**表現**(根拠・確認文言)。
 *
 * 正: docs/rules/process/backend/specification/standards/action-spec-writing.md
 *     「方針の導出（confirm_required / variant）と ux（上書き）」。
 * **事実と方針の導出そのものは意味解析の層(`semantics/operation-attributes.ts`)にある。**
 * ここはその結果に、人が読む根拠の行(`basis`)と確認ダイアログの注意書き(`confirmNotes`)を
 * 足すだけで、何が真かは決めない。code-action-attributes.ts(DocGenerator)とハンドブック
 * (book/actions-page.ts)の両方がこの 1 つの関数を呼び、検証(Y5)は意味解析の層を直接呼ぶ
 * ので、画面の確認と Y5 の確認は同じ結果を読む(二重実装しない。PRIN-0007)。
 */

import type { SpecModel } from '../../model/types.js';
import type { ActionSpec } from '../../model/trace/types.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import { globalRoleId } from '../../model/role-hierarchy.js';
import { deriveOperationAttributes, type OperationEvidence } from '../../semantics/operation-attributes.js';
import type { OperationCatalogs } from '../../semantics/operation-catalogs.js';
import { BASIS_NOTES, CONFIRM_NOTES } from '../../messages/messages.js';

/** 事実 9 属性 + 方針。1 つの根拠つきレコード。 */
export interface ActionAttributes {
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
  /** 導出結果(ux による上書き適用後)。 */
  readonly confirmRequired: boolean;
  readonly variant: 'default' | 'danger';
  /** 上書きを適用したか(理由は呼び出し側が action.ux.reason から引く)。 */
  readonly overridden: boolean;
  /**
   * 確認ダイアログの定型文(確認が要らない操作は空配列)。
   * `「{label}します。」` に続けて呼び側が結合する(action-spec-writing.md「方針の導出」)。
   */
  readonly confirmNotes: readonly string[];
  /** 根拠(どの宣言から。人間向けの短い日本語の配列)。 */
  readonly basis: readonly string[];
}

/**
 * 属性ごとの確認文言の定型文(宣言順。design: irreversible → affects_others → outbound →
 * settles → destructive)。
 *
 * **人を指す語はこのアプリの宣言から来る。** `affects_others` の文言は「誰の情報が変わるか」を
 * 言うので、role_spec の `kind: authenticated_default` の `label`(メンバー / 利用者 / 従業員 …)を
 * 借りる —— 体系側に「メンバー」と書くと、別のシステムのユーザーにその語がそのまま見えてしまう
 * (束 ⑱ の題材 B が実測: メンバーという概念が無いアプリの確認文に「他のメンバーの情報が変わります」が
 * 出た)。宣言が無い(既定ロールを持たない)アプリでは、人を指さない言い方に落とす。
 */
function confirmNotesOf(
  facts: {
    readonly irreversible: boolean;
    readonly affectsOthers: boolean;
    readonly outbound: boolean;
    readonly settlesLabels: readonly string[];
    readonly destructive: boolean;
  },
  actorLabel: string | undefined,
): readonly string[] {
  const notes: string[] = [];
  if (facts.irreversible) notes.push(CONFIRM_NOTES.irreversible());
  if (facts.affectsOthers) {
    notes.push(CONFIRM_NOTES.affectsOthers(actorLabel));
  }
  if (facts.outbound) notes.push(CONFIRM_NOTES.outbound());
  // settles の表示名は state_spec の vocabulary.settles(このアプリの宣言)から来る。
  // 「何が確定するか」は仕様ごとに違うので、ここに固定文言を書かない。
  for (const label of facts.settlesLabels) notes.push(`${label}がこの時点で確定します。`);
  if (facts.destructive) notes.push(CONFIRM_NOTES.destructive());
  return notes;
}

/** 認証ユーザーの既定ロール(`kind: authenticated_default`)の表示名。無ければ undefined。 */
function authenticatedLabel(model: SpecModel): string | undefined {
  const id = globalRoleId(model.roles.roles, 'authenticated_default');
  if (id === undefined) return undefined;
  return model.roles.roles.find((role) => role.id === id)?.label;
}

/** 文末が「。」で終わるように整える(reason は仕様に句点なしで書かれることが多い)。 */
function ensureSentence(text: string): string {
  const trimmed = text.trim();
  return trimmed.endsWith('。') ? trimmed : `${trimmed}。`;
}

/**
 * 生成器の共有文脈から、操作の属性の導出が読むカタログ 3 種だけを取り出す。
 *
 * 画面・文書の生成が意味解析の層(検証が読むのと同じ関数)へ渡す入力の作り方を 1 か所にする。
 */
export function operationCatalogsOf(ctx: GenerateContext): OperationCatalogs {
  return {
    ...(ctx.dataTables === undefined ? {} : { dataTables: ctx.dataTables }),
    ...(ctx.notifications === undefined ? {} : { notifications: ctx.notifications }),
    ...(ctx.jobs === undefined ? {} : { jobs: ctx.jobs }),
  };
}

/** 意味解析が返した根拠の材料を、人が読む行(宣言順)にする。 */
function basisOf(evidence: OperationEvidence, outbound: boolean): readonly string[] {
  switch (evidence.kind) {
    case 'unknown':
      return [BASIS_NOTES.ungrounded()];
    case 'access': {
      const basis = [
        `access_spec(${evidence.entity}.${evidence.op}): by=${evidence.by.join(',')}`,
        `access_spec: ${BASIS_NOTES.nonOwner(evidence.nonOwner)}`,
      ];
      if (evidence.deletesPersonalRow) basis.push(BASIS_NOTES.deletesPersonalRow(evidence.entity));
      return basis;
    }
    case 'transition': {
      const basis = [
        BASIS_NOTES.reversePath(evidence.machine, evidence.eventId, evidence.to, evidence.from, evidence.hasReturnPath),
      ];
      if (evidence.tone !== undefined) basis.push(BASIS_NOTES.tone(evidence.to, evidence.tone));
      if (evidence.settlesIds.length > 0) basis.push(BASIS_NOTES.settles(evidence.to, evidence.settlesIds));
      basis.push(`state_spec: by=${evidence.by.join(',')}(${BASIS_NOTES.nonOwner(evidence.nonOwner)})`);
      if (outbound) basis.push(BASIS_NOTES.outbound(evidence.jobIds));
      const { cascade } = evidence;
      if (cascade.compositeUsed) basis.push(BASIS_NOTES.compositeAlsoWrites(cascade.rpcs, cascade.alsoWrites));
      for (const write of cascade.destructiveWrites) basis.push(BASIS_NOTES.destructiveWrite(write.table, write.kind));
      if (evidence.clearedPersonal.length > 0) {
        basis.push(BASIS_NOTES.clearedPersonal(evidence.machine, evidence.eventId, evidence.clearedPersonal));
      }
      for (const reason of cascade.unverified) basis.push(BASIS_NOTES.unverifiedCascade(reason));
      for (const personal of cascade.personalTables) {
        basis.push(BASIS_NOTES.alsoWritesPersonal(personal.table, personal.columns));
      }
      return basis;
    }
  }
}

/**
 * 操作 1 本の属性を導出する(意味解析の結果に根拠の行と確認文言を足したもの)。
 *
 * @param model ドメイン仕様全体
 * @param ctx 生成器の共有文脈(dataTables / jobs / notifications をカタログとして意味解析へ渡す)
 * @param action 対象の action_spec
 * @returns 事実 9 属性 + 方針 + 根拠
 */
export function deriveActionAttributes(model: SpecModel, ctx: GenerateContext, action: ActionSpec): ActionAttributes {
  const attrs = deriveOperationAttributes(model, operationCatalogsOf(ctx), action.handles.raw, action);
  // ux で「確認あり」に上書きした操作は、事実からの定型文が 1 つも出ないことがある
  // (unpublish_public が実例: 可逆・非破壊なのに写しが消える)。宣言した reason が
  // そのまま人に見せる理由になるので、定型文の末尾に足す(reason は V14 で必須)。
  const overrideNote =
    attrs.overridden && attrs.confirmRequired && action.ux?.reason ? [ensureSentence(action.ux.reason)] : [];
  const confirmNotes = attrs.confirmRequired
    ? [...confirmNotesOf(attrs, authenticatedLabel(model)), ...overrideNote]
    : [];
  const { settlesLabels: _settlesLabels, evidence, ...publicAttrs } = attrs;
  return { ...publicAttrs, confirmNotes, basis: basisOf(evidence, attrs.outbound) };
}
