/**
 * ハンドブックに載る**結果表の節**(束 ⑳-5b)。
 *
 * 人間のレビューに残っているのは「見せていいか・できていいか・その判断でいいか」だけである
 * (human-review-guide.md)。宣言の写しだけを並べた表では 3 つ目に答えられない ——
 * 「世話役なら通る」と書いてあっても、**締切を過ぎたら落ちる**ことは宣言の形からは読めない。
 * この節が出すのは境界を含む結末そのもので、判定は一致の証明と同じ engine から採る。
 *
 * 折り畳み(`<details>`)に入れるのは量のためである(1 操作で数十行になる)。畳む前の全列挙は
 * `docs/book/assets/results/` に置いてあり、節の末尾がその置き場を案内する。
 *
 * 規約どおりファイル I/O はせず、モデルから文字列を返す純粋関数である。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { RESULT_ABSENT, RESULT_WORDS } from '../../../messages/messages-results.js';
import type { ResultAggregate, ResultOperation } from '../../../results/cases.js';
import { resultAggregates } from '../../../results/cases.js';
import type { SaveResult } from '../../../results/save-cases.js';
import { saveResults } from '../../../results/save-cases.js';
import type { ResultLabels } from '../../../results/table-cell.js';
import type { ResultTableView } from '../../../results/table.js';
import { operationTableView, saveTableView } from '../../../results/table.js';
import { buildGuardJaDict, guardToJapanese } from '../guard-ja.js';
import { cell, withLabel } from '../../../gen-kit/state-machine-table.js';
import { type FoldedTable } from './lower-table.js';
import { bookPath } from '../../../model/product/paths.js';
import type { ProductRoots } from '../../../model/product/types.js';

/**
 * 元データの置き場(リポジトリルート相対)。
 *
 * 読み物の根は製品が宣言するので、その中のどこに置くか(`assets/results`)だけを仕組みが決める。
 */
export function resultsDir(roots: ProductRoots): string {
  return bookPath(roots, 'assets/results');
}

/**
 * 表の語(仕様の label とガード式の日本語訳)。
 *
 * @param model ドメイン仕様
 * @param ctx 生成コンテキスト(ガードのパーサー)
 * @param entity その表の主役の集約(ドット無しのガードのパスが指す相手)
 * @returns 表の語
 */
export function resultLabelsOf(model: SpecModel, ctx: GenerateContext, entity: string): ResultLabels {
  const dict = buildGuardJaDict(model);
  const roles = new Map(model.roles.roles.map((role) => [role.id, role.label]));
  const states = new Map<string, string>();
  const fields = new Map<string, string>();
  for (const specs of model.aggregates.values()) {
    for (const machine of specs.stateMachines) {
      for (const [state, label] of Object.entries(machine.stateLabels)) states.set(state, label);
    }
    if (specs.entity?.entity !== entity) continue;
    for (const field of specs.entity.fields) {
      if (field.label !== undefined) fields.set(field.name, field.label);
    }
  }
  return {
    role: (id: string): string => withLabel(id, roles.get(id)),
    state: (id: string): string => withLabel(id, states.get(id)),
    field: (name: string): string => withLabel(name, fields.get(name)),
    guard: (source: string): string => guardToJapanese(source, ctx, dict, entity),
  };
}

/**
 * 操作 1 つの結果表の材料(共有の行・文。`html/usecases-chapter.ts` が読む)。
 *
 * @param aggregate その集約の全列挙(実行者の並びの出どころ)
 * @param operation 操作 1 つぶんの全列挙
 * @param labels 表の語
 * @param roots 製品が宣言した根(元データの置き場の案内に使う)
 */
export function operationResultTable(
  aggregate: ResultAggregate,
  operation: ResultOperation,
  labels: ResultLabels,
  roots: ProductRoots,
): FoldedTable {
  const view = operationTableView(operation, aggregate.actors, labels);
  return {
    fold: { kind: 'table', title: RESULT_WORDS.operationSummary(operation.op, operation.count), count: view.rows.length, hint: '誰が・どの状態のものを動かせるか', element: 'result.table' },
    before: [
      RESULT_WORDS.operationLead(COLUMN_KIND_WORDS[view.columnKind]),
      ...(operation.enforcement === 'none' ? [RESULT_WORDS.unenforced] : []),
      ...foldNotes(operation.folded, operation.foldedGuards),
    ],
    headers: view.headers,
    rows: view.rows.map((row) => row.map((text) => cell(text))),
    after: [...view.legend, ...(hasAbsent(view) ? [RESULT_WORDS.absentNote] : []), RESULT_WORDS.dataNote(`${resultsDir(roots)}/${aggregate.aggregate}.json`)],
  };
}

/**
 * 保存点 1 つの結果表の材料(共有の行・文。`html/usecases-chapter.ts` が読む)。
 *
 * @param save 保存点 1 つぶんの全列挙
 * @param labels 表の語
 * @param roots 製品が宣言した根(元データの置き場の案内に使う)
 * @returns 折りたたみの材料(world を作れない保存点は null。理由は `save.problems`)
 */
