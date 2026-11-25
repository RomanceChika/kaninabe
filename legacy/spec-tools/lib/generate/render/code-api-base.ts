/**
 * surface_spec の `surface_base_migration` → **公開スキーマの土台**(`supabase/migrations/**`)の生成器。
 *
 * | 出力 | 宣言する場所 | 中身 |
 * |---|---|---|
 * | 公開スキーマの土台 1 枚 | surface_spec の `surface_base_migration` | `create schema if not exists api` / 呼び出し主体を解決する関数 2 本とセッションの生死の関数 1 本 / 権限 |
 *
 * 外から届く surface を仕様の生成物だけにする(API スキーマ方式)には、その surface を置くスキーマと
 * 呼び出し主体を解決する関数が先に要る。**中身に決める余地は無い**(プラットフォームの固有点 = 設定 `PlatformProfile` だけで
 * 決まる)のに、これまではアプリのビューと同じ手書きの migration に埋まっていた ——
 * 新しいアプリを起こすたびに同じ 40 行を書き写す作業が残っていたということである。
 *
 * 宣言の形と、連番が公開スキーマに関数・ビューを作るどの生成 migration よりも前であることは T12 が見る。
 * **後段が SQL の公開面を API として外へ出す能力を持たない構成(`surfaceExposure: unsupported`)では何も出さない**
 * (未対応の報告は生成の入口 `cli/generate-docs.ts` が言う。黙って緑にしない)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import { buildApiBaseMigration } from '../../sql/api-base.js';
import { surfaceUnsupportedReason } from '../../sql/platform-sql.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { migrationPath } from '../../model/product/paths.js';


/**
 * 公開スキーマの土台を生成するジェネレーター。
 * 出力は宣言された `surface_base_migration`(ファイル全体)1 枚だけである。
 */
export const apiBaseGenerator: DocGenerator = {
  id: 'code-api-base',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    if (surfaceUnsupportedReason(ctx.platform) !== null) return [];
    const migration = ctx.surface?.spec?.surfaceBaseMigration;
    if (migration === undefined) return [];
    return [{ file: migrationPath(ctx.roots, `${migration}`), content: buildApiBaseMigration(ctx.platform), wholeFile: true }];
  },
};
