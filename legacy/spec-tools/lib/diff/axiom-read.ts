/**
 * 公理の側の事実(`axioms.ts`)を、生成物の写し 1 版から読む段。
 *
 * **3 つを分ける**(`reader.ts` / C23 と同じ流儀) ——
 * - **その版に無かった**(ファイルが無い。事実が空になるだけで、出入りとして差分に出る)
 * - **読めた**(事実の表になる)
 * - **読めなかった**(ファイルはあるが壊れている・形が違う。**事実が無いものとは読まない**)
 *
 * 最後を「事実が無い」と読むと、壊れた側の版が空の表になり、**反対側の中身がまるごと「増えた」「消えた」に化ける**。
 * 読めなかったことは問題として返し、その源が受け持つ事実は比べない範囲(`BlindScope`)に入れる。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { ProductRoots } from '../model/product/types.js';
import type { ReadingChange } from '../semantics/reading-change.js';
import { FactBuilder } from './facts.js';
import type { FactTable } from './facts.js';
import { generatedStatementsPath, generatedSummariesPath } from './axiom-sources.js';
import { readExport } from './reader.js';
import { isLabelsPath, stemOf } from './sources.js';
import type { PlainValue } from './ts-literal.js';
import { exportedNames, readExportedValue } from './ts-literal.js';
import type { DiffProblem, SideSnapshot } from './types.js';

/** 不変条件の言明の export 名(生成物が持つ綴り)。 */
const STATEMENTS = 'invariantStatements';

/** 状態の表示名・イベントの呼び名の export 名の形。 */
const STATE_LABELS = /(\w+)StateLabels/;
const EVENT_LABELS = /(\w+)EventLabels/;

/** 鍵の接頭辞(事実の表の中で種類を混ぜるための区切り)。 */
export const PREFIX = {
  invariant: 'invariant:',
  state: 'state:',
  event: 'event:',
  entitySummary: 'summary-entity:',
  machineSummary: 'summary-machine:',
  stateSummary: 'summary-state:',
  example: 'example:',
} as const;

/** 要約の写し(`SummaryTable`)の節と、事実の鍵の接頭辞の対応。 */
export const SUMMARY_KINDS = [
  ['entity', PREFIX.entitySummary],
  ['machine', PREFIX.machineSummary],
  ['state', PREFIX.stateSummary],
  ['example', PREFIX.example],
] as const;

/** 要素の種類(公理の側の差分の 1 件が持つもの)。 */
type Element = ReadingChange['element'];

/**
 * 読めなかった源が受け持つ、**比べられない**差分の範囲。
 *
 * 要素の種類が合い、かつ鍵が接頭辞で始まる差分は、片側が読めていないので「増えた」「消えた」を言えない。
 */
export interface BlindScope {
  readonly elements: readonly Element[];
  /** 差分の鍵の接頭辞(源が鍵の一部を受け持つとき。全部を受け持つなら空)。 */
  readonly keyPrefix: string;
}

/** 公理の側の事実の表と、読めなかったものの報告。 */
export interface AxiomFacts {
  readonly table: FactTable;
  /** 読めなかった(`unreadable`)・宣言が無かった(`undeclared`)ものの報告。 */
  readonly problems: readonly DiffProblem[];
  /** `unreadable` の源が受け持つ、比べない範囲。 */
  readonly blind: readonly BlindScope[];
}

/** 読めなかった源が受け持つ要素の種類(要約の写しは 4 種を持つ)。 */
const SUMMARY_ELEMENTS: readonly Element[] = ['entity.summary', 'machine.summary', 'state.summary', 'computes.example'];

