/**
 * L2 網羅スイープ — ④ 通知 / ⑤ ジョブ の行を各カタログから機械的に導出する。
 *
 * 母集合はカタログの宣言の全数(1 件 1 行)。通知・ジョブに「成立/不成立」の区別は無い
 * (発火した通知・ジョブ自体が結果であり、宣言に無い発火は存在しない — N1 / J1 が担保する)。
 *
 * **帰属規則(束⑪a)**。「どこで確かめているか」は導出(state_spec の `effects` から辿った
 * 遷移の成功ケース)と直接(その通知・ジョブ自身の ID を `spec_ids` に挙げる test_cases)の
 * 2 種類を合わせたものである。
 *
 * - 通知 X の証拠 = (a) X を `effects` に持つ遷移の action_spec の test_cases のうち
 *   `covers` に `success` を含むもの(導出) + (b) notification-catalog の test_cases 全件
 *   (カタログ全体の整合を確かめるテストも、通知の存在そのものの裏付けにはなる)。
 * - ジョブ Y の証拠は 3 段(job-spec-writing.md の帰属規則):
 *   (a) `source: outbox` で、Y のID が通知カタログにも載っている(= 通知として送るジョブ)
 *       なら、その通知と同じ証拠(上の通知の規則をそのまま使う)。
 *   (b) `source: outbox` の非通知ジョブは、Y を effects に持つ遷移の成功ケース(導出) +
 *       job-catalog の test_cases 全件(カタログ全体の整合)。
 *   (c) `source: schedule` / `manual` は effects からの導出が効かない(時刻・人のボタンが
 *       起点で、どの state_spec からも辿れない)。**直接**(Y 自身の ID を `spec_ids` に
 *       挙げる test_cases)だけを証拠にする —— この直接のテストケースが 1 つも無い場合は A13 が
 *       検査でエラーにする(このスイープ自体は判定しない。証拠 0 件のまま表に出るだけ)。
 */

import type { SpecModel } from '../../model/types.js';
import type { NotificationSpecModel } from '../../model/notification/types.js';
import type { JobSpecModel } from '../../model/job/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import type { ActionTestCase } from '../../testcase/types.js';
import { toEvidence, type L2Evidence, type L2Row } from './l2-sweep-types.js';

/**
 * 指定した副作用ID(`effects[].do` の要素、または `writes[].effects` の要素)を持つ
 * 操作(`{machine}.{event}`、または `{entity}.update`)の ID を集める。
 *
 * `writes[].effects`(access_spec。update-fields の発火元)は対応するドメインイベントを
 * 持たないため、update-fields テンプレートの予約イベントID `{entity}.update` で表す
 * (J1 の `collectJobEffects` と同じ扱い)。
 *
 * @param model ドメイン仕様全体(state_spec の `effects` + access_spec の `writes[].effects` が母集合)
 * @param effectId 通知・ジョブの ID(= `effects[].do` / `writes[].effects` の語彙)
 */
function transitionsWithEffect(model: SpecModel, effectId: string): readonly string[] {
  const ids: string[] = [];
  for (const specs of model.aggregates.values()) {
    for (const machine of specs.stateMachines) {
      for (const effect of machine.effects) {
        if (effect.do.includes(effectId)) ids.push(`${machine.machine}.${effect.on}`);
      }
    }
    const access = specs.access;
    if (access === undefined) continue;
    for (const rule of access.writes) {
      if ((rule.effects ?? []).includes(effectId)) ids.push(`${access.entity}.update`);
    }
  }
  return ids;
}

/**
 * 遷移由来の証拠(帰属規則(a)(b)の導出側): その副作用を積む遷移の action_spec のうち、
 * `covers` に `success` を含む test_cases。
 *
 * @param model ドメイン仕様全体
 * @param actions 読み込み済みの action_spec(未読み込みなら導出できないので空)
 * @param effectId 通知・ジョブの ID
 */
function derivedEvidence(
  model: SpecModel,
  actions: ActionSpecModel | undefined,
  effectId: string,
): readonly L2Evidence[] {
  if (actions === undefined) return [];
  const eventIds = new Set(transitionsWithEffect(model, effectId));
  const evidence: L2Evidence[] = [];
  for (const action of actions.actions) {
    if (!eventIds.has(action.handles.raw)) continue;
    for (const testCase of action.testCases) {
      if ((testCase.covers ?? []).includes('success')) evidence.push(toEvidence(testCase, 'derived'));
    }
  }
  return evidence;
}

