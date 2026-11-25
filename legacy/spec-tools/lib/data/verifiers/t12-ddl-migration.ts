/**
 * T12 **表の DDL の出どころ**(`ddl_migration`)の検査。
 *
 * 束「DDL 生成」で「表の形(列・型・NOT NULL・主キー・導出 CHECK・既定値・`comment on`)も
 * 生成物」になった。生成物である以上、**どこへ書き出すか**を仕様が宣言していなければならない
 * (migration は追記専用の歴史なので、名前が宣言にあることが「DDL が変わったら名前を新しく
 * する」という 1 手を成立させる。migrations.md §生成 migration。T6 / T7 と同じ規則)。
 *
 * 見るのは 8 つである。
 *   1. **形の正がある表は `ddl_migration` が必須**。形の正は 2 通りしかない —— `entity` を
 *      持つ表は entity_spec が、`framework:` を宣言する表は `lib/sql/framework-tables.ts` の
 *      設計図が持つ。どちらでもない内部テーブルは形の正がどこにも無いので導出できず、
 *      宣言してはならない(DDL は手書きのままにする)。
 *   2. 名前が `{14 桁}_ddl_{テーブル名}.sql` の形であること。
 *   3. **全 data_table を通して一意**(`policies_migration` とも `functions[].migration` とも
 *      衝突しない。生成器は同じファイルを 2 度書けない)。
 *   4. **DDL が実際に組み立てられる**(生成器が報告する前提そのもの)。判定を書き写さず
 *      `ddlPlanOf` を呼ぶので、ここが緑なら `code-ddl` は `preconditionFailure` に
 *      落ちない(T6 / T7 と同じ流儀)。
 *   5. **外部キーの参照先が宣言にある**こと。**順序は見ない** —— 外部キーを張れるのは両方の
 *      表が揃ってからなので、生成器が「自表と参照先のうち番号の大きい側のファイル」に出す
 *      (`ddl-plan.ts` の `DdlForeignKey`)。置き場が決まれば新しい DB にも順に当たり、
 *      **相互参照する 2 表**も解ける —— 番号で依存順を表そうとすると循環が解けない。
 *      ここが見るのは「置き場を決められること」= 参照先の表が data_table にあることである
 *      (別スキーマの表(`auth.users`)はこの体系の外なので対象外)。
 *   6. **`framework` が値域にあり、表の名前と一致し、二重に宣言されていない**こと。
 *      名前が一致していなければならないのは、定型 RPC の本文が書き込む先の表名
 *      (`rpc-parts.ts`)がこの 2 語に固定されているからである —— 別の名前の表を設計図に
 *      結びつけると、生成された RPC が存在しない表に書く。
 *   7. **SQL の公開面(surface)**(surface_spec の土台と手書きの宣言、`surface_migration` の出どころ)。
 *      判定は `t12-surface-views.ts` ほかに分けてあるが、報告する検証器は T12 のままである。
 *      **後段が SQL の公開面を API として外へ出す能力を持たない構成(`surfaceExposure: unsupported`)では、7 を見ない**
 *      (未対応の報告は実行口が言う。黙って緑にしない)。8 は能力に依らず見る。
 *   8. **表の権限の出どころ**(surface_spec の `grants_migration`。必須・名前の形・一意。
 *      **連番は見ない** —— 表ごとの権限は存在ガードつきで出るので、表の DDL との前後関係を
 *      持たない。5 と同じ理由である)。権限は表ごとの DDL ではなく**系に 1 本**の生成物であり
 *      (`lib/sql/grants-migration.ts`)、宣言が無いと誰も `revoke` / `grant` を出さないまま
 *      全部緑で成立する。判定は `t12-grants.ts`。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { ExternalSpecModel } from '../../model/external/types.js';
import type { UsecaseSpecModel } from '../../model/usecase/types.js';
import { ddlPlanOf, FRAMEWORK_TABLES, isFrameworkTable } from '../../sql/framework-tables.js';
import type { SurfaceSpecModel } from '../../model/surface/types.js';
import { checkSurfaceViewMigrations } from './t12-surface-views.js';
import { checkSurfaceBaseOrder, checkSurfaceSpec } from './t12-surface-base.js';
import { checkGrantsMigration } from './t12-grants.js';
import { checkSurfaceViewOrder } from './t12-surface-view-order.js';
import type { SurfacePlatform } from './t12-surface-naming.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import type { ProductRoots } from '../../model/product/types.js';
import { MIGRATION_SEQUENCE } from './migration-sequence.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T12';

/** 表の DDL の生成 migration の名前の中ほど。 */
const INFIX = '_ddl_';

