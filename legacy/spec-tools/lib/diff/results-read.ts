/**
 * 結果表の元データ(単発の操作 / 保存点)を**片側ぶん**読む段。
 *
 * ここが持つのは読み取りと写しだけで、突き合わせは `results.ts` にある。分けたのは
 * 「読めているのに答えが無い」という 3 つ目の結末を漏れなく運ぶためである ——
 * 結果表は world を宣言から作れないと `operations: []` になり、その集約の操作は
 * **1 つも判定されない**。黙って空の表を返すと、その操作の権限が動いても差分が 0 件になる。
 *
 * 行の並びは `caseFields` が**名前で**宣言しているので、位置ではなく名前で引く ——
 * 列順が変わったときに黙って別の欄を読む形を残さないためである。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { factKey, FactBuilder } from './facts.js';
import {
  axisQualifier,
  blockedAtStep,
  callerQualifier,
  contextQualifier,
  DECISION_ALLOWED,
  decisionRefused,
  fieldQualifier,
  shapeQualifier,
} from './messages.js';
import { asArray, asNumber, asString, asStrings, field, flatten } from './plain.js';
import { readJson, unionPaths } from './reader.js';
import { isResultsPath } from './sources.js';
import type { PlainValue } from './ts-literal.js';
import type { DiffProblem, SideSnapshot } from './types.js';
import type { ProductRoots } from '../model/product/types.js';

/** 付帯の区切り(1 つの鍵の中に畳むため)。 */
export const QUALIFIER_JOIN = '・';

/** 片側の結果表ぜんぶ。 */
export interface ResultsSide {
  /** 操作(または保存点)の鍵 → 事実の表。 */
  readonly byUnit: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** 実行者の名前 → ロール ID(表示名の引き当てに使う)。 */
  readonly actorRoles: ReadonlyMap<string, string>;
  /** その版が宣言した操作 ID の全数(判定の有無によらない)。 */
  readonly declaredOps: ReadonlySet<string>;
  /** 読めなかった・答えが無かったもの。 */
  readonly problems: readonly DiffProblem[];
  /**
   * 結果表のどれかが**読めなかった**か。
   *
   * 読めない版の表は空になるので、そのまま突き合わせるとその集約の操作が全部「消えた」に
   * 化ける(実測: 結果表 1 本を壊すと ➖ が 3 行出た)。呼び出し側はこれが立っていたら
   * 1 行も出さない。
   */
  readonly blind: boolean;
}

/** 組み立て中の片側。 */
interface SideBuilder {
  readonly byUnit: Map<string, ReadonlyMap<string, string>>;
  readonly actorRoles: Map<string, string>;
  readonly declaredOps: Set<string>;
  readonly problems: DiffProblem[];
}

/** 読めなかった(= 判定できない)ものが 1 つでもあるか。 */
function blindOf(problems: readonly DiffProblem[]): boolean {
  return problems.some((problem) => problem.kind === 'unreadable');
}

/** `caseFields` の宣言に従って 1 行から欄を引く(位置ではなく名前)。 */
function cell(fields: readonly string[], row: readonly PlainValue[], name: string): PlainValue | undefined {
  const index = fields.indexOf(name);
  return index === -1 ? undefined : row[index];
}

/** 拒否の理由を 1 行に畳む(0 は通った側)。 */
function decisionText(refusals: readonly PlainValue[], number: number | undefined): string {
  if (number === undefined || number <= 0) return DECISION_ALLOWED;
  const row = refusals[number - 1];
  const parts = [asString(field(row, 'reason')) ?? ''];
  const roles = asStrings(field(row, 'allowedRoles'));
  if (roles.length > 0) parts.push(roles.join(' / '));
  const guard = asString(field(row, 'guardSource'));
  if (guard !== undefined) parts.push(guard);
  return decisionRefused(parts.filter((part) => part !== '').join(' '));
}

/** 実行者の宣言からロールを写す。 */
function absorbActors(value: PlainValue | undefined, into: Map<string, string>): void {
  for (const actor of asArray(value)) {
    const key = asString(field(actor, 'key'));
    const role = asString(field(actor, 'role'));
    if (key !== undefined && role !== undefined) into.set(key, role);
  }
}

/** case 1 つの鍵(状態・実行者・付帯。付帯は表示のまま畳む)。 */
function caseKey(state: string, actor: string, qualifiers: readonly string[]): string {
  return factKey(state, actor, qualifiers.join(QUALIFIER_JOIN));
}

