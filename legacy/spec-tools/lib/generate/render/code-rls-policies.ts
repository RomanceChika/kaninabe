/**
 * `access_spec` の `reads` → **RLS の SQL**(`supabase/migrations/**`)の生成器。
 *
 * ADR-0012 ⑤「RPC 本文と RLS の SQL を仕様から生成し、DB を権威にする」の第 4 束である。
 * 出すのは 2 種類。
 *
 * | 出力 | 宣言する場所 | 中身 |
 * |---|---|---|
 * | 表ごとの select ポリシー全数 | data_table の `policies_migration` | 権限・RLS の有効化・`create policy … using (…)` |
 * | ロールごとの RLS 補助関数 | 実行者の集約の data_table の `functions[].role` + `migration` | `public.is_{role}()`(security definer) |
 * | 境界の欄ごとの補助関数 | 実行者の集約の data_table の `functions[].actor_field` + `migration` | `public.actor_{欄}()`(security definer。実行者の行の値) |
 *
 * 束 ⑳-4a までは**名前だけ**が生成物だった(`code-rls-expectations`)。名前は
 * `..._within_company_id` と正しく付けながら `using (true)` と書いた手書きポリシーが、
 * 名前の突合を素通りする —— 本文まで生成物にして、実 DB と**意味で**突き合わせる
 * (`policy-parity`)ことでその穴を閉じる。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { DataTableSpec } from '../../model/data/types.js';
import type { SpecModel } from '../../model/types.js';
import { findAccessSpec, findEntitySpec } from '../../semantics/domain-lookup.js';
import {
  buildBoundaryHelperMigration,
  buildHelperMigration,
  buildPolicyMigration,
  type RlsSqlResult,
} from '../../sql/rls-migration.js';
import { boundaryHelperFields, helperRoles, policyPlans, readPlans } from '../../world/index.js';
import type { PolicyProblem } from '../../sql/rls-predicate.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import { preconditionFailure } from '../../kernel/generator-precondition.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { migrationPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';


/**
 * 全 data_table の RLS から migration を生成するジェネレーター。
 * 出力は表ごとの `policies_migration` と、補助関数ごとの `functions[].migration`(ファイル全体)。
 */
export const rlsPoliciesGenerator: DocGenerator = {
  id: 'code-rls-policies',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const tables = ctx.dataTables?.tables ?? [];
    if (tables.length === 0) return [];
    const tableOf = (entity: string): string | null =>
      tables.find((candidate) => candidate.entity === entity)?.table ?? null;
    const sections: GeneratedSection[] = [];
    const needed = new Set<string>();
    const neededFields = new Set<string>();
    for (const table of [...tables].sort((a, b) => a.table.localeCompare(b.table))) {
      const access = table.entity === undefined ? null : findAccessSpec(model, table.entity);
      if (access === null || table.policiesMigration === undefined) continue;
      const plans = policyPlans(access, table.table, model.roles.roles);
      for (const role of helperRoles(plans, model.roles.roles)) needed.add(role);
      // 境界の補助関数は刈り込む前の計画から要求を取る(隠し列のマスクも同じ述語を呼ぶ。T7 と同じ母集合)。
      for (const field of boundaryHelperFields(readPlans(access, table.table, model.roles.roles))) neededFields.add(field);
      sections.push({
        file: migrationPath(ctx.roots, `${table.policiesMigration}`),
        content: sqlOf(
          buildPolicyMigration({
            plans,
            entity: access.entity,
            table: table.table,
            domain: model,
            tableOf,
            roles: model.roles.roles,
            platform: ctx.platform,
            specFiles: specFilesOf(table, model),
          }),
          table,
        ),
        wholeFile: true,
      });
    }
    return [
      ...sections,
      ...helperSections(model, tables, tableOf, needed, ctx.roots, ctx.platform),
      ...boundaryHelperSections(model, tables, tableOf, { needed: neededFields, roots: ctx.roots, platform: ctx.platform }),
    ];
  },
};

