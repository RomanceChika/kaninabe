/**
 * 軸「見える行」—— どの表の行を、どのロールが、どの範囲で読めるか。
 *
 * 元は RLS の期待表である。select ポリシーの名前は `{表}_select_{ロール}_{範囲}` の規約で
 * 付いているので、**名前の出入りがそのまま可視範囲の出入り**になる(設計メモ §1)。
 * 名前では表せない「条件そのものの差し替え」(`USING` の中身)は、その表のポリシーを全数
 * 生成した migration の在処が入れ替わることで出る —— migration は追記専用の歴史なので、
 * 条件が変われば必ず別のファイル名になる(C23)。
 *
 * **行の状態による絞り(`reads[].when`)だけは、在処ではなく宣言そのものを見る**(束 §14)。
 * 在処の入れ替えは「何かが変わった」までしか言えないが、可視性が状態で狭まったのか広がったのかは
 * レビューの主役(🔒 / 🔓)であり、1 行で言えなければ読む人がポリシーの SQL を読むことになる。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { diffFacts, factKey, FactBuilder, keyParts } from './facts.js';
import { changeText } from './messages.js';
import { asObject, asStrings, asString } from './plain.js';
import { problemsOf, readExport, unreadable } from './reader.js';
import { rlsExpectationsPath } from './sources.js';
import type { PlainValue } from './ts-literal.js';
import type { AxisInput, AxisResult, DiffDirection, SemanticChange } from './types.js';

/** 期待表の export 名(生成物が持つ綴り)。 */
const SELECT_EXPECTATIONS = 'rlsSelectExpectations';

/** 条件の在処の export 名。 */
const POLICY_MIGRATIONS = 'rlsPolicyMigrations';

/** 行の状態による絞りの export 名。 */
const POLICY_CONDITIONS = 'rlsPolicyConditions';

/** ポリシー名の由来(表・ロール・範囲)。名前の規約に合わなければロールと範囲は空になる。 */
interface PolicyName {
  readonly role: string;
  readonly scope: string;
}

/** `{表}_select_{ロール}_{範囲}` を割る(ロールに `_` が入るので範囲は末尾から取る)。 */
function splitPolicy(table: string, policy: string): PolicyName {
  const head = `${table}_`;
  if (!policy.startsWith(head)) return { role: '', scope: '' };
  const rest = policy.slice(head.length);
  const verb = rest.indexOf('_');
  if (verb === -1) return { role: '', scope: '' };
  const tail = rest.slice(verb + 1);
  const cut = tail.lastIndexOf('_');
  if (cut === -1) return { role: tail, scope: '' };
  return { role: tail.slice(0, cut), scope: tail.slice(cut + 1) };
}

/** 表 → ポリシー名の並び、を事実の表にする。 */
function policyTable(value: PlainValue | undefined): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  const tables = asObject(value);
  if (tables === undefined) return builder.table();
  for (const table of Object.keys(tables).sort()) {
    for (const policy of asStrings(tables[table])) builder.add(factKey(table, policy), policy);
  }
  return builder.table();
}

/** ポリシー名 → 行の状態による絞り、を事実の表にする。 */
function conditionTable(value: PlainValue | undefined): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  const policies = asObject(value);
  if (policies === undefined) return builder.table();
  for (const policy of Object.keys(policies).sort()) {
    const when = asString(policies[policy]);
    if (when !== undefined) builder.add(policy, when);
  }
  return builder.table();
}

/** 表 → 条件を生成した migration の在処、を事実の表にする。 */
function migrationTable(value: PlainValue | undefined): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  const tables = asObject(value);
  if (tables === undefined) return builder.table();
  for (const table of Object.keys(tables).sort()) {
    const file = asString(tables[table]);
    if (file !== undefined) builder.add(table, file);
  }
  return builder.table();
}

/**
 * 軸「見える行」の差分。
 *
 * @param input 2 版の写しと表示名の帳面
 * @returns 行と、読めなかったもの
 */
export function rowChanges(input: AxisInput): AxisResult {
  const basePolicies = readExport(input.base, 'base', rlsExpectationsPath(input.roots), SELECT_EXPECTATIONS);
  const headPolicies = readExport(input.head, 'head', rlsExpectationsPath(input.roots), SELECT_EXPECTATIONS);
  const baseFilters = readExport(input.base, 'base', rlsExpectationsPath(input.roots), POLICY_MIGRATIONS);
  const headFilters = readExport(input.head, 'head', rlsExpectationsPath(input.roots), POLICY_MIGRATIONS);
  const baseWhen = readExport(input.base, 'base', rlsExpectationsPath(input.roots), POLICY_CONDITIONS);
  const headWhen = readExport(input.head, 'head', rlsExpectationsPath(input.roots), POLICY_CONDITIONS);
  const problems = problemsOf(basePolicies, headPolicies, baseFilters, headFilters, baseWhen, headWhen);
  const changes: SemanticChange[] = [];
  // **片側が読めないなら差分を計算しない。** 空の表と比べると、読めた側の中身がまるごと
  // 「増えた」に化けて偽の 🔓 が並ぶ(独立レビューの止め 2)。
  if (unreadable(basePolicies, headPolicies, baseFilters, headFilters, baseWhen, headWhen)) {
    return { changes, problems };
  }
  for (const delta of diffFacts(policyTable(basePolicies.value), policyTable(headPolicies.value))) {
    const [table = '', policy = ''] = keyParts(delta.key);
    const parsed = splitPolicy(table, policy);
    const direction: DiffDirection = delta.kind === 'removed' ? 'narrowed' : 'widened';
    const roleLabel = input.labels.role(parsed.role);
    changes.push({
      axis: 'rows',
      direction,
      subject: table,
      before: delta.before,
      after: delta.after,
      text: changeText('rls_policy', direction, {
        subject: table,
        actor: parsed.role,
        ...(roleLabel === undefined ? {} : { actorLabel: roleLabel }),
        field: parsed.scope,
      }),
    });
  }
  // 状態による絞り。**足された = 狭まった(🔒)/ 消えた = 広がった(🔓)** で読む。
  for (const delta of diffFacts(conditionTable(baseWhen.value), conditionTable(headWhen.value))) {
    const direction: DiffDirection =
      delta.kind === 'added' ? 'narrowed' : delta.kind === 'removed' ? 'widened' : 'changed';
    changes.push({
      axis: 'rows',
      direction,
      subject: delta.key,
      before: delta.before,
      after: delta.after,
      text: changeText('rls_when', direction, {
        subject: delta.key,
        ...(delta.before === null ? {} : { before: delta.before }),
        ...(delta.after === null ? {} : { after: delta.after }),
      }),
    });
  }
  for (const delta of diffFacts(migrationTable(baseFilters.value), migrationTable(headFilters.value))) {
    if (delta.kind !== 'changed') continue;
    changes.push({
      axis: 'rows',
      direction: 'changed',
      subject: delta.key,
      before: delta.before,
      after: delta.after,
      text: changeText('rls_filter', 'changed', { subject: delta.key, before: delta.before, after: delta.after }),
    });
  }
  return { changes, problems };
}
