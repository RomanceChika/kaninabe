/**
 * surface_spec(SQL の公開面の仕様)のモデル型。
 *
 * 「外から届く surface は仕様の生成物だけ」(docs/design/security-surface-proposal.md §2)の
 * **surface そのもの**の宣言である。**責務は SQL の境界だけ**(外に出すスキーマ・そこに置く生成ビューと
 * 土台の関数・DB ロールへの grants)で、API 層がその公開面をどう外に出すか(認証主体の解決・API 側の権限)は
 * 仕様の外 —— platform の後段の能力(`PlatformProfile.surfaceExposure`)である。
 *
 * これまで surface の宣言は 2 か所に散っていた —— 土台の書き出し先は
 * `framework:` を宣言する data_table の `surface_base_migration`、surface に出す内部テーブルの一覧は
 * 生成器に閉じたハードコードだった。どちらも「アプリの表の性質」ではなく「surface の性質」であり、
 * 表の仕様に属するものではない。
 *
 * **ビューの一覧はここに書かない。** どの表が surface に出るか・何列出るかは entity_spec と
 * access_spec から導ける(導出の表は docs/design/api-views-generation.md §1)ので、
 * この仕様書に列を書き写すと正が 2 つになる。ここが持つのは**導けないもの**だけである。
 *
 * notification_spec / job_spec / config_spec / guarantee_spec と同じ「1 プロジェクト 1 枚」の
 * 器であり、新しい機構ではない。
 */

import type { SourceLocation } from '../types.js';

/** 手書きのまま残すビュー 1 本の宣言。 */
export interface HandWrittenViewDecl {
  /** そのビューの元になる表(`internal: true` の data_table)。 */
  readonly table: string;
  /** なぜ生成物にできないか(免除ではなく、導出できない根拠を書く)。 */
  readonly reason: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** surface_spec 1 ファイル分の宣言。 */
export interface SurfaceSpec {
  /** 文書 ID(`surface` 固定 —— 1 プロジェクト 1 枚)。 */
  readonly id: string;
  /**
   * 外に出すスキーマの土台(スキーマ・呼び出し主体を解決する関数 2 本とセッションの生死の関数 1 本・権限)の書き出し先。
   *
   * 宣言しない構成では土台は手書きの migration が持つ(歴史のあるリポジトリ)。
   */
  readonly surfaceBaseMigration?: string;
  /**
   * **特権ロールの権限**(と、ポリシーを持たない表の surface のロールの剥奪)の書き出し先。
   *
   * 与える権限は**どの表でも同じ 1 組**なので、表ごとの DDL に複製すると「仕組みの 1 行を
   * 変える日」のコストが表数に比例する(実測 16 本)。だから系に 1 本であり、置き場が
   * `surface_base_migration` と同じここなのは、**どちらもアプリの表に属さない「系に 1 枚の
   * 生成 migration の書き出し先」**だからである(`docs/design/ddl-reissue-free-changes.md`
   * §4 の C′)。載る表は data_table の全数で、宣言に決める余地はファイル名だけである。
   *
   * 表を 1 枚でも持つ系では**必須**である(T12)。**連番と表の DDL の前後関係は無い** ——
   * `grant … on public.{表}` は表が在ってはじめて通るが、それは表ごとの**存在ガード**
   * (`to_regclass('public.{表}') is not null`)が持つ(`grants-migration.ts`)。番号で
   * 保証していたあいだ、表の DDL を 1 枚再発行するたびに中身がバイト同一の migration が
   * 1 本増えていた(2026-09-26。§4-b)。
   */
  readonly grantsMigration?: string;
  /** 生成物にできず手書きのまま残すビュー(宣言順)。 */
  readonly handWrittenViews: readonly HandWrittenViewDecl[];
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** 読み込み結果のモデル。 */
export interface SurfaceSpecModel {
  /** docs/specs/backend/surface.md があったか。 */
  readonly available: boolean;
  /** 読めた宣言(スキーマ違反で読めなければ null)。 */
  readonly spec: SurfaceSpec | null;
}