/** 補助関数の migration(宣言された `role` が、ポリシーの要求と一致するものだけ)。 */
function helperSections(
  model: SpecModel,
  tables: readonly DataTableSpec[],
  tableOf: (entity: string) => string | null,
  needed: ReadonlySet<string>,
  roots: ProductRoots,
  platform: PlatformProfile,
): GeneratedSection[] {
  const sections: GeneratedSection[] = [];
  for (const table of [...tables].sort((a, b) => a.table.localeCompare(b.table))) {
    for (const fn of table.functions) {
      if (fn.kind !== 'helper' || fn.role === undefined || fn.migration === undefined) continue;
      if (!needed.has(fn.role)) continue;
      const role = model.roles.roles.find((candidate) => candidate.id === fn.role);
      if (role === undefined) continue;
      sections.push({
        file: migrationPath(roots, `${fn.migration}`),
        content: sqlOf(
          buildHelperMigration({
            role,
            domain: model,
            tableOf,
            specFiles: [model.roles.location.file, table.location.file],
            platform,
          }),
          table,
        ),
        wholeFile: true,
      });
    }
  }
  return sections;
}

/** 境界の補助関数の migration を書き出すのに要る文脈。 */
interface BoundaryHelperContext {
  /** 境界が要求する実行者の欄。 */
  readonly needed: ReadonlySet<string>;
  readonly roots: ProductRoots;
  readonly platform: PlatformProfile;
}

/** 境界の補助関数の migration(宣言された `actor_field` が、境界の要求と一致するものだけ)。 */
function boundaryHelperSections(
  model: SpecModel,
  tables: readonly DataTableSpec[],
  tableOf: (entity: string) => string | null,
  context: BoundaryHelperContext,
): GeneratedSection[] {
  const sections: GeneratedSection[] = [];
  for (const table of [...tables].sort((a, b) => a.table.localeCompare(b.table))) {
    for (const fn of table.functions) {
      if (fn.kind !== 'helper' || fn.actorField === undefined || fn.migration === undefined) continue;
      if (!context.needed.has(fn.actorField)) continue;
      sections.push({
        file: migrationPath(context.roots, `${fn.migration}`),
        content: sqlOf(
          buildBoundaryHelperMigration({
            field: fn.actorField,
            domain: model,
            tableOf,
            specFiles: [table.location.file],
            platform: context.platform,
          }),
          table,
        ),
        wholeFile: true,
      });
    }
  }
  return sections;
}

/** 組み立てた SQL(前提が破れていたら T7 を示して止める)。 */
function sqlOf(result: RlsSqlResult, table: DataTableSpec): string {
  return result.ok ? result.sql : stop(table, result.problems);
}

/** その SQL の正になる仕様ファイル(表・エンティティ・アクセス・ロール)。 */
function specFilesOf(table: DataTableSpec, model: SpecModel): readonly string[] {
  const entity = findEntitySpec(model, table.entity ?? '');
  const access = table.entity === undefined ? null : findAccessSpec(model, table.entity);
  return [
    ...(access === null ? [] : [access.location.file]),
    ...(entity === null ? [] : [entity.location.file]),
    model.roles.location.file,
    table.location.file,
  ];
}

/**
 * 生成を中止する(**その前提を先に見るべき検査器**の ID を示して Finding の形で止める)。
 *
 * RLS の SQL が組み立てられないのは「スコープとロールの根拠が食い違っている」「境界の列が無い」
 * ということであり、それを先に見るのは T7 である(scripts-code-quality.md)。
 */
function stop(table: DataTableSpec, problems: readonly PolicyProblem[]): never {
  return preconditionFailure(
    'T7',
    problems.map((problem) => ({
      message: problem.message,
      suggestion: problem.suggestion,
      counterexample: problem.counterexample,
      location: { file: table.location.file, pointer: 'policies_migration' },
    })),
  );
}
