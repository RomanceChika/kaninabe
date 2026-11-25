/**
 * 可視性の章の下段の 1 節: **未ログインに開いた書き込み**(読み取りの表の対)。
 *
 * 読み取りの表(誰に何が見えるか)は「見える範囲」を集めた。書き込みにも同じ種類の穴がある —— 未ログインが作成できる集約は
 * 毎回違う鍵で送られれば行を無制限に作られ、未ログインが更新・削除・遷移できる形は認証なしで他人の行を動かせる。
 * この表は、その**開いている形の全数**(V2.1.3 / V15.1.3 の証拠)を 1 か所に集める。
 *
 * | 種類 | 内容の欄 | 出どころの欄 |
 * |---|---|---|
 * | 作成(`creates[].abuse`) | 全体の天井・鍵ごとの天井・数える欄 | 生成されるトリガの名前(生成できなければ、その理由) |
 * | 更新・削除・遷移(`public: 理由`) | 開けてよい理由 | その規則の場所(`public` の理由が正) |
 *
 * 判定(未ログインが持つロール・天井を出せるか)は検査 R5 と同じ関数を読む(`model/data/ceiling-plan.ts`)。純関数であり throw しない。
 * **アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, AggregateSpecs, SpecModel } from '../../../model/types.js';
import type { DataTableSpec } from '../../../model/data/types.js';
import { anonymousReach, judgeCeiling } from '../../../model/data/ceiling-plan.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { cell } from '../../../gen-kit/state-machine-table.js';

/** 節の導入(定型)。 */
export const OPEN_WRITES_LEAD =
  '未ログインが書ける形の全数。作成は、毎回違う鍵で送られても効く**全体の天井**(と、同じ鍵の天井)を持ち、' +
  'その執行は commit 時の制約トリガ(access_spec の `creates[].abuse` から生成。表ごとの advisory lock を取ってから数える)である。' +
  '期間はスライドする —— 行が消されれば枠は空く(累計の受付の上限ではない)。' +
  '更新・削除・遷移は、認証なしで他人の行を動かせる形なので、開けてよい理由(`public`)を書いたものだけが通る。' +
  '重い機能の洗い出し(V15.1.3)のもう一方、お金を使う口(有料の連携)がある製品では、外部連携の章の「有料の資源を使う口」に別の表がある。';

/** 表の見出し。 */
export const OPEN_WRITES_HEADER: readonly string[] = ['集約', '操作', '誰が', '内容', '出どころ'];

/** 集約の表(entity で引く。無ければ undefined)。 */
function tableOf(access: AccessSpec, ctx: GenerateContext): DataTableSpec | undefined {
  return ctx.dataTables?.available === true ? ctx.dataTables.tables.find((table) => table.entity === access.entity) : undefined;
}

/** 作成の天井の内容と出どころ(生成できない宣言は、その理由を出どころに出す)。 */
function ceilingRow(model: SpecModel, access: AccessSpec, ctx: GenerateContext, index: number): string[] | null {
  const rule = access.creates[index];
  const abuse = rule?.abuse;
  if (rule === undefined || abuse === undefined) return null;
  const parts = [
    abuse.globalCeiling === undefined ? '全体の天井が無い' : `全体 ${abuse.globalCeiling.max} 件 / ${abuse.globalCeiling.per}`,
    ...(abuse.perKey === undefined ? [] : [`同じ \`${abuse.perKey.column}\` ${abuse.perKey.max} 件 / ${abuse.perKey.per}`]),
  ];
  const table = tableOf(access, ctx);
  const judged = table === undefined ? undefined : judgeCeiling(table, model);
  const origin =
    judged === undefined
      ? '生成するトリガ(表が読めていないため名前は未確認)'
      : judged.kind === 'ok'
        ? `生成トリガ \`${judged.plan.name}\`${judged.plan.invariant === undefined ? '' : `(${judged.plan.invariant.id})`}`
        : judged.kind === 'refused'
          ? `生成できない: ${judged.reason}`
          : '—';
  return [cell(access.entity), cell('作成'), cell(rule.by), cell(parts.join('、')), cell(origin)];
}

/** `public` の理由つき規則(更新・削除・遷移)の行。 */
function publicRow(entity: string, operation: string, by: string, reason: string | undefined): string[] | null {
  return reason === undefined ? null : [cell(entity), cell(operation), cell(by), cell(reason.trim() === '' ? '(理由が空)' : reason), cell('`public` の理由(その規則の場所が正)')];
}

/** 集約 1 つの行(作成 → 更新 → 削除 → 遷移の順)。 */
function aggregateRows(model: SpecModel, specs: AggregateSpecs, ctx: GenerateContext, open: ReadonlySet<string>): string[][] {
  const access = specs.access;
  const rows: (string[] | null)[] = [];
  if (access !== undefined) {
    access.creates.forEach((rule, index) => rows.push(open.has(rule.by) ? ceilingRow(model, access, ctx, index) : null));
    for (const rule of access.writes) rows.push(open.has(rule.by) ? publicRow(access.entity, `更新(${rule.fields.join(', ')})`, rule.by, rule.public) : null);
    for (const rule of access.deletes) rows.push(open.has(rule.by) ? publicRow(access.entity, '削除', rule.by, rule.public) : null);
  }
  for (const machine of specs.stateMachines) {
    for (const event of machine.events) {
      const by = event.by.filter((role) => open.has(role));
      if (by.length > 0) rows.push(publicRow(machine.machine, `遷移 \`${event.id}\``, by.join(', '), event.public));
    }
  }
  return rows.filter((row): row is string[] => row !== null);
}

/**
 * 未ログインに開いた書き込みの行(全集約)。
 *
 * @param model ドメイン仕様
 * @param ctx 生成コンテキスト(data_table からトリガの名前を引く)
 * @returns 表の行(開いている形が無ければ空)
 */
export function openWriteRows(model: SpecModel, ctx: GenerateContext): string[][] {
  const open = anonymousReach(model);
  return [...model.aggregates.values()].flatMap((specs) => aggregateRows(model, specs, ctx, open));
}

