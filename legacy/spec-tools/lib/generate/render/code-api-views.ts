/**
 * entity_spec(列)+ access_spec(`fields_hidden` / `reads`)→ **外から届く surface の SQL**
 * (`supabase/migrations/**`)の生成器。
 *
 * | 出力 | 宣言する場所 | 中身 |
 * |---|---|---|
 * | 表ごとのビュー 1 枚 | data_table の `surface_migration` | 隠し列の述語・`create view … with (security_invoker = true)`・権限 |
 * | ビューの一覧 | surface_spec の `surface-views` マーカー | **可視性で 2 つに分けた表**(surface に出るビュー: 表・元の集約・列数・隠し列 / 内部のビュー: 表・列数)。**仕様書に書き写さないための生成物**である |
 *
 * **仕組みが自分で持つ表**(`framework:` を宣言する内部テーブル)の surface も同じ 1 本で出す ——
 * 列の正が entity_spec ではなく設計図(`framework-tables.ts`)にあるだけで、ビューの形は
 * 「列を宣言順に全部並べる」で変わらない。違うのは権限の 1 ビット(surface のロールに何も与えない)
 * であり、その宛先の正は `api-acl.ts` が両側に配っている。
 *
 * surface の形は宣言だけで決まりきっている —— 列と並びは entity_spec、隠す列は `fields_hidden`、
 * マスクを解く条件は `from` の外側で行を読めるロールの述語である。それでも SQL だけが手書き
 * だったので、**集約に列を 1 つ足すたび人がビューを作り直す migration を書いていた**
 * (2 例が歴史に残っている)。突合(`api-parity`)が見ていたのは列の名前の集合までなので、
 * `CASE` を落として素の列を並べても緑になる状態だった。
 *
 * 導出の表と「導けないもの」の線引きは docs/design/api-views-generation.md §1。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { DataTableSpec } from '../../model/data/types.js';
import type { SpecModel } from '../../model/types.js';
import { findAccessSpec, findEntitySpec } from '../../semantics/domain-lookup.js';
import { buildApiViewMigration } from '../../sql/api-migration.js';
import { apiViewPlan, frameworkApiViewPlan, type ApiViewPlan } from '../../sql/api-views.js';
import { frameworkTableColumnNames, isFrameworkTable } from '../../sql/framework-tables.js';
import type { PolicyProblem } from '../../sql/rls-predicate.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import { endUserRoles, privilegedRole, surfaceUnsupportedReason } from '../../sql/platform-sql.js';
import { preconditionFailure } from '../../kernel/generator-precondition.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { migrationPath, specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';


/** surface の仕様書(一覧の差し込み先)。 */
function surfaceSpecFile(roots: ProductRoots): string {
  return specPath(roots, 'backend/surface.md');
}

/**
 * 仕組みが自分で持つ表の列の正(生成 SQL のヘッダが示すファイル)の**凍結したラベル**。パスではない。
 *
 * 適用済み migration のヘッダに入っているため綴りを凍結している(1 バイト変われば再発行 = 新番号。
 * ddl-reissue-free-changes.md §1)。次にこの表の本文が本当に変わる日(再発行の日)に、
 * パッケージ相対の綴り(`lib/sql/framework-tables.ts`)へ直す。
 */
const BLUEPRINT_FILE_LABEL = 'docs/scripts/lib/sql/framework-tables.ts';

/**
 * surface に出るビューの表の前に出す 1 行(誰が読めるか)。
 *
 * @param platform プラットフォームの設定(surface のロールの DB 上の名前)
 */
function surfacedLead(platform: PlatformProfile): string {
  return (
    '**`surface` に出るビュー**(entity_spec と access_spec の両方を持つ表)。' +
    `\`surface\` のロール(${endUserRoles(platform).map((role) => `\`${role}\``).join(' / ')})が \`select\` で読み、隠し列は述語が解けたときだけ値を返す。`
  );
}

/**
 * 内部のビューの表の前に出す 1 行(**読めないこと**が性質である)。
 *
 * @param platform プラットフォームの設定(内部実行のロールの DB 上の名前)
 */
function internalLead(platform: PlatformProfile): string {
  return (
    '**内部のビュー**(`framework:` の設計図が列の正を持つ内部テーブル)。' +
    '**`surface` のロールには 1 つも権限を与えない** —— 外の口からは完全に消え、' +
    `特権のある接続(\`${privilegedRole(platform)}\`)が読み書きする経路のためだけに置く。` +
    '列は設計図から導けるので生成物である(隠し列は無い —— 隠す相手がいない)。'
  );
}

/**
 * surface に出る表ごとにビューの migration を生成するジェネレーター。
 * 出力は宣言された `surface_migration`(ファイル全体)である。
 *
 * **後段が SQL の公開面を API として外へ出す能力を持たない構成(`surfaceExposure: unsupported`)では何も出さない**
 * (未対応の報告は生成の入口 `cli/generate-docs.ts` が言う。黙って緑にしない)。
 */
