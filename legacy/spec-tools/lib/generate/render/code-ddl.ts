/**
 * data_table + entity_spec → **表の DDL**(`supabase/migrations/**`)と**期待表**の生成器。
 *
 * ADR-0012「DB を権威にする」の続きであり、出すのは 2 種類。
 *
 * | 出力 | 宣言する場所 | 中身 |
 * |---|---|---|
 * | 表ごとの DDL | data_table の `ddl_migration` | 冪等な `create table` / `add column` / CHECK / FK / 索引 / 排他 / RLS / `comment on` |
 * | 期待表 | —(全体生成) | `app/src/domain/generated/ddl-expectations.ts`(ddl-parity の入力) |
 *
 * 母集合は entity を持つ表(列の正は entity_spec)と、**仕組みが自分で持つ表**(`framework:` が
 * 名指す `lib/sql/framework-tables.ts` の設計図が正)の両方である。
 *
 * 束 ⑳-4a までは、表の形(列・型・NOT NULL・主キー・導出 CHECK・既定値・`comment on`)に
 * **どちらの向きの突合も無かった** —— 310 列が手で書き写され、宣言に無い導出 CHECK が
 * 約 100 本あった。字面を生成物にし、実 DB と**両方向**で突き合わせることでその穴を閉じる。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { DataTableSpec } from '../../model/data/types.js';
import type { SpecModel } from '../../model/types.js';
import { buildDdlMigration } from '../../sql/ddl-migration.js';
import type { TableDdlPlan } from '../../sql/ddl-plan.js';
import { ddlPlanOf } from '../../sql/framework-tables.js';
import { preconditionFailure } from '../../kernel/generator-precondition.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';
import { migrationPath } from '../../model/product/paths.js';


/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'ddl-expectations.ts');

/**
 * 全 data_table から表の DDL と期待表を生成するジェネレーター。
 * 出力は表ごとの `ddl_migration`(ファイル全体)と `ddl-expectations.ts`(全体生成)。
 */
export const ddlGenerator: DocGenerator = {
  id: 'code-ddl',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const tables = ctx.dataTables?.tables ?? [];
    if (tables.length === 0) return [];
    const planned: { readonly table: DataTableSpec; readonly plan: TableDdlPlan }[] = [];
    for (const table of [...tables].sort((a, b) => a.table.localeCompare(b.table))) {
      if (table.ddlMigration === undefined) continue;
      planned.push({ table, plan: planOf(table, model, tables) });
    }
    if (planned.length === 0) return [];
    return [
      ...planned.map(({ table, plan }) => ({
        file: migrationPath(ctx.roots, `${table.ddlMigration ?? ''}`),
        content: buildDdlMigration(plan),
        wholeFile: true,
      })),
      { file: outputFile(ctx.roots), content: renderFile(planned.map(({ plan }) => plan)), wholeFile: true },
    ];
  },
};

/**
 * その表の計画(前提が破れていたら T12 を示して止める)。
 *
 * DDL を組み立てられないのは「`ddl_migration` を宣言した表の列の正(entity_spec または
 * 設計図)が引けない」ということであり、それを先に見るのは T12 である(scripts-code-quality.md)。
 */
function planOf(table: DataTableSpec, model: SpecModel, tables: readonly DataTableSpec[]): TableDdlPlan {
  const plan = ddlPlanOf(table, model, tables);
  if (plan !== null) return plan;
  return preconditionFailure('T12', [
    {
      message: `${table.table} の DDL を組み立てられません(列の正が引けません)`,
      suggestion:
        'ddl_migration を宣言できるのは entity を持つ表と、設計図を宣言する framework 表だけである' +
        '(列・型の正が無いと形を導けない)。entity / framework の綴りを確かめるか、宣言を外す',
      counterexample: { table: table.table, entity: table.entity ?? table.framework ?? '' },
      location: { file: table.location.file, pointer: 'ddl_migration' },
    },
  ]);
}

/** 1 表分の計画を、突合テストが読むリテラルに写す(SQL の字面は持ち込まない)。 */
function tableLiteral(plan: TableDdlPlan): LiteralValue {
  return {
    primaryKey: [...plan.primaryKey],
    sequences: plan.sequences.map((sequence) => ({
      name: sequence.name,
      start: sequence.start,
    })),
    columns: plan.columns.map((column) => ({
      name: column.name,
      type: column.type,
      notNull: column.notNull,
      default: column.default,
      identity: column.identity,
      comment: column.comment,
    })),
    checks: [...plan.derivedChecks, ...plan.declaredChecks].map((check) => ({
      name: check.name,
      expression: check.expression,
      comment: check.invariant,
    })),
  };
}

