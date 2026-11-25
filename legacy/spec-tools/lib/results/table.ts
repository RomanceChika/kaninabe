/**
 * 結果表を**人が読む 2 軸**に畳む(束 ⑳-5b)。
 *
 * 元データは全列挙のままである(単発の操作 3,969 通り・保存点 276 通り)。人が読む量ではないので、
 * 表は 2 軸に畳む —— 行は**実行者**(その人 × ロール配列)、列は**対象の状態**(編集は動かす欄・
 * 保存点は手順)である。残った軸(ガード変数)はマスの中の注記になる(設計 §4 の裁定)。
 *
 * **結末がどの行でも同じ列はまとめる**(`READABLE_COLUMNS` を参照)—— 編集の表は欄の数がその
 * まま列になるため、22 列 × 1 行 1,200 字という「横スクロールしながら読む表」になっていた
 * (独立レビュー ⑳-5b 観点 5)。まとめても判定は 1 つも捨てない: 見出しにまとめた列の全部を
 * 並べるので、どの欄・どの状態がその結末だったかは読める。
 *
 * 畳むのは見せ方だけであり、判定は 1 つも捨てない —— マスに畳まれた組み合わせの結末が分かれたら、
 * マスがそれを示す(`table-cell.ts`)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { RESULT_WORDS } from '../messages/messages-results.js';
import type { EqActor, EqSaveActor } from '../world/index.js';
import type { ResultCase, ResultOperation } from './cases.js';
import type { SaveResult, SaveResultCase } from './save-cases.js';
import type { CellCase, ResultLabels } from './table-cell.js';
import { cellText, openLegend } from './table-cell.js';

/**
 * **人が横スクロールせずに読める列の数**(実行者の 2 列を含む)。
 *
 * 数として置いてあるのは、文言(`messages-results.ts`)ではなく**表の作り方**の話だからである。
 * ここを超える表は「結末が同じ列をまとめる」で縮める —— それでも超えるなら、残るのは本当に
 * 結末が違う列だけであり、縮めれば判定を捨てることになる(だから切らない)。
 *
 * 数値は実測から決めた: 題材の製品の 40 表のうち、まとめる前に 8 列を超えていたのは編集の 7 表
 * だけで、まとめたあとはすべて 8 列以下になる。
 */
export const READABLE_COLUMNS = 8;

/** 人が読む表 1 つ。 */
export interface ResultTableView {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** 拒否の理由の凡例(番号順)。 */
  readonly legend: readonly string[];
  /** ❌ の理由の**文面**(重複なし・番号順)。章をまたいで数え直さないために生で持つ。 */
  readonly reasonTexts: readonly string[];
  /** ❌ の理由の種類数(この表の中での数)。 */
  readonly reasonKinds: number;
  /** 列が何か(前書きが示す)。 */
  readonly columnKind: 'state' | 'field' | 'subject' | 'step';
}

/**
 * 操作 1 つの結果表。
 *
 * @param operation 操作 1 つぶんの全列挙
 * @param actors world の実行者(行の語の出どころ)
 * @param labels 表の語
 * @returns 人が読む表
 */
export function operationTableView(
  operation: ResultOperation,
  actors: readonly EqActor[],
  labels: ResultLabels,
): ResultTableView {
  const legend = openLegend(labels);
  const columns = columnsOf(operation);
  const body = rowKeysOf(operation.cases).map((key) => {
    const forRow = operation.cases.filter((found) => found.actor === key.actor && found.array === key.array);
    return {
      head: [actorCell(actors, key.actor, labels), RESULT_WORDS.arrays[key.array] ?? key.array],
      cells: columns.map((column) =>
        cellText(
          forRow.filter((found) => columnOf(found, operation) === column).map(asCellCase),
          legend,
        ),
      ),
    };
  });
  const merged = mergeColumns(
    columns.map((column) => columnLabel(column, operation, labels)),
    body.map((row) => row.cells),
  );
  return {
    headers: [RESULT_WORDS.actorHeader, RESULT_WORDS.arrayHeader, ...merged.headers],
    rows: body.map((row, index) => [...row.head, ...(merged.rows[index] ?? [])]),
    legend: legend.lines(),
    reasonTexts: legend.texts(),
    reasonKinds: legend.texts().length,
    columnKind: columnKindOf(operation),
  };
}

/** その操作の表の列が何か。 */
function columnKindOf(operation: ResultOperation): 'state' | 'field' | 'subject' {
  if (usesStates(operation)) return 'state';
  return operation.cases.some((found) => found.field !== null) ? 'field' : 'subject';
}

/**
 * 結末がどの行でも同じ列をまとめる(見出しは中黒でつなぐ)。
 *
 * @param headers 列の見出し
 * @param rows 行ごとのマス(列と同じ並び)
 * @returns まとめたあとの見出しと行
 */
function mergeColumns(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] } {
  const groups: { labels: string[]; column: number }[] = [];
  for (const [index, header] of headers.entries()) {
    const signature = rows.map((row) => row[index] ?? '').join('\u0000');
    const found = groups.find(
      (group) => rows.map((row) => row[group.column] ?? '').join('\u0000') === signature,
    );
    if (found === undefined) groups.push({ labels: [header], column: index });
    else found.labels.push(header);
  }
  return {
    headers: groups.map((group) => group.labels.join(COLUMN_JOIN)),
    rows: rows.map((row) => groups.map((group) => row[group.column] ?? '')),
  };
}

