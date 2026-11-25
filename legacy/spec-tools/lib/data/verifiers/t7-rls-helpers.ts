/**
 * T7 の**RLS 補助関数**の側(`kind: helper` + `role:` + `migration:`)の検査。
 *
 * このファイルの責務は**補助関数側**の判定(宣言と生成物の両方向の一致)で、ポリシー側の判定
 * (`t7-policies-migration.ts`)から読まれる葉である(ここはポリシー側を読まない)。T7 の Finding の
 * 型付けと連番の読み取りもここが持つ(両側が使う)。
 *
 * ## 宣言と生成物は**両方向**で一致しなければならない
 *
 * 補助関数は「グローバルに立つロール(`kind` / `claim`)の根拠」をポリシーの外へ逃がすための
 * ものであり、**ポリシーが要求するロールの集合**が生成される関数の全数を決める。だから宣言は
 * 過不足なく対応していなければならない。
 *
 * - **要求されるのに宣言が無い** → ポリシーが存在しない関数を呼ぶ SQL が出る(`missingHelper`)。
 * - **宣言があるのに要求されない** → `role:` を宣言したのに生成物が 1 本も出ない。宣言だけが
 *   残り、次の人は「この関数は生成物である」と読むのに DB には無い(`unrequiredHelper`)。
 * - **`migration:` を宣言するのに `role:` も `actor_field:` も無い** → 同じく生成物が出ない。生成しない補助関数は
 *   どちらも宣言しなければよく、そのとき `migration` も要らない(`helperWithoutRole`)。
 *
 * テナント境界の補助関数(`actor_field:`)の要求との対応は `t7-boundary-helpers.ts` が持つ
 * (連番の順 = ポリシーより前、はここで役の補助関数と一緒に見る)。
 *
 * 片方向だけを見る検査は「宣言したのに生成されない」を通してしまう —— A15(操作の宣言と導出)が
 * 両方向を見るのと同じ理由である。
 */

import type { Finding } from '../../kernel/finding.js';
import type { RoleDef, SpecModel } from '../../model/types.js';
import { helperName } from '../../world/index.js';
import { buildHelperMigration } from '../../sql/rls-migration.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import { MIGRATION_SEQUENCE } from './migration-sequence.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T7';

/** T7 の指摘を組み立てる(ポリシー側・補助関数側の両方が使う)。 */
export function t7Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * migration 名の先頭 14 桁を数にする(形式が違えば 0)。
 *
 * @param migration migration のファイル名
 * @returns 連番。形式が違えば 0
 */
export function sequenceOf(migration: string): number {
  const head = migration.slice(0, 14);
  return MIGRATION_SEQUENCE.test(head) ? Number(head) : 0;
}

/**
 * そのロールの補助関数が宣言され、本文が組み立てられることを見る。
 *
 * @param domain ドメイン仕様
 * @param dataTables 全 data_table(補助関数はどの表に置かれていてもよい)
 * @param tableOf 集約名 → 物理テーブル名
 * @param role ポリシーが要求するロール
 * @param table 要求している側の表(反例と場所に使う)
 * @param platform プラットフォームの設定(補助関数の本文を組み立てるのに使う)
 * @returns 違反のリスト
 */
export function checkHelper(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  tableOf: (entity: string) => string | null,
  role: string,
  table: DataTableSpec,
  platform: PlatformProfile,
): Finding[] {
  const declared = dataTables.tables.flatMap((candidate) =>
    candidate.functions.filter((fn) => fn.kind === 'helper' && fn.role === role),
  );
  const fn = declared[0];
  if (fn === undefined) return [missingHelper(role, table)];
  const findings: Finding[] = [];
  if (fn.name !== helperName(role)) findings.push(misnamedHelper(role, fn.name, table));
  if (fn.migration === undefined) findings.push(helperWithoutMigration(role, fn.name, table));
  const definition = domain.roles.roles.find((candidate) => candidate.id === role);
  if (definition !== undefined) findings.push(...checkHelperBody(domain, tableOf, definition, table, platform));
  return findings;
}

/** 補助関数の本文が組み立てられることを見る(生成器が報告する前提)。 */
function checkHelperBody(
  domain: SpecModel,
  tableOf: (entity: string) => string | null,
  role: RoleDef,
  table: DataTableSpec,
  platform: PlatformProfile,
): Finding[] {
  const built = buildHelperMigration({ role, domain, tableOf, specFiles: [], platform });
  if (built.ok) return [];
  return built.problems.map((problem) =>
    t7Finding({
      message: problem.message,
      location: { ...domain.roles.location, pointer: `roles.${role.id}` },
      suggestion: problem.suggestion,
      counterexample: { ...problem.counterexample, table: table.table },
    }),
  );
}