/** 期待表のファイル全体を組み立てる。 */
function renderFile(planned: readonly TableDdlPlan[]): string {
  const byTable: Record<string, LiteralValue> = {};
  for (const plan of planned) byTable[plan.table] = tableLiteral(plan);
  return [
    // 設計図(`framework-tables.ts`)は 2 表の正なので、そのままでは同じ行が 2 度出る。
    generatedHeader([...new Set(planned.flatMap((plan) => plan.specFiles))]),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      '期待列 1 本(名前・型・NULL 可否・既定値・採番・説明)。',
      '',
      '型は pg_catalog の型名、既定値は `pg_get_expr` の出力に合わせた字面であり、',
      '突合は空白を詰めた文字列一致である(`defaults` の突合と同じ流儀)。',
      '`identity` は DB が採番する列(`generated always as identity`)かどうかで、`pg_attribute` の',
      '`attidentity` と突き合わせる —— 既定値でも `auto` でも書けない供給の機構なので、これを見ないと',
      '「宣言では採番、実 DB では NOT NULL の空欄」という食い違いが素通りする。',
      '`comment` は entity_spec の `description` の写しで、`null` は「説明が無い」を意味する。',
    ]),
    'export interface ExpectedColumn {',
    '  readonly name: string;',
    '  readonly type: string;',
    '  readonly notNull: boolean;',
    '  readonly default: string | null;',
    '  readonly identity: boolean;',
    '  readonly comment: string | null;',
    '}',
    '',
    docComment([
      '期待 CHECK 1 本。',
      '',
      '`expression` は `pg_get_constraintdef` が `CHECK (…)` の内側に印字する字面である。',
      '`null` は「宣言にあるのは制約の名前で、式の正は仕様に無い」もの(data_table の `checks[]` の',
      'うち `rule` を持たないもの)を意味し、その場合は実在だけを見る。',
      '',
      '`comment` は `checks[].invariant`(由来の不変条件 ID)。宣言があれば `comment on constraint`',
      'が実在することまで突合する —— 「制約には由来を `comment on` で残す」は database-guards.md の',
      'MUST であり、手書きの執行点で実際に 2 件抜けていた。',
    ]),
    'export interface ExpectedCheck {',
    '  readonly name: string;',
    '  readonly expression: string | null;',
    '  readonly comment: string | null;',
    '}',
    '',
    docComment([
      '期待する採番の器 1 本(`create sequence`)。',
      '',
      '列の既定値が `nextval(…)` で名指すものだけが載る(名指しと宣言の突合は T13)。',
      '`start` が `null` なら SQL の既定(1)であり、そのときは',
      '実 DB の値と比べない —— 宣言していない性質を突合の対象にしない、という既定の線引きである。',
    ]),
    'export interface ExpectedSequence {',
    '  readonly name: string;',
    '  readonly start: number | null;',
    '}',
    '',
    docComment([
      '1 テーブル分の期待(列・主キー・CHECK・採番の器)。',
      '',
      '列と CHECK は**閉世界**である —— 宣言に無い列・制約が DB にあれば突合が落ちる。',
      '索引・外部キー・排他制約・トリガ・関数の閉世界は data-table-expectations.ts 側、',
      '**ACL の閉世界は acl-expectations.ts 側**である(母集合が違う —— 権限の正は形の正が',
      '無い表にもあるので、そちらは data_table の全数が載る)。',
    ]),
    'export interface DdlExpectation {',
    '  readonly primaryKey: readonly string[];',
    '  /** 列の既定値が使う採番の器(`create sequence` は表より前に出る)。 */',
    '  readonly sequences: readonly ExpectedSequence[];',
    '  readonly columns: readonly ExpectedColumn[];',
    '  readonly checks: readonly ExpectedCheck[];',
    '}',
    '',
    docComment([
      'テーブルごとの期待 DDL の完全集合(`ddl_migration` を宣言した表)。',
      '',
      'ここに載る表は「宣言どおりの列と制約しか無い」ことを ddl-parity が両方向で確かめる。',
      '母集合は entity を持つ表と、仕組みが自分で持つ表(`framework:` を宣言する jobs /',
      'domain_events)である。アプリ固有の内部テーブルは列の正がどこにも無いので載らない。',
    ]),
    'export const ddlExpectationsByTable: Readonly<Record<string, DdlExpectation>> =',
    `  ${frozen(renderLiteral(byTable, 1))};`,
    '',
  ].join('\n');
}
