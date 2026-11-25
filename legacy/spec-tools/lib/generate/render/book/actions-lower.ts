/**
 * 操作の章の下段(導出): 集約ごとの操作の表・操作ごとの結果表・例外の一覧(生成に乗らない操作・手書きの RPC・入口の無い操作)。
 *
 * すべて折りたたむ。件数は表の行の数(構造テストが一致を見る)。操作の宣言は集約の章が数えるので、この章の表は
 * 集約の章の宣言を**横断で読む**ための導出である。例外の一覧は、集約の章と表の章が受け入れとして数えている理由の**再掲**で、
 * 必読には数えない(同じ理由を二度必読に数えない)。
 */

import type { DataTableSpecModel } from '../../../model/data/types.js';
import type { SpecModel } from '../../../model/types.js';
import type { ResultAggregate } from '../../../results/cases.js';
import type { ActionSpecModel } from '../../../model/trace/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import type { ActionRow } from '../actions-view.js';
import { actionRowsByAggregate } from '../actions-view.js';
import { cell, EMPTY_CELL } from '../../../gen-kit/state-machine-table.js';
import { aggregateTitle } from './chapters.js';
import { esc } from './face-html.js';
import { markdownFoldedTable, type FoldedTable } from './lower-table.js';
import { noProofNote, operationResultTable, resultLabelsOf } from './results-section.js';

/** 下段の材料(折りたたみの断片と、表の行の数の内訳)。 */
export interface ActionsLower {
  readonly blocks: string[];
  /** 集約ごとの材料(HTML 版が同じ行・同じ文を使う)。 */
  readonly groups: readonly ActionsLowerGroup[];
  /** 例外の一覧(行が無い表は含まない)。 */
  readonly exceptions: readonly FoldedTable[];
  readonly count: number;
  readonly rows: {
    readonly operations: number;
    readonly results: number;
    readonly manual: number;
    readonly handwritten: number;
    readonly unhandled: number;
  };
}

/** 集約 1 つぶんの下段の材料(見出しの段落・操作の表・結果表)。 */
export interface ActionsLowerGroup {
  /** 見出しの題(集約の章の題の言い方)。 */
  readonly title: string;
  readonly operations: FoldedTable;
  /** world を宣言から作れないときの理由の 1 行。 */
  readonly missing: string | null;
  readonly results: readonly FoldedTable[];
}

/** 操作の表の見出し。 */
const HEADERS = ['操作', '何をするか', '誰が実行できるか', '入力', '起きること', '属性', '方針', 'テスト'] as const;

/** 「生成に乗らない操作」節の読み方(定型)。 */
const MANUAL_NOTE =
  '操作の実装(Server Action と Composition Root)は**仕様からの生成物**である —— ' +
  '仕様だけから実行計画が決まる操作に、手で書く場所は 1 つも無い(ADR-0012 ④)。' +
  'ここに載っているのはその例外の**全部**であり、それぞれが action_spec に `runner: manual` を' +
  '理由つきで宣言している。宣言の無い操作の計画が導出できなければ `npm run verify` の A15 が' +
  'エラーにするので、**黙って手書きが増える道は無い**。理由は集約の章の受け入れが数える。';

/** 「手書きの RPC」節の読み方(定型)。 */
const HANDWRITTEN_NOTE =
  '書き込み RPC の SQL も**仕様からの生成物**である —— 定型 5 形(作成 / 編集 / 削除 / 遷移)は' +
  '許可列・楽観的並行制御・監査ログ・副作用の積み方まで宣言から決まり、`npm run generate` が' +
  ' plpgsql を丸ごと書き出す(ADR-0012 ⑤)。ここに載っているのはその**例外の全部**であり、' +
  '`shape: composite`(定型に乗らない手順を持つ)か、形は定型だが仕様から導けない手順が' +
  '混じっているため `handwritten` に理由を書いたものである。宣言の無い定型 RPC は ' +
  '`npm run verify` の T6 がエラーにするので、**黙って手書きが増える道は無い**。';

