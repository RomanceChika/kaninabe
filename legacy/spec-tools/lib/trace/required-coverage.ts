/**
 * アクション 1 本に対する「宣言されているべき意味クラス」の導出。
 *
 * A7(意味的カバレッジ)の判定基準そのものであり、action-spec-writing.md §A7 の
 * 導出規則の表をそのまま実装したものである。表と実装がずれたら表が正であり、
 * ここを直す(規約: PRIN-0001 仕様が正)。
 *
 * 導出の源はすべてドメイン仕様側にある。
 *   - 遷移(`{machine}.{event}`)     : state_spec の from / by / guard と invariant_spec の enforced_by
 *   - 作成(`{entity}.create`)       : access_spec の creates と invariant_spec の db_constraint / trigger
 *   - 削除(`{entity}.delete`)       : access_spec の deletes
 *   - 編集(`{entity}.update`)       : access_spec の writes と、その fields に**触れる**不変条件
 * action_spec 側に書かれた内容は導出に使わない(薄さの基準を崩さないため)。
 *
 * このファイルの責務は**導出の規則表**(どの操作にどのクラスが要るか)である。その材料を仕様モデル
 * から拾う照会(`required-coverage-lookup.ts`)は、規則表を要らない使い手(L2 の網羅表の生成)も
 * 直接読むので別の部品になっている。
 */

import type { SpecModel } from '../model/types.js';
import type { ActionSpec } from '../model/trace/types.js';
import type { CoverageClass } from '../testcase/types.js';
import type { AccessOpEntry, EventEntry } from '../semantics/domain-index.js';
import {
  entityNameOfAggregate,
  findCreate,
  findDelete,
  findEvent,
  findUpdate,
  isCreateId,
  isDeleteId,
  isUpdateId,
} from '../semantics/domain-index.js';
import {
  deniedHumanRoles,
  invariantsEnforcedOn,
  invariantsGuardedBy,
  invariantsInvolving,
  invariantsTouching,
} from './required-coverage-lookup.js';
import type { RequiredRole } from './required-roles.js';
import { eventRoles, ruleRoles } from './required-roles.js';
import { systemRoleId } from '../model/role-hierarchy.js';

export type { RequiredRole } from './required-roles.js';

/** 必要クラス 1 件と、それが必要になった根拠。 */
export interface RequiredClass {
  readonly cls: CoverageClass;
  /** なぜ必要か(メッセージにそのまま埋め込む日本語の句)。 */
  readonly because: string;
}

/** 編集規則のうち、この導出が読む部分(`by` と `when` と `fields`)。 */
interface WriteRuleLike {
  readonly by: string;
  readonly when?: string;
  readonly fields: readonly string[];
}

/** アクション 1 本に対する導出結果。 */
export interface RequiredCoverage {
  /**
   * ドメイン仕様に接地できたか。
   * false のとき required は空で、A7 は何も言わない(接地の欠落は A1 の担当)。
   */
  readonly grounded: boolean;
  readonly required: readonly RequiredClass[];
  /**
   * この操作を許されているロール(宣言に並ぶ `by` の全部)。
   *
   * 意味クラスと違い、こちらは「実装がそのロールを**解決している**か」を問うための義務である。
   * ロールごとに成功のケースを要求することで、宣言に足しただけで実装が追随していないロールが
   * 検出できる(A7 §by_role)。
   */
  readonly roles: readonly RequiredRole[];
}

/** 接地できなかったときの結果。 */
const UNGROUNDED: RequiredCoverage = { grounded: false, required: [], roles: [] };

/**
 * action_spec 1 本の必要クラス集合を導出する。
 *
 * @param action 対象の action_spec
 * @param domain ドメイン仕様
 * @returns 必要クラスと根拠。handles が接地していない場合は grounded=false
 */