export const apiViewsGenerator: DocGenerator = {
  id: 'code-api-views',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    if (surfaceUnsupportedReason(ctx.platform) !== null) return [];
    const tables = ctx.dataTables?.tables ?? [];
    if (tables.length === 0) return [];
    const tableOf = (entity: string): string | null =>
      tables.find((candidate) => candidate.entity === entity)?.table ?? null;
    const sections: GeneratedSection[] = [];
    const surfaced: string[][] = [];
    const internal: string[][] = [];
    for (const table of [...tables].sort((a, b) => a.table.localeCompare(b.table))) {
      if (table.surfaceMigration === undefined) continue;
      const built = planOf(table, model, tableOf, ctx.platform);
      if (built === null) continue;
      // **可視性で分ける。** surface のロールが読めるビューと、外から 1 行も読めないビューを同じ表に
      // 並べると「surface に出る一覧」が事実でなくなる(独立レビュー 2026-09-23)。分岐の 1 ビットは
      // 生成 SQL の `grant` と同じ `internal` である。
      (table.internal ? internal : surfaced).push(
        table.internal
          ? [cell(`\`${table.table}\``), cell(String(built.plan.columns.length)), cell(`\`${table.surfaceMigration}\``)]
          : [
              cell(`\`${table.table}\``),
              cell(built.plan.entity ?? ''),
              cell(String(built.plan.columns.length)),
              cell(built.plan.masks.map((mask) => mask.column).join(', ')),
              cell(`\`${table.surfaceMigration}\``),
            ],
      );
      sections.push({
        file: migrationPath(ctx.roots, `${table.surfaceMigration}`),
        content: buildApiViewMigration({
          plan: built.plan,
          internal: table.internal,
          specFiles: built.specFiles,
          platform: ctx.platform,
        }),
        wholeFile: true,
      });
    }
    if (ctx.surface?.spec === undefined || ctx.surface.spec === null) return sections;
    return [
      ...sections,
      { file: surfaceSpecFile(ctx.roots), marker: 'surface-views', content: viewTables(surfaced, internal, ctx.platform) },
    ];
  },
};

/**
 * 一覧の本文(可視性で分けた 2 つの表)。
 *
 * 内部のビューが 1 枚も無いリポジトリでは 2 つめの節を出さない —— 空の見出しを置くと
 * 「まだ無い」と「そういう構成である」が読み分けられない。
 *
 * @param surfaced surface に出るビューの行
 * @param internal 内部のビューの行
 * @param platform プラットフォームの設定(文面に出るロール名)
 * @returns Markdown(マーカーの中身)
 */
function viewTables(surfaced: readonly string[][], internal: readonly string[][], platform: PlatformProfile): string {
  const blocks = [
    surfacedLead(platform),
    markdownTable(['表(= ビュー名)', '集約', '列数', '隠し列', '書き出し先'], surfaced),
  ];
  if (internal.length > 0) {
    blocks.push(internalLead(platform), markdownTable(['表(= ビュー名)', '列数', '書き出し先'], internal));
  }
  return blocks.join('\n\n');
}

/** ビュー 1 枚の計画と、その SQL の正になる仕様ファイル。 */
interface PlannedView {
  readonly plan: ApiViewPlan;
  readonly specFiles: readonly string[];
}

/**
 * その表の surface の計画を組み立てる(ドメインの表と仕組みが自分で持つ表の**唯一の入口**)。
 *
 * どちらでもない表(entity_spec も設計図も無いのに宣言だけある)は null —— 宣言できないことは
 * T12 が先に見ている。
 *
 * @param table その表の data_table
 * @param model ドメイン仕様
 * @param tableOf 集約名 → 物理テーブル名
 * @param platform プラットフォームの設定
 * @returns 計画と正の所在。どちらの道でも組み立てられなければ null
 */
function planOf(
  table: DataTableSpec,
  model: SpecModel,
  tableOf: (entity: string) => string | null,
  platform: PlatformProfile,
): PlannedView | null {
  if (table.framework !== undefined && isFrameworkTable(table.framework)) {
    return {
      plan: frameworkApiViewPlan(table.table, frameworkTableColumnNames(table.framework)),
      specFiles: [BLUEPRINT_FILE_LABEL, table.location.file],
    };
  }
  if (table.entity === undefined) return null;
  const access = findAccessSpec(model, table.entity);
  const entity = findEntitySpec(model, table.entity);
  if (access === null || entity === null) return null;
  const plan = apiViewPlan({
    access,
    entity,
    table: table.table,
    domain: model,
    tableOf,
    roles: model.roles.roles,
    platform,
  });
  if (!plan.ok) stop(table, plan.problems);
  return {
    plan: plan.plan,
    specFiles: [access.location.file, entity.location.file, model.roles.location.file, table.location.file],
  };
}

/**
 * 生成を中止する(**その前提を先に見るべき検査器**の ID を示して Finding の形で止める)。
 *
 * surface の述語が組み立てられないのは「スコープとロールの根拠が食い違っている」「境界の列が無い」
 * ということであり、それを先に見るのは T7 である(RLS のポリシーと同じ翻訳器を使っている
 * 以上、同じ前提に寄りかかっている)。
 */
function stop(table: DataTableSpec, problems: readonly PolicyProblem[]): never {
  return preconditionFailure(
    'T7',
    problems.map((problem) => ({
      message: problem.message,
      suggestion: problem.suggestion,
      counterexample: problem.counterexample,
      location: { file: table.location.file, pointer: 'surface_migration' },
    })),
  );
}