/** 集約の形(単発の操作)を写し、**判定が無い操作**を理由つきで運ぶ。 */
function absorbAggregate(value: PlainValue, side: SideBuilder, where: DiffProblem): void {
  const fields = asStrings(field(value, 'caseFields'));
  absorbActors(field(value, 'actors'), side.actorRoles);
  const declared = asStrings(field(value, 'ops'));
  for (const op of declared) side.declaredOps.add(op);
  const decided = new Set<string>();
  for (const operation of asArray(field(value, 'operations'))) {
    const op = asString(field(operation, 'op'));
    if (op === undefined) continue;
    decided.add(op);
    const refusals = asArray(field(operation, 'refusals'));
    const builder = new FactBuilder();
    for (const found of asArray(field(operation, 'cases'))) {
      const row = asArray(found);
      const qualifiers = [callerQualifier(flatten(cell(fields, row, 'array')))];
      const column = flatten(cell(fields, row, 'field'));
      if (column !== '') qualifiers.push(fieldQualifier(column));
      const axis = flatten(cell(fields, row, 'axis'));
      if (axis !== '') qualifiers.push(axisQualifier(axis));
      builder.add(
        caseKey(flatten(cell(fields, row, 'state')), flatten(cell(fields, row, 'actor')), qualifiers),
        decisionText(refusals, asNumber(cell(fields, row, 'refusal'))),
      );
    }
    side.byUnit.set(op, builder.table());
  }
  const blind = declared.filter((op) => !decided.has(op));
  if (blind.length === 0) return;
  const reasons = asStrings(field(value, 'problems'));
  side.problems.push({ ...where, reason: `${blind.join(' / ')} — ${reasons.join(' / ') || 'world を宣言から作れません'}` });
}

/** 保存点の形(複数手順)を写す。落ちた手順まで中身に入れる。 */
function absorbSaves(value: PlainValue, side: SideBuilder): void {
  const fields = asStrings(field(value, 'caseFields'));
  for (const save of asArray(field(value, 'saves'))) {
    const key = asString(field(save, 'key'));
    if (key === undefined) continue;
    absorbActors(field(save, 'actors'), side.actorRoles);
    const refusals = asArray(field(save, 'refusals'));
    const steps = asArray(field(save, 'steps'));
    const builder = new FactBuilder();
    for (const found of asArray(field(save, 'cases'))) {
      const row = asArray(found);
      const blocked = asNumber(cell(fields, row, 'blockedAt'));
      const numbers = asArray(cell(fields, row, 'steps'));
      const stop =
        blocked === undefined
          ? DECISION_ALLOWED
          : `${blockedAtStep(blocked, asString(field(steps[blocked], 'op')) ?? '')} ${decisionText(refusals, asNumber(numbers[blocked]))}`;
      const qualifiers = [
        contextQualifier(flatten(cell(fields, row, 'caller'))),
        shapeQualifier(`${flatten(cell(fields, row, 'repeat'))} ${flatten(cell(fields, row, 'input'))}`),
      ];
      const axis = flatten(cell(fields, row, 'axis'));
      if (axis !== '') qualifiers.push(axisQualifier(axis));
      builder.add(caseKey('', flatten(cell(fields, row, 'actor')), qualifiers), stop);
    }
    side.byUnit.set(key, builder.table());
  }
}

/**
 * 片側の結果表をすべて読む。
 *
 * @param base 基点側の写し(読むパスを両版の合併で決めるために要る)
 * @param head 比較先の写し
 * @param side どちらを読むか
 * @returns 事実の表・実行者のロール・宣言された操作・読めなかったもの
 */
export function resultsSide(
  base: SideSnapshot,
  head: SideSnapshot,
  side: DiffProblem['side'],
  roots: ProductRoots,
): ResultsSide {
  const snapshot = side === 'base' ? base : head;
  const built: SideBuilder = { byUnit: new Map(), actorRoles: new Map(), declaredOps: new Set(), problems: [] };
  for (const path of unionPaths(base, head, (path) => isResultsPath(path, roots))) {
    const read = readJson(snapshot, side, path);
    if (read.problem !== null) built.problems.push(read.problem);
    if (read.value === undefined) continue;
    absorbAggregate(read.value, built, { kind: 'unanswered', side, path, reason: '' });
    absorbSaves(read.value, built);
  }
  return { ...built, blind: blindOf(built.problems) };
}