export function deriveRequiredCoverage(action: ActionSpec, domain: SpecModel): RequiredCoverage {
  const id = action.handles.raw;
  const systemRole = systemRoleId(domain.roles.roles);

  if (isCreateId(id)) {
    const entry = findCreate(domain, id);
    if (entry === null) return UNGROUNDED;
    return grounded(createClasses(entry, domain), ruleRoles(entry.rules, `${id} の creates`, systemRole));
  }
  if (isDeleteId(id)) {
    const entry = findDelete(domain, id);
    if (entry === null) return UNGROUNDED;
    return grounded(deleteClasses(entry, domain), ruleRoles(entry.rules, `${id} の deletes`, systemRole));
  }
  if (isUpdateId(id)) {
    const entry = findUpdate(domain, id);
    if (entry === null) return UNGROUNDED;
    return grounded(updateClasses(entry, domain), ruleRoles(entry.rules, `${id} の writes`, systemRole));
  }
  const event = findEvent(domain, id);
  if (event === null) return UNGROUNDED;
  return grounded(
    transitionClasses(event, domain),
    eventRoles(event.event.by, `${id} の by`, systemRole),
  );
}

/** 導出できたクラス列とロール列を結果にまとめる。 */
function grounded(
  required: readonly RequiredClass[],
  roles: readonly RequiredRole[],
): RequiredCoverage {
  return { grounded: true, required, roles };
}

// ---------------------------------------------------------------------------
// 遷移(state_spec のイベント)
// ---------------------------------------------------------------------------

/**
 * 遷移系の必要クラス。
 *
 * `conflict` を無条件に要求するのは、状態遷移の書き込みが例外なく
 * 「判断したときの状態」を条件にした楽観的並行制御で行われるためである
 * (ARCH-BE-0013)。この前提が変わったらここも変わる。
 */
function transitionClasses(entry: EventEntry, domain: SpecModel): RequiredClass[] {
  const required: RequiredClass[] = [
    { cls: 'success', because: '成功する経路を必ず持つ' },
    { cls: 'conflict', because: '楽観的並行制御で書き込まれる状態遷移である' },
  ];
  const guard = entry.event.guard;
  if (guard !== undefined) {
    required.push({ cls: 'guard_unsatisfied', because: `guard(${guard})を持つ` });
  }
  const outside = entry.machine.states.filter((state) => !entry.event.from.includes(state));
  if (outside.length > 0) {
    required.push({ cls: 'invalid_from', because: `from に含まれない状態(${outside.join(', ')})がある` });
  }
  const denied = deniedHumanRoles(domain, entry.event.by);
  if (denied.length > 0) {
    required.push({ cls: 'forbidden', because: `by に含まれない人間ロール(${denied.join(', ')})がある` });
  }
  const guarding = invariantsGuardedBy(domain, entry.id);
  if (guarding.length > 0) {
    required.push({
      cls: 'invariant',
      because: `このイベントを執行点(enforced_by: guard)にする不変条件(${guarding.join(', ')})がある`,
    });
  }
  const entity = entityNameOfAggregate(domain, entry.aggregate);
  addInvolvedInvariant(required, invariantsInvolving(domain, entity), entity);
  return required;
}

/**
 * `involves` にそのエンティティを挙げている不変条件があれば `invariant` を要求する。
 *
 * 既に(guard 執行点や DB 制約など)別の理由で `invariant` が必要クラスに入っている場合は
 * 重ねて足さない — A7 は「宣言済み covers に invariant が 1 つでもあるか」しか見ないため、
 * 同じ cls を複数積んでも判定は変わらず、未達成時のメッセージが重複するだけである。
 */
function addInvolvedInvariant(
  required: RequiredClass[],
  involving: readonly string[],
  entity: string,
): void {
  if (involving.length === 0) return;
  if (required.some((r) => r.cls === 'invariant')) return;
  required.push({
    cls: 'invariant',
    because: `別集約の不変条件が involves で ${entity} を参照している(${involving.join(', ')})`,
  });
}

// ---------------------------------------------------------------------------
// 予約 ID(access_spec の creates / deletes / writes)
// ---------------------------------------------------------------------------

/**
 * 作成の必要クラス。
 *
 * **`conflict` は条件つきで要る。** 作成に「判断時の対象」は無いが、`creates[].when` を持つ
 * 集約は**可否が親の状態に依存する**ので、判断してから書き込むまでに親が動けば 0 行になる
 * (削除・編集と同じ競合)。条件が 1 本も無い作成には古びうる判断が無いので要求しない。
 * さらに、その entity に効く DB 制約・トリガーがあれば `invariant` を要求する
 * (作成は不変条件が最初に効く点であり、DB の執行を確かめる場所がここしかない)。
 */
