/**
 * T12 のうち **surface_spec の宣言**(土台の書き出し先と、手書きで残すビューの宣言)の検査。
 *
 * T12 の下位検査の 1 つで、見る相手は surface_spec の宣言である。surface のビューは
 * `t12-surface-views.ts`、ビューと RLS 補助関数の前後関係は `t12-surface-view-order.ts`、表の権限は
 * `t12-grants.ts` が見る。
 *
 * 見るのは 3 つ。
 *
 * | 何 | なぜ |
 * |---|---|
 * | 土台の名前が `{14 桁}_{exposedSchema}_base.sql` の形で、**連番が公開スキーマに関数・ビューを作る生成 migration すべてより前**であること | 空の DB に順に当てるとき、スキーマがまだ無ければ `create or replace function {公開スキーマ}.…` はその場で落ちる。**番号でしか表せない前後関係**なので宣言の段で見る。名前の規則は適用済みでないファイルにだけ効く(`t12-surface-naming.ts`) |
 * | `hand_written_views` に宣言できるのが `internal: true` の data_table だけであること | 列の正が仕様に無い表だけが「生成物にできない」。entity_spec を持つ表を宣言できるなら、それは免除リストである |
 * | 同じ表が `hand_written_views` と `surface_migration` の**両方を宣言しない**こと | 「手書きで残す」と「生成する」を同時に宣言すると、どちらが正か読めない。生成物にしたら宣言を外す |
 *
 * ## 宣言しない構成では何も見ない
 *
 * ここが見る 3 つは**宣言したときにだけ**効く。公開面の土台を生成物にせず手書きの migration が
 * 持つ構成(歴史のあるリポジトリ)では宣言が無いので 1 つも鳴らない —— 「宣言するなら規則に
 * 従う」であり、免除の口でも消し込み式の warning でもない。
 */

import type { SurfaceSpecModel, HandWrittenViewDecl } from '../../model/surface/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { ExternalSpecModel } from '../../model/external/types.js';
import { isInbound } from '../../model/external/types.js';
import type { UsecaseSpecModel } from '../../model/usecase/types.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import { judgeSurfaceName, nameSuggestion } from './t12-surface-naming.js';
import { sequenceOf, t12Finding } from './t12-surface-views.js';

/**
 * surface_spec の宣言(土台の名前・手書きで残すビュー)を見る。
 *
 * @param model 読み込み済みの surface_spec
 * @param dataTables 読み込み済みの data_table
 * @param seen 既に使われている migration 名(出どころつき)
 * @param exposedSchema 外に出すスキーマの名前(名前の規則の正)
 * @returns 違反のリスト
 */
export function checkSurfaceSpec(
  model: SurfaceSpecModel,
  dataTables: DataTableSpecModel,
  seen: Map<string, string>,
  exposedSchema: string,
): Finding[] {
  const spec = model.spec;
  if (spec === null) return [];
  const findings: Finding[] = [];
  const declared = spec.surfaceBaseMigration;
  if (declared !== undefined) {
    findings.push(...checkBaseName(declared, spec.location, exposedSchema));
    const first = seen.get(declared);
    if (first !== undefined) {
      findings.push(
        t12Finding({
          message: `surface_base_migration ${declared} が ${first} と重複しています`,
          location: { ...spec.location, pointer: 'surface_base_migration' },
          suggestion: '生成物 1 つにつき migration 1 本にする(生成器は同じファイルを 2 度書けない)',
          counterexample: { migration: declared, first },
        }),
      );
    }
    seen.set(declared, 'surface_spec の surface_base_migration');
  }
  return [...findings, ...checkHandWrittenViews(spec.handWrittenViews, dataTables)];
}

/** 土台の名前を名前の規則で見る(置き場の実在では免除しない)。 */
function checkBaseName(declared: string, location: { readonly file: string }, exposedSchema: string): Finding[] {
  const verdict = judgeSurfaceName(declared, { kind: 'base' }, exposedSchema);
  if (verdict.kind === 'ok') return [];
  return [
    t12Finding({
      message: `surface_base_migration ${declared} が決まった名前になっていません`,
      location: { ...location, pointer: 'surface_base_migration' },
      suggestion: nameSuggestion(verdict.expected, '中身はどのアプリでも同じ 1 枚である'),
      counterexample: { migration: declared, expected: `{14 桁}${verdict.expected}` },
    }),
  ];
}