/**
 * 通知の行を全件組み立てる。
 *
 * @param model ドメイン仕様全体(遷移由来の証拠を導出する母集合)
 * @param notifications 読み込み済みの notification_spec(`available: false` / 省略・カタログ null なら空)
 * @param actions 読み込み済みの action_spec(遷移由来の証拠の出どころ)
 */
export function buildNotificationRows(
  model: SpecModel,
  notifications: NotificationSpecModel | undefined,
  actions: ActionSpecModel | undefined,
): L2Row[] {
  const catalog = notifications?.available === true ? notifications.catalog : null;
  if (catalog === null || catalog === undefined) return [];
  const catalogEvidence = catalog.testCases.map((tc) => toEvidence(tc, 'direct'));
  return catalog.notifications.map((decl) => ({
    section: '通知',
    subject: decl.id,
    aspect: `trigger: ${decl.trigger}`,
    detail: `${decl.medium} / ${decl.audience} / ${decl.summary}`,
    evidence: [...derivedEvidence(model, actions, decl.id), ...catalogEvidence],
  }));
}

/**
 * ジョブの行を全件組み立てる。
 *
 * @param model ドメイン仕様全体(遷移由来の証拠を導出する母集合)
 * @param jobs 読み込み済みの job_spec(`available: false` / 省略・カタログ null なら空)
 * @param notifications 読み込み済みの notification_spec(ジョブが通知かどうかの判定に使う)
 * @param actions 読み込み済みの action_spec(遷移由来の証拠の出どころ)
 */
export function buildJobRows(
  model: SpecModel,
  jobs: JobSpecModel | undefined,
  notifications: NotificationSpecModel | undefined,
  actions: ActionSpecModel | undefined,
): L2Row[] {
  const catalog = jobs?.available === true ? jobs.catalog : null;
  if (catalog === null || catalog === undefined) return [];

  const notificationCatalog = notifications?.available === true ? notifications.catalog : null;
  const notificationIds = new Set(notificationCatalog?.notifications.map((decl) => decl.id) ?? []);
  const notificationCatalogEvidence = (notificationCatalog?.testCases ?? []).map((tc) => toEvidence(tc, 'direct'));
  const jobCatalogEvidence = catalog.testCases.map((tc) => toEvidence(tc, 'direct'));

  return catalog.jobs.map((decl) => ({
    section: 'ジョブ',
    subject: decl.id,
    aspect: `source: ${decl.source}`,
    detail: `${decl.kind} / ${decl.summary}`,
    evidence: jobEvidence(decl, {
      model,
      actions,
      isNotification: notificationIds.has(decl.id),
      notificationCatalogEvidence,
      jobCatalogEvidence,
      jobCatalogTestCases: catalog.testCases,
    }),
  }));
}

/** buildJobRows が帰属規則の分岐に使う材料。 */
interface JobEvidenceContext {
  readonly model: SpecModel;
  readonly actions: ActionSpecModel | undefined;
  readonly isNotification: boolean;
  readonly notificationCatalogEvidence: readonly L2Evidence[];
  readonly jobCatalogEvidence: readonly L2Evidence[];
  readonly jobCatalogTestCases: readonly ActionTestCase[];
}

/**
 * ジョブ 1 件の証拠を帰属規則の 3 段で決める。
 *
 * `source` を最初に見る —— `schedule` / `manual` は Y が通知であっても直接のテストケースだけを見る
 * (対外告知の 2 本がまさにこの形。時刻・人のボタンが起点である以上、通知としての体裁を
 * 持っていても effects からの導出も notification-catalog の全件クレジットも根拠にならない)。
 */
function jobEvidence(
  decl: { readonly id: string; readonly source: string },
  ctx: JobEvidenceContext,
): readonly L2Evidence[] {
  if (decl.source !== 'outbox') {
    return ctx.jobCatalogTestCases
      .filter((tc) => tc.specIds.includes(decl.id))
      .map((tc) => toEvidence(tc, 'direct'));
  }
  if (ctx.isNotification) {
    return [...derivedEvidence(ctx.model, ctx.actions, decl.id), ...ctx.notificationCatalogEvidence];
  }
  return [...derivedEvidence(ctx.model, ctx.actions, decl.id), ...ctx.jobCatalogEvidence];
}