/** 素のデータがオブジェクトか(配列・null は違う)。 */
function isObject(value: unknown): value is Readonly<Record<string, PlainValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** オブジェクトのうち文字列の値だけを、鍵つきで取り出す。 */
function stringEntries(value: Readonly<Record<string, PlainValue>>): readonly (readonly [string, string])[] {
  return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

/** 事実の表を組みながら、読めなかったことを集める小道具。 */
class Reading {
  readonly builder = new FactBuilder();
  readonly problems: DiffProblem[] = [];
  readonly blind: BlindScope[] = [];

  constructor(private readonly side: DiffProblem['side']) {}

  /** 読めなかった源を 1 件記録する(その源が受け持つ範囲は比べない)。 */
  unreadable(path: string, reason: string, scope: BlindScope): void {
    this.problems.push({ kind: 'unreadable', side: this.side, path, reason });
    this.blind.push(scope);
  }

  result(): AxiomFacts {
    return { table: this.builder.table(), problems: this.problems, blind: this.blind };
  }
}

/** 不変条件の言明の写し(`invariants.ts`)を読む。 */
function readStatements(reading: Reading, snapshot: SideSnapshot, roots: ProductRoots, side: DiffProblem['side']): void {
  const path = generatedStatementsPath(roots);
  const read = readExport(snapshot, side, path, STATEMENTS);
  const scope: BlindScope = { elements: ['invariant.statement'], keyPrefix: '' };
  if (read.problem !== null) {
    if (read.problem.kind === 'unreadable') reading.unreadable(path, read.problem.reason, scope);
    else reading.problems.push(read.problem);
    return;
  }
  if (read.value === undefined) return;
  if (!isObject(read.value)) {
    reading.unreadable(path, `${STATEMENTS} がオブジェクトではありません`, scope);
    return;
  }
  for (const [id, text] of stringEntries(read.value)) reading.builder.add(`${PREFIX.invariant}${id}`, text);
}

/** 要約の文の写し(`summaries.json`)を読む。形が違えば、事実を 1 件も足さずに読めなかったと報告する。 */
function readSummaries(reading: Reading, snapshot: SideSnapshot, roots: ProductRoots): void {
  const path = generatedSummariesPath(roots);
  const source = snapshot.get(path);
  if (source === null || source === undefined) return;
  const scope: BlindScope = { elements: SUMMARY_ELEMENTS, keyPrefix: '' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    reading.unreadable(path, 'JSON として読めません', scope);
    return;
  }
  if (!isObject(parsed)) {
    reading.unreadable(path, '最上位がオブジェクトではありません', scope);
    return;
  }
  const table = parsed as Readonly<Record<string, PlainValue | undefined>>;
  for (const [kind] of SUMMARY_KINDS) {
    const section = table[kind];
    if (section !== undefined && !isObject(section)) {
      reading.unreadable(path, `「${kind}」の節がオブジェクトではありません`, scope);
      return;
    }
  }
  for (const [kind, prefix] of SUMMARY_KINDS) {
    const section = table[kind];
    if (section !== undefined && isObject(section)) for (const [key, text] of stringEntries(section)) reading.builder.add(`${prefix}${key}`, text);
  }
}

/** 状態の表示名・イベントの呼び名の写し(`{状態機械}.labels.ts`)を、1 本ずつ読む。 */
function readLabels(reading: Reading, snapshot: SideSnapshot, roots: ProductRoots): void {
  for (const [path, content] of snapshot) {
    if (content === null || !isLabelsPath(path, roots)) continue;
    const stem = stemOf(path);
    const scope: BlindScope = { elements: ['state.label', 'transition.meaning'], keyPrefix: `${stem}.` };
    for (const [pattern, prefix] of [[STATE_LABELS, PREFIX.state], [EVENT_LABELS, PREFIX.event]] as const) {
      for (const found of exportedNames(content, pattern)) {
        const read = readExportedValue(content, found.name);
        if (!read.ok) {
          reading.unreadable(path, read.reason, scope);
        } else if (!isObject(read.value)) {
          reading.unreadable(path, `${found.name} がオブジェクトではありません`, scope);
        } else {
          for (const [key, label] of stringEntries(read.value)) reading.builder.add(`${prefix}${stem}.${key}`, label);
        }
      }
    }
  }
}

/**
 * 公理の側の事実の表を、生成物の写し 1 版から作る。**読めなかった源は事実が無いものと読まない**。
 *
 * @param snapshot 片側の生成物の写し
 * @param roots 製品が宣言した根
 * @param side どちらの版か(報告の文面に使う)
 * @returns 事実の表と、読めなかったものの報告・比べない範囲
 */
export function readAxiomFacts(snapshot: SideSnapshot, roots: ProductRoots, side: DiffProblem['side']): AxiomFacts {
  const reading = new Reading(side);
  readStatements(reading, snapshot, roots, side);
  readSummaries(reading, snapshot, roots);
  readLabels(reading, snapshot, roots);
  return reading.result();
}

/**
 * 事実の表だけをもつ読み(読めなかったものが無い側)。仕様モデルから作った比較先がこれになる。
 *
 * @param table 事実の表
 */
export function readableFacts(table: FactTable): AxiomFacts {
  return { table, problems: [], blind: [] };
}

/**
 * 差分の 1 件が、比べられない範囲に入るか。
 *
 * @param change 差分の 1 件
 * @param blind 比べない範囲
 */
export function isBlind(change: ReadingChange, blind: readonly BlindScope[]): boolean {
  return blind.some((scope) => scope.elements.includes(change.element) && change.key.startsWith(scope.keyPrefix));
}
