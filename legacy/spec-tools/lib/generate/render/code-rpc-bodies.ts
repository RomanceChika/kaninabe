/**
 * data_table の `functions[].migration` → **定型 RPC の本文**(`supabase/migrations/{migration}`)の生成器。
 *
 * ADR-0012 ⑤「RPC 本文と RLS の SQL を仕様から生成し、DB を権威にする」の第 2 束である。
 * 5 形のうち composite 以外の 4 つは本文まで宣言から決まるので、複合 RPC(code-usecase-rpc)と
 * 同じ流儀で**生成物そのものが正**になる —— 突合(rpc-parity)は「生成物どおりの本文が
 * 当たっているか」の 1 つだけで済み、断片ごとの目が要らなくなる。
 *
 * 追記専用の歴史との両立は `saves[].migration` と同じで、**書き出す先のファイル名を仕様に
 * 宣言させ、SQL が変わる変更では名前を新しくする**(T6 が形式と一意性を見る)。
 * 定型なのに本文が生成できないものは `handwritten` に理由を書く(T6 がどちらか一方を要求する)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { DataFunctionDecl, DataTableSpec } from '../../model/data/types.js';
import type { SpecModel } from '../../model/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import { findAccessSpec, findEntitySpec } from '../../semantics/domain-lookup.js';
import { buildRpcBody } from '../../sql/rpc-body.js';
import { endSessionsWiringOf } from '../../sql/rpc-end-sessions.js';
import type { JobCatalogSpec } from '../../model/job/types.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import type { RpcBodyProblem } from '../../sql/rpc-params.js';
import { preconditionFailure } from '../../kernel/generator-precondition.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { migrationPath } from '../../model/product/paths.js';


/** 本文を生成する形(composite は定型に乗らないので生成しない)。 */
const GENERATED_SHAPES = ['create', 'update', 'delete', 'transition'] as const;

/** 本文を生成する形。 */
type GeneratedShape = (typeof GENERATED_SHAPES)[number];

/**
 * 全 data_table の定型 RPC から migration を生成するジェネレーター。
 * 出力は関数ごとに `supabase/migrations/{functions[].migration}`(ファイル全体)。
 */
export const rpcBodiesGenerator: DocGenerator = {
  id: 'code-rpc-bodies',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const tables = ctx.dataTables?.tables ?? [];
    if (tables.length === 0) return [];
    const sections: GeneratedSection[] = [];
    for (const table of [...tables].sort((a, b) => a.table.localeCompare(b.table))) {
      for (const fn of table.functions) {
        const shape = generatedShapeOf(fn);
        if (shape === null || fn.migration === undefined) continue;
        sections.push({
          file: migrationPath(ctx.roots, `${fn.migration}`),
          content: render(fn, shape, table, model, tables, ctx.actions, ctx.platform, ctx.jobs?.catalog ?? null),
          wholeFile: true,
        });
      }
    }
    return sections;
  },
};

/** その関数が本文を生成する形か(`kind: rpc` かつ定型)。 */
function generatedShapeOf(fn: DataFunctionDecl): GeneratedShape | null {
  if (fn.kind !== 'rpc' || fn.shape === undefined) return null;
  return (GENERATED_SHAPES as readonly string[]).includes(fn.shape) ? (fn.shape as GeneratedShape) : null;
}

/** 関数 1 本の migration を組み立てる(前提が破れていたら T6 を示して止める)。 */
function render(
  fn: DataFunctionDecl,
  shape: GeneratedShape,
  table: DataTableSpec,
  model: SpecModel,
  tables: readonly DataTableSpec[],
  actions: ActionSpecModel | undefined,
  platform: PlatformProfile,
  jobs: JobCatalogSpec | null,
): string {
  const entity = findEntitySpec(model, table.entity ?? '');
  const endSessions = shape === 'transition' ? endSessionsWiringOf(fn.name, table.entity ?? '', model, jobs, platform.exposedSchema) : undefined;
  const result = buildRpcBody({
    name: fn.name,
    params: fn.params,
    args: fn.args,
    shape,
    table,
    domain: model,
    tableOf: (name) => tables.find((candidate) => candidate.entity === name)?.table ?? null,
    actions,
    tables,
    specFiles: specFilesOf(table, model),
    entityLabel: entity?.label ?? table.entity ?? table.table,
    platform,
    ...(endSessions === undefined ? {} : { endSessions }),
  });
  if (result.ok) return result.sql;
  return stop(fn, table, result.problems);
}

/** その本文の正になる仕様ファイル(表・エンティティ・アクセス)。 */
function specFilesOf(table: DataTableSpec, model: SpecModel): readonly string[] {
  const entity = findEntitySpec(model, table.entity ?? '');
  const access = table.entity === undefined ? null : findAccessSpec(model, table.entity);
  return [
    table.location.file,
    ...(entity === null ? [] : [entity.location.file]),
    ...(access === null ? [] : [access.location.file]),
  ];
}

/**
 * 生成を中止する(**その前提を先に見るべき検査器**の ID を示して Finding の形で止める)。
 *
 * 定型 RPC の本文が組み立てられないのは「定型に乗らない関数に定型の印が付いている」
 * ということであり、それを先に見るのは T6 である(scripts-code-quality.md)。
 */
function stop(fn: DataFunctionDecl, table: DataTableSpec, problems: readonly RpcBodyProblem[]): never {
  return preconditionFailure(
    'T6',
    problems.map((problem) => ({
      message: problem.message,
      suggestion: problem.suggestion,
      counterexample: problem.counterexample,
      location: { file: table.location.file, pointer: `functions.${fn.name}` },
    })),
  );
}