/** まとめた列の見出しのつなぎ。 */
const COLUMN_JOIN = ' / ';

/**
 * 保存点 1 つの結果表(列は手順)。
 *
 * @param save 保存点 1 つぶんの全列挙
 * @param labels 表の語
 * @returns 人が読む表
 */
export function saveTableView(save: SaveResult, labels: ResultLabels): ResultTableView {
  const legend = openLegend(labels);
  const rows = saveRowKeysOf(save.cases).map((key) => {
    const forRow = save.cases.filter((found) => found.actor === key.actor && found.caller === key.array);
    return [
      saveActorCell(save.actors, key.actor, labels),
      RESULT_WORDS.arrays[key.array] ?? key.array,
      ...save.steps.map((_step, index) =>
        cellText(
          forRow.map((found) => asSaveCellCase(found, index)),
          legend,
        ),
      ),
    ];
  });
  return {
    headers: [
      RESULT_WORDS.actorHeader,
      RESULT_WORDS.callerHeader,
      ...save.steps.map((step) => `\`${step.op}\``),
    ],
    rows,
    legend: legend.lines(),
    reasonTexts: legend.texts(),
    reasonKinds: legend.texts().length,
    columnKind: 'step',
  };
}

/** 行の鍵(実行者 × ロール配列)。 */
interface RowKey {
  readonly actor: string;
  readonly array: string;
}

/** 行の並び(列挙に出てきた順)。 */
function rowKeysOf(cases: readonly ResultCase[]): readonly RowKey[] {
  const keys: RowKey[] = [];
  for (const found of cases) {
    if (keys.some((key) => key.actor === found.actor && key.array === found.array)) continue;
    keys.push({ actor: found.actor, array: found.array });
  }
  return keys;
}

/** 行の並び(保存点。実行者 × 呼び出し元の文脈)。 */
function saveRowKeysOf(cases: readonly SaveResultCase[]): readonly RowKey[] {
  const keys: RowKey[] = [];
  for (const found of cases) {
    if (keys.some((key) => key.actor === found.actor && key.array === found.caller)) continue;
    keys.push({ actor: found.actor, array: found.caller });
  }
  return keys;
}

/**
 * 列の並び(状態 → 動かす欄 → 対象 1 列)。
 *
 * 状態を持つ形は状態が列になり、編集は欄が列になる(`canWrite` は欄ごとに判定するので、
 * 欄をマスに畳むと「どの欄なら動かせるか」が読めなくなる)。どちらも無い形は 1 列である。
 */
function columnsOf(operation: ResultOperation): readonly (string | null)[] {
  const states = distinct(operation.cases.map((found) => found.state));
  if (states.some((state) => state !== null)) return states;
  const fields = distinct(operation.cases.map((found) => found.field));
  return fields.some((field) => field !== null) ? fields : [null];
}

/** その組み合わせがどの列に入るか。 */
function columnOf(found: ResultCase, operation: ResultOperation): string | null {
  return usesStates(operation) ? found.state : found.field;
}

/** 列が状態か(状態を持たない形では欄が列になる)。 */
function usesStates(operation: ResultOperation): boolean {
  return operation.cases.some((found) => found.state !== null);
}

/** 列の見出し。 */
function columnLabel(
  column: string | null,
  operation: ResultOperation,
  labels: ResultLabels,
): string {
  if (column === null) return RESULT_WORDS.subjectHeader;
  return usesStates(operation) ? labels.state(column) : labels.field(column);
}

/**
 * 実行者のマス(役の label + 何を根拠に立つ人か。根拠は成立しているが行の条件を満たさない人には、
 * どの役の条件を満たさないかを添える)。
 */
function actorCell(actors: readonly EqActor[], key: string, labels: ResultLabels): string {
  const actor = actors.find((candidate) => candidate.key === key);
  return actor === undefined ? key : actorLabel(actor, labels);
}

/** 実行者のマス(保存点)。 */
function saveActorCell(actors: readonly EqSaveActor[], key: string, labels: ResultLabels): string {
  const actor = actors.find((candidate) => candidate.key === key);
  return actor === undefined ? key : actorLabel(actor, labels);
}

/** 実行者の見出し(単発も保存点も同じ形)。 */
function actorLabel(
  actor: Pick<EqActor, 'role' | 'basis' | 'unmet'>,
  labels: ResultLabels,
): string {
  const base = `${labels.role(actor.role)} / ${RESULT_WORDS.basis[actor.basis] ?? actor.basis}`;
  return actor.unmet === undefined ? base : `${base} / ${RESULT_WORDS.unmet(labels.role(actor.unmet))}`;
}

/** 組み合わせ 1 つをマスの材料にする。 */
function asCellCase(found: ResultCase): CellCase {
  return { axis: found.axis, decision: found.decision };
}

/** 保存点の組み合わせ 1 つを、その手順のマスの材料にする。 */
function asSaveCellCase(found: SaveResultCase, index: number): CellCase {
  const step = found.steps[index];
  if (step === undefined) {
    return { axis: found.axis, decision: { allowed: true, reason: '', allowedRoles: [], guardSource: null, otherwiseForbidden: null, unresolvedPaths: [] } };
  }
  return { axis: found.axis, decision: step.decision, notReached: !step.reached };
}

/** 重複を落とした並び(出てきた順)。 */
function distinct<T>(values: readonly T[]): readonly T[] {
  const found: T[] = [];
  for (const value of values) {
    if (!found.includes(value)) found.push(value);
  }
  return found;
}
