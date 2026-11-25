/**
 * 「タスク」の章(docs/book/usecases.html)の生成器。
 *
 * ADR-0011「起点は 2 つ」の帰結として、レビューは**タスク → 画面 → ドメイン(句として)**の
 * 順に読む(§5)。この章はその起点であり、ユースケースごとに「物語」(目的 → 誰が →
 * どこから → 保存点ごとに何を → 達成)と「数えた面倒」(cognitive-load.md §2 の 6 指標)を
 * 生成する。数え方の正は lib/usecase/derive.ts(Y5 と共有する 1 つの純粋関数。二重実装しない)。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import type { ScreenSpecModel } from '../../../model/screen/types.js';
import type { UsecaseBudgetMetric, UsecaseSaveDecl, UsecaseSpec, UsecaseSpecModel, UsecaseStepDecl } from '../../../model/usecase/types.js';
import { USECASE_BUDGET_METRICS } from '../../../model/usecase/types.js';
import type { UsecaseInput } from '../../../usecase/derive.js';
import type { UsecaseMetrics } from '../../../usecase/derive-effort.js';
import { acceptedFor, effectiveBudget } from '../../../usecase/derive.js';
import { usecaseBudgetDefaultsOf } from '../../../ux-principles/limits.js';
import { NO_UX_PRINCIPLES } from '../../../model/ux-principles/types.js';
import { metricValue } from '../../../usecase/derive-effort.js';
import { buildSavePlans } from '../../../usecase/plan-build.js';
import { cell } from '../../../gen-kit/state-machine-table.js';
import type { SaveResult } from '../../../results/save-cases.js';
import { operationCatalogsOf } from '../action-attributes-derive.js';
import { gatesOf } from '../gates-input.js';
import { gatesUnverifiedNote } from '../../../relations/screen-reachability/index.js';
import { bookFile } from './chapters.js';
import type { ProductRoots } from '../../../model/product/types.js';

/** 出力先。 */
export function usecasesPage(roots: ProductRoots): string {
  return bookFile(roots, 'usecases.md');
}

/** 予算の指標ごとの日本語見出し。 */
const METRIC_LABELS: Readonly<Record<UsecaseBudgetMetric, string>> = {
  steps: '① 手数(保存の回数)',
  screens: '② 画面',
  concepts: '③ 概念',
  preconditions: '⑤ 前提',
  inputs: '⑥ 入力',
  confirmations: '⑦ 確認',
};

/** 認証フローの関門が分からないと数えられない指標(通る画面は到達で、前提は start に入る関門で決まる)。 */
const GATE_DEPENDENT_METRICS: Readonly<Partial<Record<UsecaseBudgetMetric, string>>> = { screens: '到達', preconditions: '前提' };

/** 章の題。 */
export const USECASES_TITLE = 'タスク — この人はこれを 1 分でできるか';

/** 節の見出し(定型)。 */
export const BUDGET_HEADING = '数えた面倒';
export const RESULT_HEADING = '結果表 —— どこで止まるか';
export const UNRESOLVABLE_HEADING = '保存点では立たないロール';

/** ページの導入(定型)。 */
export const LEAD =
  '「この人はこれを 1 分でできるか」を数えるための章である(ADR-0011「起点は 2 つ」/ ' +
  'cognitive-load.md)。ドメインは正しさの起点、ここは**手軽さ**の起点であり、レビューは' +
  '**タスク → 画面 → ドメイン(句として)**の順に読む。数字は仕様(usecase_spec)からの' +
  '導出で、超過は `npm run verify` の Y5 が warning として指摘する。';

/** 空のスクリーン仕様モデル(ctx.screens が無い環境向けの安全側フォールバック)。 */
function emptyScreens(): ScreenSpecModel {
  return {
    available: false,
    screens: [],
    chromes: [],
    unexposed: [],
    unreachableStates: [],
    unseenStates: [],
  };
}

/** 数え方の入力(共有の入力で数える)。 */
export function usecaseInputOf(model: SpecModel, ctx: GenerateContext, usecases: UsecaseSpecModel): UsecaseInput {
  return {
    domain: model,
    usecases,
    actions: ctx.actions ?? null,
    screens: ctx.screens ?? emptyScreens(),
    gates: gatesOf(ctx),
    catalogs: operationCatalogsOf(ctx),
    budgetDefaults: usecaseBudgetDefaultsOf(ctx.uxPrinciples ?? NO_UX_PRINCIPLES),
  };
}

/** 章に並べるタスク(名前順)。 */
export function sortedUsecases(usecases: UsecaseSpecModel): UsecaseSpec[] {
  return [...usecases.usecases].sort((a, b) => a.name.localeCompare(b.name));
}

