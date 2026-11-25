/**
 * T7 の**テナント境界の補助関数**の側(`kind: helper` + `actor_field:` + `migration:`)の検査。
 *
 * 境界(`reads[].filters`)の右辺 `actor.{欄}` の値は、実行者自身の行から security definer の補助関数
 * `public.actor_{欄}()` で読む(`lib/world/rls-boundary.ts`)。役の補助関数(`t7-rls-helpers.ts`)と同じく、
 * **宣言と生成物は両方向で一致しなければならない**。
 *
 * - **要求されるのに宣言が無い** → ポリシーが存在しない関数を呼ぶ SQL が出る(`missingBoundaryHelper`)。
 * - **宣言があるのに要求されない** → 本文は生成物という宣言なのに 1 本も出ない(`unrequiredBoundaryHelper`)。
 * - 関数名が欄から導かれる形でない・`migration` が無い・本文が組み立てられない(実行者の集約にその欄が無い)。
 *
 * 要求の母集合は**刈り込む前の計画**(`readPlans`)から取る —— 隠し列のマスクはポリシーの刈り込みを使わず、
 * 刈り込まれた規則の境界の述語もマスクの関数に入るからである(刈り込んだ計画だけを見ると、マスクが
 * 存在しない関数を呼ぶ)。連番の順(ポリシーより前)は `checkDeclaredHelpers` が役の補助関数と一緒に見る。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { boundaryHelperName } from '../../world/index.js';
import { buildBoundaryHelperMigration } from '../../sql/rls-migration.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import { t7Finding } from './t7-rls-helpers.js';

/**
 * その実行者の欄の境界の補助関数が宣言され、本文が組み立てられることを見る。
 *
 * @param domain ドメイン仕様
 * @param dataTables 全 data_table(補助関数はどの表に置かれていてもよい)
 * @param tableOf 集約名 → 物理テーブル名
 * @param field ポリシーが要求する実行者の欄
 * @param table 要求している側の表(反例と場所に使う)
 * @param platform プラットフォームの設定(本文を組み立てるのに使う)
 * @returns 違反のリスト
 */
export function checkBoundaryHelper(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  tableOf: (entity: string) => string | null,
  field: string,
  table: DataTableSpec,
  platform: PlatformProfile,
): Finding[] {
  const fn = dataTables.tables
    .flatMap((candidate) => candidate.functions)
    .find((candidate) => candidate.kind === 'helper' && candidate.actorField === field);
  if (fn === undefined) return [missingBoundaryHelper(field, table)];
  const findings: Finding[] = [];
  const expected = boundaryHelperName(field);
  if (fn.name !== expected) {
    findings.push(
      t7Finding({
        message: `境界の補助関数 ${fn.name} の名前が実行者の欄 ${field} から導かれる形(${expected})と一致しません`,
        location: { ...table.location, pointer: 'policies_migration' },
        suggestion: `関数名を ${expected} に直す(生成器は欄から名前を導くので、ずれると参照が外れる)`,
        counterexample: { actor_field: field, name: fn.name, expected },
      }),
    );
  }
  if (fn.migration === undefined) {
    findings.push(
      t7Finding({
        message: `境界の補助関数 ${fn.name} は actor_field を宣言していますが migration がありません`,
        location: { ...table.location, pointer: 'policies_migration' },
        suggestion: `migration: {14 桁}_helper_${expected}.sql を足す(actor_field を宣言する = 本文は生成物である、という宣言)`,
        counterexample: { actor_field: field, name: fn.name },
      }),
    );
  }
  const built = buildBoundaryHelperMigration({ field, domain, tableOf, specFiles: [], platform });
  if (!built.ok) {
    findings.push(
      ...built.problems.map((problem) =>
        t7Finding({
          message: problem.message,
          location: { ...table.location, pointer: 'policies_migration' },
          suggestion: problem.suggestion,
          counterexample: { ...problem.counterexample, table: table.table },
        }),
      ),
    );
  }
  return findings;
}

/**
 * 宣言された境界の補助関数の側から見た検査(どのポリシーも要求していない宣言)。
 *
 * @param dataTables 全 data_table
 * @param required ポリシー(とマスク)が実際に要求した実行者の欄
 * @returns 違反のリスト
 */
export function checkDeclaredBoundaryHelpers(dataTables: DataTableSpecModel, required: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  for (const table of dataTables.tables) {
    for (const fn of table.functions) {
      if (fn.kind !== 'helper' || fn.actorField === undefined || required.has(fn.actorField)) continue;
      findings.push(
        t7Finding({
          message: `境界の補助関数 ${fn.name}(実行者の欄 ${fn.actorField})を要求する境界がありません`,
          location: { ...table.location, pointer: `functions.${fn.name}.actor_field` },
          suggestion:
            `どこかの access_spec の reads に "filters: { {列}: actor.${fn.actorField} }" を宣言するか、` +
            `${fn.name} の行を削除する(actor_field を宣言すると「本文は生成物」という意味になるが、` +
            '要求が無ければ 1 本も生成されず、宣言だけが残る)',
          counterexample: { actor_field: fn.actorField, function: fn.name },
        }),
      );
    }
  }
  return findings;
}

/** 境界の補助関数の宣言が無い。 */
function missingBoundaryHelper(field: string, table: DataTableSpec): Finding {
  const name = boundaryHelperName(field);
  return t7Finding({
    message: `境界(actor.${field})が要求する補助関数 ${name} が宣言されていません`,
    location: { ...table.location, pointer: 'policies_migration' },
    suggestion:
      `実行者の集約の data_table の functions に "- name: ${name} / args: [] / kind: helper / ` +
      `actor_field: ${field} / migration: {14 桁}_helper_${name}.sql" を足す` +
      '(境界の値の正は実行者の行であり、ポリシーの中から実行者の集約を読むと再帰するため補助関数に逃がす)',
    counterexample: { actor_field: field, expected_function: name },
  });
}
