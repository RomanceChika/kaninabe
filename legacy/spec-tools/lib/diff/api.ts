/**
 * 軸「公開される欄」—— 外に出る surface(ビュー)に何が載り、隠し列が誰に解け、どの RPC が外から呼べるか。
 *
 * 元は API スキーマの期待表である。**ビューに載る列の全数**・**隠し列が解ける相手**・
 * **外から呼べる RPC の閉世界**の 3 つを持っており、どれも「何が新しく公開されるか」という
 * 問いに直接答える(設計メモ §1)。列が載る = 外から読める、隠しが外れる = 中身が返る、
 * RPC が載る = 外から呼び出せる、である。
 *
 * **片側が読めないときは 1 行も出さない** —— 空の表と比べると、読めた側の中身がまるごと
 * 「増えた」に化けて偽の 🔓 が並ぶ(独立レビューの止め 2)。
 *
 * **内部テーブルのビューは数えない**(`apiInternalViews`)。そこに載る列は surface のロール
 * (anon / authenticated)に `select` が 1 つも無いビューの列であり、**外からは 1 行も読めない**
 * —— 数えると「外に出る surface に載った」が事実でなくなる。`api.jobs` を手書きから生成物へ
 * 差し替えた回(2026-09-23)に、同じ 13 列がそのままの可視性で 🔓 13 件として並んだのが実例で
 * ある。ビューが内部から surface へ移った日には、その列は正しく「載った」として出る。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { diffFacts, FactBuilder, setDelta } from './facts.js';
import { changeText } from './messages.js';
import { asArray, asObject, asString, asStrings, field } from './plain.js';
import { problemsOf, readExport, unreadable } from './reader.js';
import { apiExpectationsPath } from './sources.js';
import type { PlainValue } from './ts-literal.js';
import type { AxisInput, AxisResult, DiffDirection, SemanticChange } from './types.js';

/** 期待表の export 名(生成物が持つ綴り)。 */
const API_VIEWS = 'apiViews';

/** 外から呼べる RPC の export 名。 */
const API_RPCS = 'apiRpcFunctions';

/** surface のロールに何も与えないビュー(内部テーブルの surface)の export 名。 */
const API_INTERNAL_VIEWS = 'apiInternalViews';

/** 見える相手の並びを 1 行に畳む(比較の値であり、同じ中身なら必ず同じ文字列になる)。 */
function audience(roles: readonly string[]): string {
  return [...roles].sort().join(' / ');
}

/** 外から 1 行も読めないビューの名前(内部テーブルの surface)。 */
function internalViews(value: PlainValue | undefined): ReadonlySet<string> {
  return new Set(asStrings(value));
}

/** 表 → 載る列、の事実の表。 */
function columnTable(
  value: PlainValue | undefined,
  internal: ReadonlySet<string>,
): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  const views = asObject(value);
  if (views === undefined) return builder.table();
  for (const table of Object.keys(views).sort()) {
    if (internal.has(table)) continue;
    for (const column of asStrings(field(views[table], 'columns'))) builder.add(`${table}.${column}`, column);
  }
  return builder.table();
}

/** 表.欄 → 隠しが解ける相手、の事実の表。 */
function maskedTable(
  value: PlainValue | undefined,
  internal: ReadonlySet<string>,
): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  const views = asObject(value);
  if (views === undefined) return builder.table();
  for (const table of Object.keys(views).sort()) {
    if (internal.has(table)) continue;
    for (const masked of asArray(field(views[table], 'masked'))) {
      const column = asString(field(masked, 'column'));
      if (column === undefined) continue;
      builder.add(`${table}.${column}`, audience(asStrings(field(masked, 'visibleTo'))));
    }
  }
  return builder.table();
}

/** 外から呼べる RPC、の事実の表。 */
function rpcTable(value: PlainValue | undefined): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  for (const name of asStrings(value)) builder.add(name, name);
  return builder.table();
}

/** 見える相手の入れ替わりの向き(増えたら広がった・減ったら狭まった・両方なら入れ替わり)。 */
function audienceDirection(before: string, after: string): DiffDirection {
  const delta = setDelta(before.split(' / '), after.split(' / '));
  if (delta.gained.length > 0 && delta.lost.length === 0) return 'widened';
  if (delta.lost.length > 0 && delta.gained.length === 0) return 'narrowed';
  return 'changed';
}

/**
 * 隠し列の差分の向き。
 *
 * **隠しの宣言が増えた = 隠れた**(狭まった)、**消えた = 隠しが外れた**(広がった)である ——
 * 事実の表の出入りと意味の向きが逆になるので、ここで読み替える。
 */
function maskDirection(
  kind: 'added' | 'removed' | 'changed',
  before: string | null,
  after: string | null,
): DiffDirection {
  if (kind === 'added') return 'narrowed';
  if (kind === 'removed') return 'widened';
  return audienceDirection(before ?? '', after ?? '');
}

/**
 * 軸「公開される欄」の差分。
 *
 * @param input 2 版の写しと表示名の帳面
 * @returns 行と、読めなかったもの
 */
export function columnChanges(input: AxisInput): AxisResult {
  const base = readExport(input.base, 'base', apiExpectationsPath(input.roots), API_VIEWS);
  const head = readExport(input.head, 'head', apiExpectationsPath(input.roots), API_VIEWS);
  const baseRpc = readExport(input.base, 'base', apiExpectationsPath(input.roots), API_RPCS);
  const headRpc = readExport(input.head, 'head', apiExpectationsPath(input.roots), API_RPCS);
  const baseInternal = readExport(input.base, 'base', apiExpectationsPath(input.roots), API_INTERNAL_VIEWS);
  const headInternal = readExport(input.head, 'head', apiExpectationsPath(input.roots), API_INTERNAL_VIEWS);
  const problems = problemsOf(base, head, baseRpc, headRpc, baseInternal, headInternal);
  const changes: SemanticChange[] = [];
  if (unreadable(base, head, baseRpc, headRpc, baseInternal, headInternal)) return { changes, problems };
  const baseHidden = internalViews(baseInternal.value);
  const headHidden = internalViews(headInternal.value);
  for (const delta of diffFacts(columnTable(base.value, baseHidden), columnTable(head.value, headHidden))) {
    const direction: DiffDirection = delta.kind === 'removed' ? 'narrowed' : 'widened';
    changes.push({
      axis: 'columns',
      direction,
      subject: delta.key,
      before: delta.before,
      after: delta.after,
      text: changeText('api_column', direction, { subject: delta.key }),
    });
  }
  for (const delta of diffFacts(maskedTable(base.value, baseHidden), maskedTable(head.value, headHidden))) {
    const direction = maskDirection(delta.kind, delta.before, delta.after);
    changes.push({
      axis: 'columns',
      direction,
      subject: delta.key,
      before: delta.before,
      after: delta.after,
      text: changeText('api_masked', direction, { subject: delta.key, before: delta.before, after: delta.after }),
    });
  }
  for (const delta of diffFacts(rpcTable(baseRpc.value), rpcTable(headRpc.value))) {
    const direction: DiffDirection = delta.kind === 'removed' ? 'narrowed' : 'widened';
    changes.push({
      axis: 'columns',
      direction,
      subject: delta.key,
      before: delta.before,
      after: delta.after,
      text: changeText('api_rpc', direction, { subject: delta.key }),
    });
  }
  return { changes, problems };
}
