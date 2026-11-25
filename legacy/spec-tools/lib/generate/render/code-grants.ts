/**
 * surface_spec の `grants_migration` + data_table → **表の権限**(`supabase/migrations/**`)と
 * **ACL の期待表**の生成器。
 *
 * | 出力 | 宣言する場所 | 中身 |
 * |---|---|---|
 * | 権限の migration 1 枚 | surface_spec の `grants_migration` | 表ごとの `revoke all` → 特権ロールに 4 権限(ポリシーを持たない表は surface のロールの剥奪も)+ 末尾に**関数の実行権限の閉世界**(宣言の外の関数から surface のロールと PUBLIC を外す)|
 * | ACL の期待表 | —(全体生成) | `app/src/domain/generated/acl-expectations.ts`(ddl-parity の ACL の閉世界と、関数の実行権限の閉世界の入力)|
 *
 * 表の DDL から権限を切り出した理由は `lib/sql/grants-migration.ts` の docstring にある
 * (どの表でも同じ 1 組なのに、表ごとのファイルに複製すると仕組みの 1 行を変える日のコストが
 * 表数に比例する)。
 *
 * ## 期待表が表の DDL の期待と別なのはなぜか
 *
 * **母集合が違う。** 形の期待(`ddl-expectations.ts`)は `ddl_migration` を宣言した表 ——
 * つまり**形の正がある表**だけである。権限の正は**全部の表**にあるので、形を導けない内部
 * テーブルもここには載る。1 つの期待表に混ぜると、形を持たない表のために「列も CHECK も
 * 空」という嘘の期待を書くことになる。
 *
 * **後段が SQL の公開面を API として外へ出す能力を持たない構成(`surfaceExposure: unsupported`)でも、migration と期待表は出す。**
 * 表の権限・特権ロールへの付与・関数の実行権限の閉世界は、公開面を API として外へ出すかどうかと関係なく要る
 * (Postgres は新しい関数の実行権限を `PUBLIC` に開き、表の既定権限には `truncate` が入る —— 公開面の能力が無い構成でも、
 * DB に接続できる一般利用者のロールがある限り閉じなければならない)。かつては能力が無いと migration ごと出さず、
 * **剥奪が 1 行も出ないまま全部緑**になっていた。公開面に依る部品(土台の関数・隠し列の述語)だけは、能力が無い構成では
 * 作られないので、呼べる関数の一覧から外す(`functionAclPlan`)。宣言(`grants_migration`)が無ければ T12 が止める。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { DataTableSpec } from '../../model/data/types.js';
import type { SpecModel } from '../../model/types.js';
import { buildGrantsMigration, grantPlans } from '../../sql/grants-migration.js';
import { functionAclPlan, type FunctionAclPlan } from '../../sql/function-acl.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import { endUserRoles, privilegedRole } from '../../sql/platform-sql.js';
import { tableAcl, type RoleAcl } from '../../sql/table-acl.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';
import { migrationPath } from '../../model/product/paths.js';


/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'acl-expectations.ts');

/**
 * 権限の migration と ACL の期待表を生成するジェネレーター。
 * 出力は宣言された `grants_migration`(ファイル全体)と `acl-expectations.ts`(全体生成)。
 */
export const grantsGenerator: DocGenerator = {
  id: 'code-grants',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const tables = ctx.dataTables?.tables ?? [];
    if (tables.length === 0) return [];
    const migration = ctx.surface?.spec?.grantsMigration;
    const functions = functionAclPlan({ model, tables, platform: ctx.platform });
    return [
      // 宣言が無い系では権限の migration が出ない(T12 が必須にするので、そこで止まる)。
      // 期待表は**宣言が無くても出す** —— 出さないと「誰も権限を執行していない」状態が
      // 突合の対象から消え、全部緑のまま成立する。
      ...(migration === undefined
        ? []
        : [
            {
              file: migrationPath(ctx.roots, `${migration}`),
              content: buildGrantsMigration(grantPlans(tables, ctx.platform), functions),
              wholeFile: true,
            },
          ]),
      { file: outputFile(ctx.roots), content: renderFile(tables, model, ctx.platform, functions, migration), wholeFile: true },
    ];
  },
};

/** 期待表のファイル全体を組み立てる。 */
function renderFile(
  tables: readonly DataTableSpec[],
  model: SpecModel,
  platform: PlatformProfile,
  functions: FunctionAclPlan,
  migration: string | undefined,
): string {
  const byTable: Record<string, LiteralValue> = {};
  for (const plan of grantPlans(tables, platform)) {
    const table = tables.find((candidate) => candidate.table === plan.table);
    if (table === undefined) continue;
    byTable[plan.table] = aclLiteral(tableAcl(table, model, platform));
  }
  return [
    generatedHeader([...new Set(tables.map((table) => table.location.file))].sort()),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      '1 ロール分の期待権限。**全ロールぶんが載って ACL の全数になる**(閉世界)。',
      '',
      '`privileges` が空の配列なら「その表で権限を 1 つも持たない」であり、**宣言が無い**の',
      'ではない —— 権限は形と違って**間違っても読み書きが失敗しない**(失敗の代わりに',
      '「できてはいけないことができる」になる)ので、持たないことも宣言の一部である。',
      '',
      `執行者は分かれる —— ポリシーを持つ表の surface のロール(${endUserRoles(platform).join(' / ')})の権限は`,
      `ポリシーの migration が、特権ロール(${privilegedRole(platform)})の権限と、ポリシーを持たない表の`,
      'surface のロールの剥奪は**系に 1 本の権限の migration**(surface_spec の grants_migration)が出す。',
      '正はどちらも仕様(access_spec の reads / 仕組みの 1 組)であり、期待の組み立ては',
      'lib/sql/table-acl.ts。',
    ]),
    'export interface ExpectedRoleAcl {',
    '  /** Postgres のロール名。 */',
    '  readonly role: string;',
    '  /** そのロールがその表で持つべき権限の全数(SQL の語。空なら 1 つも持たない)。 */',
    '  readonly privileges: readonly string[];',
    '}',
    '',
    docComment([
      'テーブルごとの期待 ACL の完全集合(**data_table の全数**)。',
      '',
      '母集合が形の期待(ddl-expectations.ts)より広いのは、**形の正が無い表にも権限の正が',
      'ある**からである —— 列を導けない内部テーブルも、特権ロールから truncate できないことは',
      '宣言できる。ここに載る表は「宣言どおりの権限しか持たない」ことを ddl-parity が',
      '両方向で確かめる(宣言に無いロールへの付与も落ちる)。',
    ]),
    'export const aclExpectationsByTable: Readonly<Record<string, readonly ExpectedRoleAcl[]>> =',
    `  ${frozen(renderLiteral(byTable, 1))};`,
    '',
    ...functionExpectations(functions, platform, migration),
  ].join('\n');
}

