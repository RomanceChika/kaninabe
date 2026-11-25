/**
 * T12 のうち **表の権限の出どころ**(surface_spec の `grants_migration`)の検査。
 *
 * T12 の下位検査の 1 つで、見る相手は表の権限の書き出し先である(公開スキーマの土台は
 * `t12-surface-base.ts`、surface のビューは `t12-surface-views.ts` が見る)。
 *
 * 見るのは 4 つ。
 *
 * | 何 | なぜ |
 * |---|---|
 * | 表を 1 枚でも持つ系では**必須** | 権限は形と違って間違っても読み書きが失敗しない。宣言が無ければ誰も `revoke` / `grant` を出さず、Supabase の既定権限(`truncate` を含む)のまま**全部緑で成立する** |
 * | 名前が `{14 桁}_grants.sql` の形 | 名前から「系に 1 本の権限である」ことが一意に読めることが、生成先の唯一の手がかり |
 * | **全 data_table を通して一意** | 生成器は同じファイルを 2 度書けない |
 *
 * ## 連番の前後は見ない(2026-09-26)
 *
 * かつては「連番が全 `ddl_migration` より後」を要求していた —— `grant … on public.{表}` は表が
 * 在ってはじめて通るからである。だがそれは**表の DDL を 1 枚再発行するたびに権限も採番し直す**
 * ことを意味し、バイト同一の `_grants.sql` が 1 本増えた(実測: 同じ束で 2 回)。
 *
 * 前後関係は番号ではなく**存在ガード**が持つ(`grants-migration.ts` の `tableGrant`。外部キーを
 * 両側のファイルに出すときと同じ道具)。だからここでは順序を見ない ——
 * `surface_migration` の T12 と同じ答え、**表の実在は歴史が保証しており、番号は保証していない**。
 * 権限より後ろの番号で**新しく**作られた表は、次の再採番で拾われる ——
 * **表を 1 枚足すとこのファイルの中身が変わる**ので、採番し直していなければ `generate:check` が
 * 適用済みの書き換えとして落とす。それでも欠けたままの表は、ACL の閉世界(`ddl-parity`)と
 * 空の DB に全部当てる `samples:db` が名指す。
 *
 * ## 免除の口を持たない
 *
 * `surface_base_migration` は「宣言しない構成もある」(歴史のあるリポジトリでは番号をもう取れない)
 * が、`grants_migration` は**後ろの番号**でよいので歴史のある DB でも必ず宣言できる。だから
 * 「宣言が無ければ何も見ない」にはしない —— 宣言できない事情が存在しないところに逃げ道を作ると、
 * それは免除リストである。
 */

import type { SurfaceSpecModel } from '../../model/surface/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import { t12Finding } from './t12-surface-views.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import { MIGRATION_SEQUENCE } from './migration-sequence.js';

/** 表の権限の生成 migration の名前(連番の後ろ)。 */
const GRANTS_SUFFIX = '_grants.sql';

/** 宣言を書く場所(surface_spec。Finding の location に使う)。 */
function specFile(roots: ProductRoots): string {
  return specPath(roots, 'backend/surface.md');
}

/**
 * `grants_migration` の宣言(必須・名前の形・全 data_table を通した一意)を見る。
 *
 * **連番の前後は見ない**(理由はこのファイルの docstring §連番の前後は見ない)。
 *
 * @param model 読み込み済みの surface_spec
 * @param dataTables 読み込み済みの data_table
 * @param seen 既に使われている migration 名(出どころつき)。宣言があれば名前を足す
 * @param roots 製品が宣言した根(道案内のパスを組み立てる)
 * @returns 違反のリスト
 */
export function checkGrantsMigration(
  model: SurfaceSpecModel,
  dataTables: DataTableSpecModel,
  seen: Map<string, string>,
  roots: ProductRoots,
): Finding[] {
  if (!dataTables.available || dataTables.tables.length === 0) return [];
  const declared = model.spec?.grantsMigration;
  const location = model.spec?.location ?? { file: specFile(roots) };
  if (declared === undefined) return [missingDeclaration(location, dataTables.tables, roots)];
  const findings = [...checkName(declared, location)];
  const first = seen.get(declared);
  if (first !== undefined) {
    findings.push(
      t12Finding({
        message: `grants_migration ${declared} が ${first} と重複しています`,
        location: { ...location, pointer: 'grants_migration' },
        suggestion: '生成物 1 つにつき migration 1 本にする(生成器は同じファイルを 2 度書けない)',
        counterexample: { migration: declared, first },
      }),
    );
  }
  seen.set(declared, 'surface_spec の grants_migration');
  return findings;
}

/** 表があるのに宣言が無い(誰も権限を執行しない系になる)。 */
function missingDeclaration(
  location: { readonly file: string },
  tables: readonly DataTableSpec[],
  roots: ProductRoots,
): Finding {
  return t12Finding({
    message: `表が ${tables.length} 枚あるのに surface_spec の grants_migration の宣言がありません`,
    location: { ...location, pointer: 'grants_migration' },
    suggestion:
      `surface_spec(${specFile(roots)})に grants_migration: {14 桁の連番}${GRANTS_SUFFIX} を宣言する` +
      '(表の権限は仕組みの 1 組で決まりきっているので生成物であり、宣言が無いと' +
      '「特権ロールから truncate できる」状態のまま全部緑になる)。' +
      '連番はどこでもよい —— 表ごとの権限は存在ガードつきで出るので、' +
      '表の DDL との前後関係を持たない',
    counterexample: { tables: String(tables.length), expected: `{14 桁}${GRANTS_SUFFIX}` },
  });
}

/** 名前が `{14 桁}_grants.sql` の形かを見る。 */
function checkName(migration: string, location: { readonly file: string }): Finding[] {
  const index = migration.indexOf('_');
  const sequence = index === -1 ? '' : migration.slice(0, index);
  if (MIGRATION_SEQUENCE.test(sequence) && migration.slice(index) === GRANTS_SUFFIX) return [];
  return [
    t12Finding({
      message: `grants_migration ${migration} が決まった名前になっていません`,
      location: { ...location, pointer: 'grants_migration' },
      suggestion: `"{14 桁の連番}${GRANTS_SUFFIX}" の形に直す(系に 1 本なので対象の名前は付かない)`,
      counterexample: { migration, expected: `{14 桁}${GRANTS_SUFFIX}` },
    }),
  ];
}