/** `shape: composite` の既定の理由(印そのものが「定型に乗らない」という宣言である)。 */
const DEFAULT_HANDWRITTEN_REASON = '定型に乗らない手順を持つ(複数集約をまたぐ・独自の順序が要る)';

/** 「入口の無い操作」節の読み方(定型)。 */
const UNHANDLED_NOTE =
  '`by` に人間ロールを含むイベントのうち、まだ action_spec を用意していないものと、その理由。' +
  '理由の無い欠けは A4 がエラーにするため、ここに載っているのは**意図して後回しにしたもの**だけである。';

/** 事実 9 属性の略号(成立するものだけを並べる)。 */
function attributeChips(row: ActionRow): string {
  const a = row.attributes;
  const chips: string[] = [];
  if (a.irreversible) chips.push('irreversible');
  if (a.terminal) chips.push('terminal');
  if (a.destructive) chips.push('destructive');
  if (a.affectsOthers) chips.push('affects_others');
  if (a.outbound) chips.push('outbound');
  if (a.bulk) chips.push('bulk');
  if (a.scheduled) chips.push('scheduled');
  if (a.privileged) chips.push('privileged');
  if (a.touchesPersonal) chips.push('touches_personal');
  return chips.length === 0 ? EMPTY_CELL : chips.map((chip) => `\`${chip}\``).join(' ');
}

/** 方針(確認の要否 + 上書きの理由)の 1 セル。 */
function policyCell(row: ActionRow): string {
  const a = row.attributes;
  const confirm = a.confirmRequired ? `confirm(${a.variant})` : '—';
  if (!a.overridden) return confirm;
  const reason = row.action.ux?.reason ?? '(reason 無し。V14 がエラーにする)';
  return `${confirm}(上書き: ${reason})`;
}

/** 集約 1 つ分の操作表の行。 */
function operationRows(rows: readonly ActionRow[]): string[][] {
  return rows.map((row) => [
    cell(`\`${row.action.handles.raw}\``),
    cell(row.doingText),
    cell(row.byRoles.join(', ')),
    cell(row.action.input.map((ref) => ref.field).join(', ')),
    cell(row.effects.join(', ')),
    cell(attributeChips(row)),
    cell(policyCell(row)),
    cell(String(row.action.testCases.length)),
  ]);
}

/**
 * 集約 1 つぶんの下段(見出しの段落・操作の表・操作ごとの結果表)。
 *
 * world を宣言から作れない集約は結果表の代わりに理由の 1 行を出す —— T11 が warning で報告するのと同じ事実であり、
 * 「表が無い」を黙らせない。
 */
function aggregateGroup(
  model: SpecModel,
  name: string,
  rows: readonly ActionRow[],
  results: readonly ResultAggregate[],
  ctx: GenerateContext,
): ActionsLowerGroup {
  const operations = operationRows(rows);
  const found = results.find((candidate) => candidate.aggregate === name);
  const missing = found === undefined ? null : noProofNote(found);
  const labels = found === undefined || missing !== null ? null : resultLabelsOf(model, ctx, name);
  const resultTables = rows.flatMap((row) => {
    const operation = found?.operations.find((candidate) => candidate.op === row.action.handles.raw);
    if (found === undefined || operation === undefined || labels === null) return [];
    return [operationResultTable(found, operation, labels, ctx.roots)];
  });
  return {
    title: aggregateTitle(name, model.aggregates.get(name)?.entity?.label),
    operations: {
      fold: { kind: 'table', title: `${name} の操作`, count: operations.length, hint: '何をするか・誰が実行できるか・入力・起きること', element: 'action.operation' },
      before: [],
      headers: HEADERS,
      rows: operations,
      after: [],
    },
    missing,
    results: resultTables,
  };
}

/** 集約 1 つぶんの Markdown の断片。 */
function groupBlocks(group: ActionsLowerGroup): string[] {
  return [
    `<p class="bf-group">${esc(group.title)}<small>操作 ${group.operations.rows.length} 本</small></p>`,
    ...markdownFoldedTable(group.operations),
    ...(group.missing === null ? [] : [group.missing]),
    ...group.results.map((table) => markdownFoldedTable(table).join('\n\n')),
  ];
}

