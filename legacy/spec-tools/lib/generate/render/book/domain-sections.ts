/**
 * 集約の章(docs/book/domain/{aggregate}.html)の後半セクション群。
 *
 * 操作(誰が何をできるか)・見え方(誰に見えるか)・不変条件・読み取り経路を担当する。
 * どれも仕様の写像に、人間の判断が要る箇所の目印(⚠ と定型の読み方)を添えるだけで、
 * 情報は足さない。ページ全体の組み立ては html/aggregate-chapter.ts が行う。
 */

import type { AggregateSpecs, SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { compositeEnforcements } from '../../../semantics/composite-enforces.js';
import { buildGuardJaDict, guardToJapanese, type GuardJaDict } from '../guard-ja.js';
import { cell, EMPTY_CELL, withLabel } from '../../../gen-kit/state-machine-table.js';
import { roleLabels } from './access-view.js';

/** ガード式を日本語化する関数を作る(辞書の構築は章ごとに 1 回でよい)。 */
export function guardTranslator(
  model: SpecModel,
  ctx: GenerateContext,
): (expression: string | undefined, selfEntity?: string) => string {
  const dict: GuardJaDict = buildGuardJaDict(model);
  return (expression, selfEntity) => {
    const source = expression?.replace(/\r?\n/g, ' ').trim() ?? '';
    if (source.length === 0) return '常にできる';
    return guardToJapanese(source, ctx, dict, selfEntity);
  };
}

/** 操作の表の見出し。 */
export const OPERATION_HEADERS = ['操作', '内容', '誰が', 'いつできるか(条件)', '条件の意味'] as const;

/** 操作の表の行(Markdown の表と HTML の表が同じ行を使う)。操作が 1 つも無ければ null。 */
export function operationsRows(model: SpecModel, specs: AggregateSpecs, ctx: GenerateContext): readonly (readonly string[])[] | null {
  const ja = guardTranslator(model, ctx);
  const labels = roleLabels(model);
  const by = (roles: readonly string[]): string =>
    roles.map((role) => withLabel(role, labels.get(role))).join(', ');
  const entity = specs.access?.entity ?? specs.name;
  const rows: string[][] = [];
  for (const rule of specs.access?.creates ?? []) {
    rows.push([`\`${entity}.create\``, '作成', by([rule.by]), code(rule.when), cell(ja(rule.when, entity))]);
  }
  for (const machine of specs.stateMachines) {
    const state = (id: string): string => withLabel(id, machine.stateLabels[id]);
    for (const event of machine.events) {
      rows.push([
        cell(withLabel(`\`${machine.machine}.${event.id}\``, event.label)),
        cell(`状態遷移: ${event.from.map(state).join(', ')} → ${state(event.to)}`),
        by(event.by),
        code(event.guard),
        cell(ja(event.guard)),
      ]);
    }
  }
  const enforcements = compositeEnforcements(ctx.dataTables?.available === true ? ctx.dataTables.tables : []);
  for (const rule of specs.access?.writes ?? []) {
    // composite の関数が執行点なら名前を添える(定型の update は本文が規則から生成されるので添えない)
    const enforcers = enforcements
      .filter((item) => item.writes === entity && item.by === rule.by)
      .map((item) => `\`${item.function}\``);
    const note = enforcers.length === 0 ? '' : `(執行点: ${enforcers.join(', ')})`;
    rows.push([`\`${entity}.update\``, cell(`編集: ${rule.fields.join(', ')}${note}`), by([rule.by]), code(rule.when), cell(ja(rule.when, entity))]);
  }
  for (const rule of specs.access?.deletes ?? []) {
    rows.push([`\`${entity}.delete\``, '削除', by([rule.by]), code(rule.when), cell(ja(rule.when, entity))]);
  }
  return rows.length === 0 ? null : rows;
}

/** 条件式のセル。無ければ「—」(= 状態・ロールの条件だけで決まる)。 */
function code(expression: string | undefined): string {
  const source = expression?.replace(/\r?\n/g, ' ').trim() ?? '';
  return source.length === 0 ? EMPTY_CELL : `\`${cell(source)}\``;
}

/** 読み取り経路 1 本(Markdown の箇条と HTML の箇条が同じ事実を使う)。 */
export interface QueryItem {
  readonly name: string;
  /** この集約が source でなく併読で読まれるとき true。 */
  readonly joined: boolean;
  readonly roles: readonly string[];
  readonly returns: string;
}

/** この集約を source / 併読で読む query。 */
export function queryItems(specs: AggregateSpecs, ctx: GenerateContext): QueryItem[] {
  const queries = ctx.queries;
  if (queries === undefined || !queries.available) return [];
  const entity = specs.entity?.entity ?? specs.name;
  return queries.queries
    .filter((query) => query.source === entity || query.includes.some((include) => include.entity === entity))
    .map((query) => ({ name: query.name, joined: query.source !== entity, roles: query.forRoles, returns: query.returns }));
}