export function saveResultTable(save: SaveResult, labels: ResultLabels, roots: ProductRoots): FoldedTable | null {
  if (save.problems.length > 0) return null;
  const view = saveTableView(save, labels);
  const unenforced = save.cases
    .flatMap((found) => found.steps)
    .filter((step) => step.enforcement === 'none')
    .map((step) => `\`${step.op}\``);
  return {
    fold: { kind: 'table', title: `${save.label} の結果表`, count: `全 ${save.count} 通り`, hint: '誰が・どの手順で落ちるか' },
    before: [
      RESULT_WORDS.saveLead,
      ...(unenforced.length === 0 ? [] : [RESULT_WORDS.unenforcedSteps([...new Set(unenforced)].join(' '))]),
      ...foldNotes(save.folded, save.foldedGuards),
    ],
    headers: view.headers,
    rows: view.rows.map((row) => row.map((text) => cell(text))),
    after: [...view.legend, ...(hasAbsent(view) ? [RESULT_WORDS.absentNote] : []), RESULT_WORDS.dataNote(`${resultsDir(roots)}/${save.usecase}.json`)],
  };
}

/**
 * 一致の証明が無い集約の 1 行(理由つき)。
 *
 * 黙って表を出さないのは T11 と同じ構えである —— 表が無いことは「その操作の結末を実測して
 * いない」と同じなので、理由が読める場所に残す。
 *
 * @param aggregate その集約の結果
 * @returns 理由の 1 行(world を作れているときは null)
 */
export function noProofNote(aggregate: ResultAggregate): string | null {
  if (aggregate.problems.length === 0) return null;
  return RESULT_WORDS.noProof(aggregate.problems.join(' / '));
}

/**
 * 全操作の結果表に出る **❌ の理由の種類**の総数(レビューの手引きが判断ポイントに足す)。
 *
 * 数えるのは「宣言の本数」ではなく**落ち方の種類**である —— 人が結果表で判断するのは
 * 「この落ち方でよいか」であり、同じ宣言から出た同じ理由を何マスに並べても判断は 1 つである。
 *
 * @param model ドメイン仕様
 * @param ctx 生成コンテキスト
 * @returns ❌ の理由の種類の総数
 */
export function resultReasonKindTotal(model: SpecModel, ctx: GenerateContext): number {
  const texts = new Set<string>();
  for (const aggregate of resultAggregates({
    domain: model,
    guards: ctx.guards,
    actions: ctx.actions,
    dataTables: ctx.dataTables,
    jobs: ctx.jobs,
  })) {
    const labels = resultLabelsOf(model, ctx, aggregate.aggregate);
    for (const operation of aggregate.operations) {
      for (const text of operationTableView(operation, aggregate.actors, labels).reasonTexts) {
        texts.add(text);
      }
    }
  }
  return texts.size;
}

/**
 * 全保存点の結果表に出る **❌ の理由の種類**の総数(タスクの章の判断ポイント)。
 *
 * 数え方は操作の章と同じで、**章ぜんたいで 1 冊の帳面**を使う —— 表をまたいで同じ文面を
 * 数え直すと、人の作業量の見積りが実際より大きくなる(独立レビュー ⑳-5b 観点 5b の実測では
 * 87 と 50 の差)。
 *
 * @param model ドメイン仕様
 * @param ctx 生成コンテキスト
 * @returns ❌ の理由の種類の総数
 */
export function saveReasonKindTotal(model: SpecModel, ctx: GenerateContext): number {
  const texts = new Set<string>();
  for (const save of saveResults({
    domain: model,
    guards: ctx.guards,
    actions: ctx.actions,
    dataTables: ctx.dataTables,
    usecases: ctx.usecases,
  })) {
    if (save.problems.length > 0) continue;
    const labels = resultLabelsOf(model, ctx, save.steps[0]?.op.split('.')[0] ?? '');
    for (const text of saveTableView(save, labels).reasonTexts) texts.add(text);
  }
  return texts.size;
}

/** 列が何かの言い換え(前書きの 1 文)。 */
const COLUMN_KIND_WORDS: Readonly<Record<ResultTableView['columnKind'], string>> = {
  state: RESULT_WORDS.columnsAreStates,
  field: RESULT_WORDS.columnsAreFields,
  subject: RESULT_WORDS.columnsAreSubject,
  step: RESULT_WORDS.columnsAreStates,
};

/** 実行していないマス(`—`)がその表にあるか(あるときだけ説明を出す)。 */
function hasAbsent(view: ResultTableView): boolean {
  return view.rows.some((row) => row.includes(RESULT_ABSENT));
}

/** 代表値に畳んだ軸の但し書き(畳んでいなければ何も出さない)。 */
function foldNotes(
  folded: readonly string[],
  guards: readonly { readonly key: string; readonly satisfying: readonly string[]; readonly refuting: readonly string[] }[],
): readonly string[] {
  if (folded.length === 0) return [];
  const details = guards.map((guard) =>
    RESULT_WORDS.foldedGuard(guard.key, guard.satisfying.join('|'), guard.refuting.join('|')),
  );
  return [`${RESULT_WORDS.foldedNote(folded.join(' '))}${details.length === 0 ? '' : `: ${details.join(' / ')}`}`];
}