function createClasses(
  entry: AccessOpEntry<{ readonly by: string; readonly when?: string }>,
  domain: SpecModel,
): RequiredClass[] {
  const guarded = entry.rules.some((rule) => rule.when !== undefined);
  const required = accessOpClasses(domain, entry, guarded ? ['conflict'] : []);
  const enforced = invariantsEnforcedOn(domain, entry);
  if (enforced.length > 0) {
    required.push({
      cls: 'invariant',
      because: `DB 制約・トリガーで執行される不変条件(${enforced.join(', ')})が ${entry.entity} にある`,
    });
  }
  addInvolvedInvariant(required, invariantsInvolving(domain, entry.entity), entry.entity);
  return required;
}

/**
 * 削除の必要クラス。
 *
 * `deletes` それ自体には(作成の DB 制約・トリガーのような)自集約の不変条件を要求する理由が
 * 無いが、`involves` で別集約からこの集約を参照する不変条件があれば話が変わる —
 * 「別集約を数える不変条件は、子集約の delete が最後の 1 件を消すと破れる」からである
 * (今日の穴: INV-ENTRY-008 が involves で piece / entry_participant を挙げる)。
 */
function deleteClasses(
  entry: AccessOpEntry<{ readonly by: string; readonly when?: string }>,
  domain: SpecModel,
): RequiredClass[] {
  const required = accessOpClasses(domain, entry, ['conflict', 'not_found']);
  addInvolvedInvariant(required, invariantsInvolving(domain, entry.entity), entry.entity);
  return required;
}

/**
 * 編集の必要クラス。
 *
 * 作成と違い「この操作で不変条件が破れるか」は自明ではない。編集が動かすのは
 * `writes[].fields` だけなので、**その集合に触れる不変条件があるときだけ** `invariant` を
 * 要求する(action-spec-writing.md §A7)。探索範囲は**モデル全体**である —
 * 不変条件は集約をまたいで効くことがあり(例: 催しの定員を下げると、その催しの申込みの
 * 件数制約に触れる)、その執行点が相手側のテーブルにあっても、破るのはこの操作だからである。
 */
function updateClasses(entry: AccessOpEntry<WriteRuleLike>, domain: SpecModel): RequiredClass[] {
  const required = accessOpClasses(domain, entry, ['conflict']);
  const fields = [...new Set(entry.rules.flatMap((rule) => rule.fields))];
  const touching = invariantsTouching(domain, entry.entity, fields);
  if (touching.length > 0) {
    required.push({
      cls: 'invariant',
      because: `編集できるフィールド(${fields.join(', ')})に触れる不変条件(${touching.join(', ')})がある`,
    });
  }
  return required;
}

/**
 * creates / deletes / writes に共通の必要クラス。
 *
 * `forbidden` は access_spec が deny by default であることから来るが、**無条件ではない**。
 * `rules[].by` に並ぶロールを implies で閉包した結果が全人間ロールを覆っていれば、
 * 拒否される人間ロールが 1 人も存在しない(遷移の `deniedHumanRoles` と同じ規則。
 * action-spec-writing.md §A7)。`extra` で操作ごとの追加分を渡す。
 */
function accessOpClasses(
  domain: SpecModel,
  entry: AccessOpEntry<{ readonly by: string; readonly when?: string }>,
  extra: readonly CoverageClass[],
): RequiredClass[] {
  const required: RequiredClass[] = [{ cls: 'success', because: '成功する経路を必ず持つ' }];
  const allowed = [...new Set(entry.rules.map((rule) => rule.by))];
  const denied = deniedHumanRoles(domain, allowed);
  if (denied.length > 0) {
    required.push({
      cls: 'forbidden',
      because: `宣言されたロール(${allowed.join(', ')})に含まれない人間ロール(${denied.join(', ')})がある`,
    });
  }
  for (const cls of extra) {
    required.push({ cls, because: ACCESS_OP_REASONS[cls] ?? `${entry.id} の契約に含まれる` });
  }
  const when = entry.rules.map((rule) => rule.when).find((value) => value !== undefined);
  if (when !== undefined) {
    required.push({ cls: 'guard_unsatisfied', because: `access_spec に when(${when})がある` });
  }
  return required;
}

/** 操作ごとに無条件で足されるクラスの根拠。 */
const ACCESS_OP_REASONS: Partial<Record<CoverageClass, string>> = {
  conflict: '判断したときの前提(対象または親の状態)を条件に書き込む(楽観的並行制御)',
  not_found: '対象が実在することを前提とする操作である',
};