/** T12 の指摘を組み立てる。 */
function t12Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * 全 data_table の `ddl_migration` を検証する。
 *
 * @param domain 構築済みのドメイン仕様モデル(列・型・制約の正)
 * @param dataTables 読み込み済みの data_table
 * @param roots 製品が宣言した根(道案内のパス)
 * @param platform 公開面の判定が読むプラットフォームの設定(外に出すスキーマの名前・後段の能力。値を選ぶのは組み立ての根)
 * @param usecases 読み込み済みの usecase_spec(公開スキーマの土台の順序が保存点の複合 RPC を見る)
 * @param external 読み込み済みの external_spec(同じく受信の RPC を見る)
 * @param surface 読み込み済みの surface_spec(SQL の公開面の土台と手書きの宣言)
 * @param surfaceBlocked surface_spec を採っているのに渡せない(阻害)。true のとき、surface_spec の宣言に依る判定(権限の migration の宣言が無い等)は出さない(`surface` が無いことを「宣言が無い」と読まない。未選択は従来どおり宣言が無い事実)
 * @returns 違反のリスト
 */
export function verifyDdlMigration(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  roots: ProductRoots,
  platform: SurfacePlatform,
  usecases?: UsecaseSpecModel,
  external?: ExternalSpecModel,
  surface?: SurfaceSpecModel,
  surfaceBlocked = false,
): Finding[] {
  if (!dataTables.available) return [];
  const findings: Finding[] = [];
  const seen = new Map<string, string>(otherMigrations(dataTables));
  for (const table of dataTables.tables) {
    findings.push(...checkFramework(table));
    const declared = table.ddlMigration;
    if (table.entity === undefined && table.framework === undefined) {
      if (declared !== undefined) findings.push(unexpectedDeclaration(table));
      continue;
    }
    if (declared === undefined) {
      findings.push(missingDeclaration(table));
      continue;
    }
    findings.push(...checkName(declared, table));
    const first = seen.get(declared);
    if (first !== undefined) findings.push(duplicated(declared, first, table));
    seen.set(declared, `table ${table.table}`);
    findings.push(...checkBuildable(table, domain, dataTables));
  }
  const declared = surface ?? { available: false, spec: null };
  // 表の権限の出どころ(8)は公開面の能力に依らない —— 表の権限・特権ロールへの付与・関数の実行権限の閉世界は、
  // 公開面を API として外へ出さない構成でも要る(出さないと剥奪が 1 行も出ないまま全部緑になる)。
  const grants = surfaceBlocked ? [] : checkGrantsMigration(declared, dataTables, seen, roots);
  // 後段が SQL の公開面を API として外へ出す能力を持たないなら、公開面の判定(土台・ビュー)は見ない(未対応の報告は実行口が言う)。
  if (platform.surfaceExposure.kind === 'unsupported') return [...findings, ...checkReferences(dataTables), ...grants];
  return [
    ...findings,
    ...checkReferences(dataTables),
    ...checkSurfaceSpec(declared, dataTables, seen, platform.exposedSchema),
    ...grants,
    ...checkSurfaceViewMigrations(domain, dataTables, seen, platform.exposedSchema),
    ...checkSurfaceViewOrder(domain, dataTables),
    ...checkSurfaceBaseOrder(declared, dataTables, usecases, external),
  ];
}

/**
 * `framework` の名前を見る(値域・表の名前との一致)。
 *
 * @param table 対象の表
 * @returns 違反のリスト
 */
function checkFramework(table: DataTableSpec): Finding[] {
  const name = table.framework;
  if (name === undefined) return [];
  if (!isFrameworkTable(name)) {
    return [
      t12Finding({
        message: `framework ${name} に対応する設計図がありません`,
        location: { ...table.location, pointer: 'framework' },
        suggestion:
          `${FRAMEWORK_TABLES.join(' / ')} のどれかにする` +
          '(設計図は lib/sql/framework-tables.ts にあり、無い名前の表の形は導出できない)',
        counterexample: { table: table.table, framework: name },
      }),
    ];
  }
  if (name === table.table) return [];
  return [
    t12Finding({
      message: `framework ${name} が表の名前 ${table.table} と一致しません`,
      location: { ...table.location, pointer: 'framework' },
      suggestion:
        '設計図の名前と表の名前を揃える(定型 RPC の本文が書き込む先の表名はこの 2 語に固定されており、' +
        '別名の表に結びつけると生成された RPC が存在しない表へ書く)',
      counterexample: { table: table.table, framework: name },
    }),
  ];
}

/** 名前の衝突を見るための母集合(ポリシーと関数本文の生成先)。 */
function otherMigrations(dataTables: DataTableSpecModel): readonly [string, string][] {
  return dataTables.tables.flatMap((table) => [
    ...(table.policiesMigration === undefined
      ? []
      : ([[table.policiesMigration, `table ${table.table} の policies_migration`]] as [string, string][])),
    ...table.functions
      .filter((fn) => fn.migration !== undefined)
      .map((fn) => [fn.migration ?? '', `function ${fn.name}`] as [string, string]),
  ]);
}