/** 非同期の操作の 1 行(共有の文。`html/usecases-chapter.ts` が読む)。 */
export function asyncLine(ops: readonly string[]): string {
  return `**⑨ 応答** — ${ops.map((op) => `\`${op}\``).join(', ')} は非同期(結果は数秒後に届く)。`;
}

/** その保存点の表の主役の集約(先頭の手順の集約。ガードのドット無しパスが指す相手)。 */
export function entityOf(save: SaveResult): string {
  return save.steps[0]?.op.split('.')[0] ?? '';
}

/** 「物語」(目的 → 誰が → どこから → 保存点ごとに何を → 達成)。 */
export function storyText(usecase: UsecaseSpec): string {
  const saves = usecase.saves.map((save) => saveText(save)).join(' → ');
  return (
    `**${usecase.actor}** が \`${usecase.start}\` から始め、${saves} を経て、` +
    `\`${usecase.done}\` になれば達成である。`
  );
}

/** 保存点 1 つ分の説明文(「{label}(op, op, ...)」)。 */
function saveText(save: UsecaseSaveDecl): string {
  const ops = save.steps.map((step) => stepText(step)).join('・');
  return `${save.label}(${ops})`;
}

/**
 * 手順 1 つ分の表記。
 *
 * **別名(`as`)を書いた手順は別名と見出しを添える** —— 同じ操作を 2 回実行する保存点では
 * 操作 ID だけでは 2 つの手順を読み分けられない(それが別名を足した理由である)。
 */
function stepText(step: UsecaseStepDecl): string {
  const alias = step.alias === null ? '' : ` as \`${step.alias}\`(${step.label ?? step.alias})`;
  return `\`${step.op}\`${alias}${step.repeat ? '×N' : ''}`;
}

/** 「保存点では立たないロール」の節の導入と表の見出し(定型)。 */
export const UNRESOLVABLE_LEAD =
  'この手順を認めているロールのうち、保存点の経路では権限が立たないもの(役割の根拠が' +
  '行の属性であり、セッションからも実行計画からも解決できない)。そのロールの人はこの' +
  '手順で拒否される —— 個別の操作の経路なら通る。';
export const UNRESOLVABLE_HEADERS: readonly string[] = ['保存点', '手順', '立たないロール'];

/** 手順ごとの「立たないロール」の行(該当のある手順だけ)。 */
export function unresolvableRows(usecase: UsecaseSpec, model: SpecModel, ctx: GenerateContext): string[][] {
  if (ctx.usecases === undefined || ctx.dataTables === undefined) return [];
  const built = buildSavePlans({
    domain: model,
    guards: ctx.guards,
    actions: ctx.actions ?? null,
    dataTables: ctx.dataTables,
    usecases: ctx.usecases,
  });
  const rows: string[][] = [];
  for (const save of built.saves) {
    if (save.usecase.name !== usecase.name) continue;
    save.facts.steps.forEach((facts, index) => {
      if (facts.unresolvableRoles.length === 0) return;
      const step = save.plan.steps[index];
      const op = step === undefined ? '' : `${step.op}${step.alias === step.op ? '' : `(as ${step.alias})`}`;
      rows.push([
        cell(save.plan.save.label),
        cell(`\`${op}\``),
        cell(facts.unresolvableRoles.map((role) => `\`${role}\``).join('・')),
      ]);
    });
  }
  return rows;
}

/** 「数えた面倒」の表の見出し。 */
export const BUDGET_HEADERS: readonly string[] = ['指標', '実測', '予算', '判定'];

/** 「数えた面倒」の表の行(共有の行。`html/usecases-chapter.ts` が読む)。 */
export function budgetRows(
  usecase: UsecaseSpec,
  metrics: UsecaseMetrics,
  defaults: UsecaseInput['budgetDefaults'],
  gatesUnknown: boolean,
): string[][] {
  const budget = effectiveBudget(usecase, defaults);
  return USECASE_BUDGET_METRICS.map((metric) => {
    const limit = budget[metric];
    // 関門が分からない(採ったのに読めない)とき、空の関門で探索した画面・前提の数を実測として書かない(0 と断定しない)。
    const unverified = GATE_DEPENDENT_METRICS[metric];
    if (gatesUnknown && unverified !== undefined) {
      return [cell(METRIC_LABELS[metric]), cell('—'), cell(String(limit)), cell(`未検証(${gatesUnverifiedNote(unverified)})`)];
    }
    const value = metricValue(metrics, metric);
    const accepted = acceptedFor(usecase, metric);
    const verdict =
      value <= limit
        ? '—'
        : accepted !== undefined
          ? `理由つきで受け入れ済み(${accepted.reason})`
          : '⚠ 予算超過(`npm run verify` の Y5 警告)';
    return [cell(METRIC_LABELS[metric]), cell(String(value)), cell(String(limit)), cell(verdict)];
  });
}
