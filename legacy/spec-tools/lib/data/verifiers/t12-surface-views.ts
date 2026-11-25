/**
 * T12 のうち **SQL の公開面(surface)のビュー**(`surface_migration`)の検査。
 *
 * T12 の下位検査の 1 つで、見る相手は surface に出る表の `surface_migration` である(表の DDL の
 * 書き出し先は `t12-ddl-migration.ts` が見る)。
 *
 * 見るのは 3 つ。
 *
 * | 何 | なぜ |
 * |---|---|
 * | surface に出る表(entity_spec と access_spec の両方を持つ表)が `surface_migration` を**必ず宣言する**こと | 宣言しなければビューは生成されず、surface には手書きのビュー(あるいは何も)が残る。免除の口を作らないための必須である |
 * | その名前が `{14 桁}_{exposedSchema}_view_{表名}.sql` の形で、**全 migration 名を通して一意**であること | 生成器は同じファイルを 2 度書けない。名前の規則は置き場の実在に依らずいつも効く(`t12-surface-naming.ts`) |
 * | 宣言できるのが**surface に出る表**だけであること | 列の正がどこにも無い表のビューは導けない |
 *
 * **仕組みが自分で持つ表**(`framework:` を宣言する内部テーブル)は宣言してもよい ——
 * 列の正が設計図にあるので導ける。ただし**必須ではない**(その表を surface に出すかどうかは
 * 仕様に現れない実装事情であり、「出すなら生成物にする」が線である)。
 *
 * T12 の残りの下位検査は兄弟のファイルにある ——
 * **surface_spec の宣言**(土台の名前と順序・手書きで残すビュー)は `t12-surface-base.ts`、
 * **surface のビューと RLS 補助関数の前後関係**は `t12-surface-view-order.ts`。
 *
 * **ビューの必須は surface_spec に依らない。** どの表が surface に出るかは entity_spec と access_spec が
 * 決めるので、surface の仕様書を開設していないリポジトリでも `surface_migration` の必須は鳴る
 * (書き出し先を宣言するのは表の側であり、surface の仕様書は土台と手書きの宣言だけを持つ)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { findAccessSpec, findEntitySpec } from '../../semantics/domain-lookup.js';
import { isFrameworkTable } from '../../sql/framework-tables.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import { judgeSurfaceName, nameSuggestion } from './t12-surface-naming.js';
import { MIGRATION_SEQUENCE } from './migration-sequence.js';

/** この検証器の ID(分割しても 1 つ)。 */
const VERIFIER_ID = 'T12';

/** T12 の指摘を組み立てる(surface のビュー側と surface_spec 側の両方が使う)。 */
export function t12Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 連番の読み取り(形式が違えば 0 = どれより前でもない)。 */
export function sequenceOf(migration: string): number {
  const head = migration.slice(0, 14);
  return MIGRATION_SEQUENCE.test(head) ? Number(head) : 0;
}

/**
 * surface のビューを宣言する migration(名前の形・必須・一意)を見る。
 *
 * @param domain 構築済みのドメイン仕様(surface に出る表を引く)
 * @param dataTables 読み込み済みの data_table
 * @param seen 既に使われている migration 名(出どころつき)。宣言があれば名前を足す
 * @param exposedSchema 外に出すスキーマの名前(名前の規則の正)
 * @returns 違反のリスト
 */
export function checkSurfaceViewMigrations(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  seen: Map<string, string>,
  exposedSchema: string,
): Finding[] {
  const findings: Finding[] = [];
  for (const table of dataTables.tables) {
    const declared = table.surfaceMigration;
    if (declared === undefined) {
      // 旧いキーが書かれた表は、パーサが廃止の error で書き直し先を名指している(同じ原因を「ありません」で重ねない)。
      if (mustSurface(domain, table) && table.retiredSurfaceKey !== true) findings.push(missingSurfaceView(table, exposedSchema));
      continue;
    }
    if (!isSurfaced(domain, table)) {
      findings.push(
        t12Finding({
          message: `${table.table} は surface に出る表ではないので surface_migration を宣言できません`,
          location: { ...table.location, pointer: 'surface_migration' },
          suggestion:
            'ビューの列の正は entity_spec、隠し列の正は access_spec である。' +
            'どちらも無い表のビューは導けないので、surface_spec の hand_written_views で宣言する',
          counterexample: { table: table.table, surface_migration: declared },
        }),
      );
      continue;
    }
    findings.push(...checkViewName(table, declared, exposedSchema));
    const first = seen.get(declared);
    if (first !== undefined) {
      findings.push(
        t12Finding({
          message: `surface_migration ${declared} が ${first} と重複しています`,
          location: { ...table.location, pointer: 'surface_migration' },
          suggestion: '生成物 1 つにつき migration 1 本にする(生成器は同じファイルを 2 度書けない)',
          counterexample: { table: table.table, migration: declared, first },
        }),
      );
    }
    seen.set(declared, `table ${table.table} の surface_migration`);
  }
  return findings;
}

/** 宣言された名前を名前の規則で見る(置き場の実在では免除しない)。 */
function checkViewName(table: DataTableSpec, declared: string, exposedSchema: string): Finding[] {
  const verdict = judgeSurfaceName(declared, { kind: 'view', table: table.table }, exposedSchema);
  if (verdict.kind === 'ok') return [];
  return [
    t12Finding({
      message: `surface_migration ${declared} が決まった名前になっていません`,
      location: { ...table.location, pointer: 'surface_migration' },
      suggestion: nameSuggestion(verdict.expected, '表 1 枚につきビュー 1 枚である'),
      counterexample: { table: table.table, migration: declared, expected: `{14 桁}${verdict.expected}` },
    }),
  ];
}

/**
 * surface に出る表か。
 *
 * 2 通りある —— ①entity_spec と access_spec の両方を持つ集約の表(列の正はドメイン仕様)、
 * ②**仕組みが自分で持つ表**(`framework:` を宣言する内部テーブル。列の正は設計図)。
 * ②で surface の宣言が**必須にならない**のは、その表を surface に出すかどうかが仕様に現れない実装事情だ
 * からである(出すなら生成物にできる、が正しい線)。
 */
function isSurfaced(domain: SpecModel, table: DataTableSpec): boolean {
  if (table.framework !== undefined && isFrameworkTable(table.framework)) return true;
  if (table.entity === undefined) return false;
  return findEntitySpec(domain, table.entity) !== null && findAccessSpec(domain, table.entity) !== null;
}

/** surface の宣言が**必須**の表か(集約の表だけ。仕組みが持つ表は「出すなら生成物」である)。 */
function mustSurface(domain: SpecModel, table: DataTableSpec): boolean {
  if (table.framework !== undefined && isFrameworkTable(table.framework)) return false;
  return isSurfaced(domain, table);
}

/** surface に出る表が書き出し先を宣言していないときの指摘。 */
function missingSurfaceView(table: DataTableSpec, exposedSchema: string): Finding {
  return t12Finding({
    message: `${table.table} は surface に出る表なのに surface_migration がありません`,
    location: { ...table.location, pointer: 'surface_migration' },
    suggestion:
      `surface_migration: {14 桁の連番}_${exposedSchema}_view_${table.table}.sql を宣言する` +
      '(SQL の公開面のビューは entity_spec の列と access_spec の fields_hidden から生成される)',
    counterexample: { table: table.table, entity: table.entity ?? '' },
  });
}