/** 補助関数の宣言が無い。 */
function missingHelper(role: string, table: DataTableSpec): Finding {
  return t7Finding({
    message: `ポリシーが要求する RLS 補助関数(ロール ${role})が宣言されていません`,
    location: { ...table.location, pointer: 'policies_migration' },
    suggestion:
      `実行者の集約の data_table の functions に "- name: ${helperName(role)} / args: [] / kind: helper / ` +
      `role: ${role} / migration: {14 桁}_helper_${helperName(role)}.sql" を足す` +
      '(グローバルに立つロールの根拠は、ポリシーの中から実行者の集約を読むと再帰するため補助関数に逃がす)',
    counterexample: { role, expected_function: helperName(role) },
  });
}

/** 補助関数の名前がロールから導かれる形でない。 */
function misnamedHelper(role: string, name: string, table: DataTableSpec): Finding {
  return t7Finding({
    message: `RLS 補助関数 ${name} の名前がロール ${role} から導かれる形(${helperName(role)})と一致しません`,
    location: { ...table.location, pointer: 'policies_migration' },
    suggestion: `関数名を ${helperName(role)} に直す(生成器はロールから名前を導くので、ずれると参照が外れる)`,
    counterexample: { role, name, expected: helperName(role) },
  });
}

/** 補助関数が `role` を宣言しているのに生成先が無い。 */
function helperWithoutMigration(role: string, name: string, table: DataTableSpec): Finding {
  return t7Finding({
    message: `RLS 補助関数 ${name} は role を宣言していますが migration がありません`,
    location: { ...table.location, pointer: 'policies_migration' },
    suggestion: `migration: {14 桁}_helper_${name}.sql を足す(role を宣言する = 本文は生成物である、という宣言)`,
    counterexample: { role, name },
  });
}

/**
 * 宣言された補助関数の側から見た検査(要求との対応・連番の順)。
 *
 * @param dataTables 全 data_table
 * @param policySequences 全ポリシーの連番
 * @param required ポリシーが実際に要求したロールの集合
 * @returns 違反のリスト
 */
export function checkDeclaredHelpers(
  dataTables: DataTableSpecModel,
  policySequences: readonly number[],
  required: ReadonlySet<string>,
): Finding[] {
  const earliest = policySequences.length === 0 ? null : Math.min(...policySequences);
  const findings: Finding[] = [];
  for (const table of dataTables.tables) {
    for (const fn of table.functions) {
      if (fn.kind !== 'helper') continue;
      // 境界の補助関数(`actor_field`)の要求との対応は `t7-boundary-helpers.ts` が見る。連番の順はここで両方を見る。
      if (fn.role === undefined && fn.actorField === undefined) {
        if (fn.migration !== undefined) findings.push(helperWithoutRole(fn.name, table));
        continue;
      }
      if (fn.role !== undefined && !required.has(fn.role)) findings.push(unrequiredHelper(fn.role, fn.name, table));
      if (fn.migration === undefined || earliest === null) continue;
      const sequence = sequenceOf(fn.migration);
      if (sequence === 0 || sequence >= earliest) findings.push(lateHelper(fn.name, fn.migration, earliest, table));
    }
  }
  return findings;
}

/** 生成先だけを宣言して、どのロールを判定するかを宣言していない。 */
function helperWithoutRole(name: string, table: DataTableSpec): Finding {
  return t7Finding({
    message: `RLS 補助関数 ${name} は migration を宣言していますが role も actor_field もありません`,
    location: { ...table.location, pointer: `functions.${name}.migration` },
    suggestion:
      'role: {ロール ID}(役の判定)か actor_field: {実行者の欄}(テナント境界の値)を足す' +
      '(本文はその宣言から生成されるので、どちらも無いと 1 行も出ない)。' +
      '生成しない補助関数なら migration の行を削除する(どちらも宣言しない補助関数は生成の対象外)',
    counterexample: { function: name },
  });
}

/** `role` を宣言しているが、どのポリシーもその根拠を要求していない。 */
function unrequiredHelper(role: string, name: string, table: DataTableSpec): Finding {
  return t7Finding({
    message: `RLS 補助関数 ${name}(ロール ${role})を要求するポリシーがありません`,
    location: { ...table.location, pointer: `functions.${name}.role` },
    suggestion:
      `どこかの access_spec の reads に ${role} を宣言する(グローバルに立つロールの読み取りを足す)か、` +
      `${name} の role / migration の行を削除する(role を宣言すると「本文は生成物」という意味になるが、` +
      '要求が無ければ 1 本も生成されず、宣言だけが残る)',
    counterexample: { role, function: name },
  });
}

/** 補助関数の連番がポリシーより後にある。 */
function lateHelper(name: string, migration: string, earliest: number, table: DataTableSpec): Finding {
  return t7Finding({
    message: `RLS 補助関数 ${name} の migration の連番がポリシーより後です`,
    location: { ...table.location, pointer: `functions.${name}.migration` },
    suggestion:
      'ポリシーが補助関数を参照するので、関数を作る migration の連番を全ポリシーより前にする' +
      '(DB を最初から作り直すときに、関数が無い状態でポリシーを作ろうとして落ちる)',
    counterexample: { function: name, migration, earliest_policy: String(earliest) },
  });
}