/** 手書きで残すビューが「列の正が仕様に無い表」だけであることを見る。 */
function checkHandWrittenViews(
  views: readonly HandWrittenViewDecl[],
  dataTables: DataTableSpecModel,
): Finding[] {
  return views.flatMap((view) => {
    const target = dataTables.tables.find((table) => table.table === view.table);
    if (target === undefined) {
      return [
        t12Finding({
          message: `hand_written_views の ${view.table} に対応する data_table がありません`,
          location: view.location,
          suggestion: 'table にその表の data_table の table を書く(綴り違いを直すか、宣言を消す)',
          counterexample: { table: view.table },
        }),
      ];
    }
    if (!target.internal) {
      return [
        t12Finding({
          message: `hand_written_views に ${view.table} は宣言できません(内部テーブルではありません)`,
          location: view.location,
          suggestion:
            'ドメイン仕様に現れる表のビューは entity_spec と access_spec から導けるので生成物にする' +
            '(surface_migration を宣言する)。ここは導けない表だけの欄であり、免除リストではない',
          counterexample: { table: view.table, reason: view.reason },
        }),
      ];
    }
    if (target.surfaceMigration !== undefined) {
      return [
        t12Finding({
          message: `hand_written_views の ${view.table} は surface_migration も宣言しています`,
          location: view.location,
          suggestion:
            'そのビューは生成物である。hand_written_views の行を削除する' +
            '(「手書きで残す」と「生成する」の両方を宣言すると、どちらが正か読めない)',
          counterexample: { table: view.table, surface_migration: target.surfaceMigration },
        }),
      ];
    }
    return [];
  });
}

/**
 * 公開スキーマの土台が、公開スキーマに関数・ビューを作るどの生成 migration よりも前に当たることを見る。
 *
 * @param model 読み込み済みの surface_spec
 * @param dataTables 読み込み済みの data_table
 * @param usecases 読み込み済みの usecase_spec(保存点の複合 RPC。無ければ見ない)
 * @param external 読み込み済みの external_spec(受信の RPC。無ければ見ない)
 * @returns 違反のリスト(前に当たらない相手を 1 つ名指す)
 */
export function checkSurfaceBaseOrder(
  model: SurfaceSpecModel,
  dataTables: DataTableSpecModel,
  usecases?: UsecaseSpecModel,
  external?: ExternalSpecModel,
): Finding[] {
  const spec = model.spec;
  const declared = spec?.surfaceBaseMigration;
  if (spec === null || spec === undefined || declared === undefined) return [];
  const base = sequenceOf(declared);
  const earlier = surfaceSchemaMigrations(dataTables, usecases, external)
    .filter((entry) => sequenceOf(entry.migration) <= base)
    .sort((a, b) => a.migration.localeCompare(b.migration));
  const first = earlier[0];
  if (first === undefined) return [];
  // 相手は 1 つだけ名指す(全部並べても直し方は「土台の連番を一番早い相手より小さくする」の 1 つで、
  // 残りは同じ 1 手で一緒に消える)。件数は反例に添える。
  return [
    t12Finding({
      message:
        `surface_base_migration ${declared} が ${first.migration}(${first.origin})より後に当たります` +
        `(公開スキーマに関数・ビューを作る生成 migration ${earlier.length} 本より後)`,
      location: { ...spec.location, pointer: 'surface_base_migration' },
      suggestion:
        `surface_base_migration の連番を ${first.migration} より小さくする` +
        '(公開スキーマに関数・ビューを作る生成 migration は、スキーマを作る土台より後でなければ当たらない)。' +
        '既に適用済みの版より小さい番号は後から宣言できないので、歴史のある DB でこれを満たせないなら、' +
        '土台は手書きの migration に任せて surface_base_migration を宣言しない',
      counterexample: { surface_base: declared, after: first.migration, origin: first.origin, count: String(earlier.length) },
    }),
  ];
}

/** 公開スキーマに関数・ビューを作る生成 migration の全数(名前と出どころ)。 */
function surfaceSchemaMigrations(
  dataTables: DataTableSpecModel,
  usecases: UsecaseSpecModel | undefined,
  external: ExternalSpecModel | undefined,
): readonly { readonly migration: string; readonly origin: string }[] {
  return [
    ...dataTables.tables.flatMap((table) => [
      ...(table.policiesMigration === undefined
        ? []
        : [{ migration: table.policiesMigration, origin: `table ${table.table} の policies_migration` }]),
      ...(table.surfaceMigration === undefined
        ? []
        : [{ migration: table.surfaceMigration, origin: `table ${table.table} の surface_migration` }]),
      ...table.functions
        .filter((fn) => fn.migration !== undefined)
        .map((fn) => ({ migration: fn.migration ?? '', origin: `function ${fn.name}` })),
    ]),
    ...(usecases?.usecases ?? []).flatMap((usecase) =>
      usecase.saves.map((save) => ({
        migration: save.migration,
        origin: `usecase ${usecase.id} の保存点 ${save.id}`,
      })),
    ),
    ...(external?.catalog?.integrations ?? [])
      .filter(isInbound)
      .map((integration) => ({
        migration: integration.migration,
        origin: `受信 ${integration.id}`,
      })),
  ];
}