/** 形の正がある表(entity_spec か設計図を持つ表)に宣言が無い。 */
function missingDeclaration(table: DataTableSpec): Finding {
  return t12Finding({
    message: `${table.table} は形が導ける表ですが ddl_migration の宣言がありません`,
    location: { ...table.location, pointer: 'ddl_migration' },
    suggestion:
      `ddl_migration: {14 桁の連番}${INFIX}${table.table}.sql を宣言する` +
      '(表の形は entity_spec か設計図と data_table から決まるので、書き出す先が宣言に無いと生成できない)',
    counterexample: { table: table.table, expected: `{14 桁}${INFIX}${table.table}.sql` },
  });
}

/** 設計図もドメイン仕様も持たない内部テーブルが宣言している。 */
function unexpectedDeclaration(table: DataTableSpec): Finding {
  return t12Finding({
    message: `${table.table} は形の正がどこにも無い表なので ddl_migration を宣言できません`,
    location: { ...table.location, pointer: 'ddl_migration' },
    suggestion:
      'アプリ固有の内部テーブルは列・型の正を entity_spec にも設計図にも持たないので、DDL を導出できない' +
      '(手書きの migration のままにする)。行を削除するか、ドメイン仕様に載せて entity を宣言するか、' +
      `仕組みが持つ表なら framework: ${FRAMEWORK_TABLES.join(' / ')} を宣言する`,
    counterexample: { table: table.table, ddl_migration: table.ddlMigration ?? '' },
  });
}

/** 名前が `{14 桁}_ddl_{テーブル名}.sql` の形かを見る。 */
function checkName(migration: string, table: DataTableSpec): Finding[] {
  const expected = `${INFIX}${table.table}.sql`;
  const index = migration.indexOf('_');
  const sequence = index === -1 ? '' : migration.slice(0, index);
  if (MIGRATION_SEQUENCE.test(sequence) && migration.slice(index) === expected) return [];
  return [
    t12Finding({
      message: `ddl_migration ${migration} が表 ${table.table} から導かれる名前になっていません`,
      location: { ...table.location, pointer: 'ddl_migration' },
      suggestion:
        `"{14 桁の連番}${expected}" の形に直す` +
        '(名前から「どの表の DDL か」が一意に読めることが、生成先の唯一の手がかり)',
      counterexample: { table: table.table, migration, expected: `{14 桁}${expected}` },
    }),
  ];
}

/** 同じ migration 名を 2 つの宣言が使っている。 */
function duplicated(migration: string, first: string, table: DataTableSpec): Finding {
  return t12Finding({
    message: `ddl_migration ${migration} が ${first} と重複しています`,
    location: { ...table.location, pointer: 'ddl_migration' },
    suggestion: '生成物 1 つにつき migration 1 本にする(生成器は同じファイルを 2 度書けない)',
    counterexample: { table: table.table, migration, first },
  });
}

/**
 * その表の DDL が**実際に組み立てられる**ことを見る(生成器が報告する前提そのもの)。
 *
 * @param table 対象の表
 * @param domain ドメイン仕様
 * @param dataTables 全 data_table(外部キーの置き場を決めるのに要る)
 * @returns 違反のリスト
 */
function checkBuildable(table: DataTableSpec, domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  if (ddlPlanOf(table, domain, dataTables.tables) !== null) return [];
  return [
    t12Finding({
      message: `${table.table} の entity ${table.entity ?? ''} に対応する entity_spec がありません`,
      location: { ...table.location, pointer: 'entity' },
      suggestion:
        'entity の綴りを実在する entity_spec に合わせる(列・型・制約の正が引けないと DDL を導出できない)',
      counterexample: { table: table.table, entity: table.entity ?? '' },
    }),
  ];
}

/** 参照先の表名(スキーマ修飾は落とす)。別スキーマの表はこの体系の外なので対象外。 */
function referencedTable(references: string): string | null {
  const parts = references.split('.');
  if (parts.length === 1) return references;
  return parts[0] === 'public' ? (parts[1] ?? null) : null;
}

/**
 * 外部キーの参照先が宣言にあることを見る(順序は生成器が吸収する)。
 *
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
function checkReferences(dataTables: DataTableSpecModel): Finding[] {
  const known = new Set(dataTables.tables.map((table) => table.table));
  const findings: Finding[] = [];
  for (const table of dataTables.tables) {
    if (table.ddlMigration === undefined) continue;
    for (const fk of table.foreignKeys) {
      const target = referencedTable(fk.references);
      if (target === null || known.has(target)) continue;
      findings.push(unknownReference(table, fk.column, target));
    }
  }
  return findings;
}

/** 参照先の表に data_table が無い(外部キーの置き場を決められない)。 */
function unknownReference(table: DataTableSpec, column: string, target: string): Finding {
  return t12Finding({
    message: `${table.table}.${column} の参照先 ${target} に data_table がありません`,
    location: { ...table.location, pointer: 'foreign_keys' },
    suggestion:
      `${target} の data_table を書く(外部キーは「自表と参照先のうち番号の大きい側のファイル」に出すので、` +
      '参照先が宣言に無いと置き場が決まらない)。別スキーマの表なら `スキーマ名.表名` の形でスキーマ修飾する',
    counterexample: { table: table.table, column, references: target },
  });
}
