/**
 * T12 のうち **surface のビューと RLS 補助関数の前後関係**(連番の順序)の検査。
 *
 * T12 の下位検査の 1 つで、見る相手は連番の前後関係である(ビューの必須と名前は
 * `t12-surface-views.ts` が見る)。
 *
 * ## 何を見るか
 *
 * **隠し列を持つ表の `surface_migration` の連番が、RLS 補助関数(`kind: helper` + `role` または
 * テナント境界の `actor_field`)のどの `migration` よりも後である**こと。
 *
 * surface のビューの migration は、隠し列 1 つにつき述語関数 1 本
 * (`create or replace function {公開スキーマ}.can_see_{表}_{列} … language sql`)を先に作る。その本文は
 * ポリシーと**同じ翻訳器**が組み立てるので、グローバルに立つロールの根拠 ——
 * `public.is_{ロール}()` —— と、境界の右辺の `public.actor_{欄}()` をそのまま呼ぶ。`language sql` の本文は**作成時に解析される**ので、
 * 補助関数がまだ無い DB に当てると `create or replace function` がその場で落ちる。
 * **番号でしか表せない前後関係**なので、宣言の段で見るほかない(T7 が「補助関数 < 全ポリシー」を
 * 同じ理由で見ているのと同型である)。
 *
 * ## 見ないもの
 *
 * - **隠し列を持たない表**。述語関数が 1 本も出ないので、補助関数に寄りかかっていない。
 * - **基表の `ddl_migration` との前後**。表の DDL の連番は「SQL が変わったら採番し直す」
 *   規則で動く番号であり、**表がいつ作られたかとは別物**である(ポリシーの連番も現に全表の
 *   `ddl_migration` より小さい)。表の実在は歴史が保証しており、番号は保証していない。
 * - **`policies_migration` との前後**。surface のビューはポリシーを 1 つも参照しない
 *   (`security_invoker = true` で読むのは実行時である)。ポリシーがまだ無い DB に surface を
 *   開けても、行が 1 つも見えないだけで作成は落ちない —— **要らない順序を規則にしない**。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { findAccessSpec } from '../../semantics/domain-lookup.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import { MIGRATION_SEQUENCE } from './migration-sequence.js';

/** この検証器の ID(分割しても 1 つ)。 */
const VERIFIER_ID = 'T12';

/** 連番の読み取り(形式が違えば 0 = どれより後でもない)。名前の形は別の判定が見る。 */
function sequenceOf(migration: string): number {
  const head = migration.slice(0, 14);
  return MIGRATION_SEQUENCE.test(head) ? Number(head) : 0;
}

/** 宣言された RLS 補助関数の生成先(名前と連番)。 */
interface HelperMigration {
  readonly name: string;
  readonly migration: string;
  readonly sequence: number;
}

/**
 * surface のビューが RLS 補助関数より後に当たることを見る。
 *
 * @param domain 構築済みのドメイン仕様(隠し列の有無を引く)
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト(ビュー 1 枚につき、前に当たらない補助関数を 1 つ名指す)
 */
export function checkSurfaceViewOrder(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const helpers = declaredHelpers(dataTables);
  if (helpers.length === 0) return [];
  const latest = helpers.reduce((max, helper) => (helper.sequence > max.sequence ? helper : max), helpers[0] as HelperMigration);
  const findings: Finding[] = [];
  for (const table of dataTables.tables) {
    const declared = table.surfaceMigration;
    if (declared === undefined || !hasMaskedColumns(domain, table)) continue;
    if (sequenceOf(declared) > latest.sequence) continue;
    findings.push(lateSurfaceView(table, declared, latest));
  }
  return findings;
}

/** 生成先を宣言する RLS 補助関数の全数(全 data_table を通して)。 */
function declaredHelpers(dataTables: DataTableSpecModel): readonly HelperMigration[] {
  return dataTables.tables.flatMap((table) =>
    table.functions
      .filter(
        (fn) =>
          fn.kind === 'helper' && (fn.role !== undefined || fn.actorField !== undefined) && fn.migration !== undefined,
      )
      .map((fn) => ({
        name: fn.name,
        migration: fn.migration ?? '',
        sequence: sequenceOf(fn.migration ?? ''),
      })),
  );
}

/** その表の surface に隠し列の述語が出るか(`fields_hidden` を 1 つでも持つか)。 */
function hasMaskedColumns(domain: SpecModel, table: DataTableSpec): boolean {
  if (table.entity === undefined) return false;
  const access = findAccessSpec(domain, table.entity);
  return access !== null && access.fieldsHidden.length > 0;
}

/** surface のビューが補助関数より前に当たる。 */
function lateSurfaceView(table: DataTableSpec, declared: string, helper: HelperMigration): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message:
      `surface_migration ${declared} が RLS 補助関数 ${helper.name}(${helper.migration})より前に当たります` +
      '(この表は隠し列を持つので、面のビューの migration が述語関数を作ります)',
    location: { ...table.location, pointer: 'surface_migration' },
    suggestion:
      `surface_migration の連番を ${helper.migration} より大きくする` +
      '(隠し列の述語は `public.is_{ロール}()` を呼ぶ SQL 関数であり、補助関数が無い DB では' +
      'その場で作成に失敗する)。補助関数の側を先に採番し直す手もあるが、' +
      '補助関数は全ポリシーより前でなければならない(T7)ので、動かせるのは面の側である',
    counterexample: { table: table.table, surface_view: declared, helper: helper.migration },
  };
}