/**
 * 関数の実行権限の期待(`execute` の閉世界)のリテラル。
 *
 * 母集合は計画のスキーマにある関数の全部で、**面のロールが実行してよいのは `functionExecutors`
 * の関数だけ**である。載らない関数(書き込みの RPC・トリガ関数ほか)は面のロールにも PUBLIC にも
 * 実行権限を持たない。特権ロールは持ってよい(RPC は持つ)——持たなければならないかは関数ごとの
 * 事情なので、突合する側が RPC の一覧と合わせて見る。
 */
function functionExpectations(functions: FunctionAclPlan, platform: PlatformProfile, migration: string | undefined): readonly string[] {
  const executors: Record<string, LiteralValue> = {};
  for (const fn of functions.callable) executors[fn.identity] = [...fn.grantees];
  return [
    docComment([
      '関数の実行権限の閉世界の入力(ddl-parity ではなく function-acl-parity が読む)。',
      '',
      `\`functionAclSchemas\` の関数のうち、面のロール(${functions.revokeFrom.join(' / ')})が実行してよいのは`,
      '`functionExecutors` に載る関数だけで、宛先は載っているロールの全数である。鍵は署名まで含む',
      '(`{スキーマ}.{名前}({引数の型})`。同じ名前の別の overload は載らない)。載らない関数は',
      `面のロールにも \`PUBLIC\` にも実行権限を持たない(特権ロール ${privilegedRole(platform)} は持ってよい)。`,
    ]),
    `export const functionAclSchemas: readonly string[] = ${frozen(renderLiteral([...functions.schemas]))};`,
    '',
    `export const functionAclExposedSchema = ${renderLiteral(platform.exposedSchema)};`,
    '',
    `export const functionAclEndUserRoles: readonly string[] = ${frozen(renderLiteral([...functions.revokeFrom]))};`,
    '',
    `export const functionAclPrivilegedRole = ${renderLiteral(privilegedRole(platform))};`,
    '',
    docComment([
      '関数を作る役のうち、migration が既定の実行権限を外す責務を持つ役(実在するのに外せなければ migration が止まる)。',
      '統合テストは、実在するこの役の全員を確かめる(確かめられない役を飛ばして緑にしない)。',
    ]),
    `export const functionAclRequiredCreators: readonly string[] = ${frozen(renderLiteral([...functions.requiredCreators]))};`,
    '',
    docComment([
      '関数を作る役のうち、プラットフォームが持ち migration からは触れない役(理由はコメントに残す。設定が必須にしている)。',
      'この役が後から作る関数の既定は閉じていない —— 保証は流す時点の一覧の剥奪と、閉世界の突合が持つ。',
      ...functions.externalCreators.map((creator) => `- ${commentText(creator.role)}: ${commentText(creator.reason)}`),
    ]),
    `export const functionAclExternalCreators: readonly string[] = ${frozen(renderLiteral(functions.externalCreators.map((creator) => creator.role)))};`,
    '',
    docComment(['関数の実行権限の節を持つ権限の migration のファイル名(統合テストが流して、既定を外す処理が効くことを確かめる)。']),
    `export const functionAclMigrationFile = ${renderLiteral(migration ?? '')};`,
    '',
    'export const functionExecutors: Readonly<Record<string, readonly string[]>> =',
    `  ${frozen(renderLiteral(executors, 1))};`,
    '',
    docComment([
      'sequence の権限の閉世界の入力(sequence-acl-parity が読む。点検 3 回目 A3-6)。',
      '',
      '`sequenceAclSchemas` の sequence(拡張が持つものを除く全部)では、面のロールと `PUBLIC` は権限を 1 つも持たない',
      `(採番は書き込みの RPC が特権の権限で行う。特権ロール ${privilegedRole(platform)} と所有者は持ってよい)。`,
      '剥奪と既定の閉鎖は関数の節と同じ権限の migration が出す。',
    ]),
    `export const sequenceAclSchemas: readonly string[] = ${frozen(renderLiteral([...functions.schemas]))};`,
    '',
    `export const sequenceAclEndUserRoles: readonly string[] = ${frozen(renderLiteral([...functions.revokeFrom]))};`,
    '',
  ];
}

/** コメントに入れる文字列を 1 行にする(改行と、コメントを閉じる記号を潰す)。 */
function commentText(text: string): string {
  return text.replace(/\s+/gu, ' ').replace(/\*\//gu, '* /').trim();
}

/** ロールごとの権限を、突合テストが読むリテラルに写す。 */
function aclLiteral(acl: readonly RoleAcl[]): LiteralValue {
  return acl.map((entry) => ({ role: entry.role, privileges: [...entry.privileges] }));
}