/** 「生成に乗らない操作」の行(操作 ID 順)。理由は action_spec の `runner.reason` そのもの。 */
function manualRows(rows: readonly ActionRow[]): string[][] {
  return rows
    .filter((row) => row.action.runner !== undefined)
    .sort((a, b) => a.action.handles.raw.localeCompare(b.action.handles.raw))
    .map((row) => [cell(`\`${row.action.handles.raw}\``), cell(row.action.runner?.reason ?? '')]);
}

/**
 * SQL を手で書いている RPC の行(表 → 関数の宣言順)。
 *
 * 母集合は data_table の `functions` そのものであり、一覧を別に持たない —— 持つと「宣言を足したのに一覧に載せ忘れる」が起きる。
 */
function handwrittenRows(dataTables: DataTableSpecModel | undefined): string[][] {
  if (dataTables === undefined || !dataTables.available) return [];
  const rows: string[][] = [];
  for (const table of [...dataTables.tables].sort((a, b) => a.table.localeCompare(b.table))) {
    for (const fn of table.functions) {
      if (fn.kind !== 'rpc' || fn.migration !== undefined) continue;
      rows.push([cell(`\`${fn.name}\``), cell(`\`${table.table}\``), cell(fn.shape ?? EMPTY_CELL), cell(fn.handwritten ?? DEFAULT_HANDWRITTEN_REASON)]);
    }
  }
  return rows;
}

/**
 * 操作の章の下段を組む。
 *
 * @param model ドメイン仕様
 * @param ctx 生成コンテキスト
 * @param rows 操作の行(全部)
 * @param results 結果表の材料
 * @param actions 読み込み済みの action_spec 一式
 */
export function actionsLower(
  model: SpecModel,
  ctx: GenerateContext,
  rows: readonly ActionRow[],
  results: readonly ResultAggregate[],
  actions: ActionSpecModel,
): ActionsLower {
  const groups = [...actionRowsByAggregate(model, rows)].map(([name, forAggregate]) => aggregateGroup(model, name, forAggregate, results, ctx));
  const manual = manualRows(rows);
  const handwritten = handwrittenRows(ctx.dataTables);
  const unhandled = actions.unhandled.map((decl) => [cell(`\`${decl.event}\``), cell(decl.reason)]);
  const counts = {
    operations: groups.reduce((sum, group) => sum + group.operations.rows.length, 0),
    results: groups.reduce((sum, group) => sum + group.results.reduce((inner, table) => inner + table.rows.length, 0), 0),
    manual: manual.length,
    handwritten: handwritten.length,
    unhandled: unhandled.length,
  };
  const candidates: FoldedTable[] = [
    {
      fold: { kind: 'table', title: '生成に乗らない操作', count: manual.length, hint: 'runner: manual を理由つきで宣言した操作の全部', element: 'action.exception' },
      before: [MANUAL_NOTE],
      headers: ['操作', 'なぜ生成に乗らないか'],
      rows: manual,
      after: [],
    },
    {
      fold: { kind: 'table', title: '手書きの RPC', count: handwritten.length, hint: 'SQL を手で書いている RPC の全部', element: 'action.exception' },
      before: [HANDWRITTEN_NOTE],
      headers: ['RPC', '持ち場の表', '形', 'なぜ手書きか'],
      rows: handwritten,
      after: [],
    },
    {
      fold: { kind: 'table', title: '入口の無い操作', count: unhandled.length, hint: '意図して後回しにしたイベントの全部', element: 'action.exception' },
      before: [UNHANDLED_NOTE],
      headers: ['イベント', '理由'],
      rows: unhandled,
      after: [],
    },
  ];
  const exceptions = candidates.filter((entry) => entry.rows.length > 0);
  return {
    rows: counts,
    count: counts.operations + counts.results + counts.manual + counts.handwritten + counts.unhandled,
    groups,
    exceptions,
    blocks: [
      ...groups.flatMap(groupBlocks),
      '<p class="bf-group">例外の一覧(再掲)<small>理由は集約の章と表の章の受け入れが数える</small></p>',
      ...exceptions.flatMap(markdownFoldedTable),
    ],
  };
}
