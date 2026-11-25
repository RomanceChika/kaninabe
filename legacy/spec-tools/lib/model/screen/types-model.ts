/**
 * screen_spec / chrome_spec の集約モデルと、画面検証器(S 群)への入力の型。
 *
 * `model/types.ts` が `types-model.ts` に「集約とモデル全体」を分けているのと同じ境界を
 * ここでも踏襲する — 個々の宣言の型(ScreenSpec / ChromeSpec 等)は types.ts が持ち、
 * それらを束ねたモデルと検証器の入力だけをここに置く。
 */

import type { SpecModel } from '../types.js';
import type { AppRoutesModel } from './app-types.js';
import type { QuerySpecModel } from '../query/types.js';
import type { TcRegistry, TestScanResult } from '../../testcase/types.js';
import type { UsecaseSpecModel } from '../usecase/types.js';
import type { AuthSpecModel } from '../auth/types.js';
import type { ExposureDecl, PlatformOpExposureDecl, RoleStateReachDecl, StateVisibilityDecl } from './guide-decls.js';
import type { ChromeSpec, ScreenSpec } from './types.js';

/** specs/frontend の画面仕様全体。S 群への入力の 1 つ。 */
export interface ScreenSpecModel {
  /**
   * specs/frontend/screens を読めたか。
   * false は「画面をまだ仕様化していない」を意味し、0 件(ディレクトリはあるが空)と区別する
   * (query_spec の QuerySpecModel と同じ流儀)。
   */
  readonly available: boolean;
  readonly screens: readonly ScreenSpec[];
  readonly chromes: readonly ChromeSpec[];
  /** UI 到達の免除宣言(screens/README.md のフロントマター `unexposed`)。S10 が読む。 */
  readonly unexposed: readonly ExposureDecl[];
  /** 状態×ロールの到達の免除宣言(screens/README.md のフロントマター `unreachable_states`)。S13 が読む。 */
  readonly unreachableStates: readonly RoleStateReachDecl[];
  /** 状態の可視性の免除宣言(screens/README.md のフロントマター `unseen_states`)。S14 が読む。 */
  readonly unseenStates: readonly StateVisibilityDecl[];
  /** プラットフォーム操作の露出の免除宣言(screens/README.md のフロントマター `unexposed_platform_ops`)。S21 が読む。ローダーは常に載せる(無ければ省略 = 免除なし)。 */
  readonly unexposedPlatformOps?: readonly PlatformOpExposureDecl[];
}

/** 画面検証器(S1〜S12)への唯一の入力。 */
export interface ScreenInput {
  readonly domain: SpecModel;
  /** 読み取りクエリ仕様(S2 の `reads` の実在検査・S4 のロール整合が使う)。 */
  readonly queries: QuerySpecModel;
  readonly screens: ScreenSpecModel;
  /**
   * 実装側のルート(S7 の突合先)。`available: false` なら S7 は何も見ない。
   *
   * 他の入力(ドメイン仕様・query_spec・screen_spec)がすべて `docs/specs` 由来であるのに対し、
   * これだけが `app/` 由来である。仕様と実装の**両方向**の食い違い(仕様にあるのに実ルートが無い /
   * 実ルートにあるのに仕様が無い)は、片側だけを見ていては原理的に検出できない。
   */
  readonly app: AppRoutesModel;
  /**
   * 読み込み済みの auth_spec(認証フロー仕様)。S13 が `gates[].role` を引くのに使う
   * (`requiredGuardsOf` と同じ規則で「そのロールが画面に入れるか」を導くため)。
   * `available: false` なら role_gate の掛からない画面として扱う(H4 と同じ既定)。
   */
  readonly auth: AuthSpecModel;
  /**
   * 全仕様種のテストケース ID 台帳(lib/testcase/registry.ts)。CLI が構築したものを受け取る。
   *
   * S8 はここから `screen_spec` のエントリだけを引いて突合する。種をまたぐ ID 重複は A9 が、
   * テスト側 `@tc` の orphan 判定は A6 が、いずれも同じ台帳を母集合にして見る。
   */
  readonly registry: TcRegistry;
  /**
   * app/ の走査結果(テストファイルと `@spec` / `@tc` アノテーション)。S8 の突合先。
   *
   * トレース検証(A 群)が作ったものをそのまま受け取る。走査は 1 回でよく、
   * 「同じ事実の入力口を 1 つに保つ」ためでもある。`available: false` なら S8 は何も見ない。
   */
  readonly tests: TestScanResult;
  /**
   * 読み込み済みの usecase_spec(S16 が `usecases` の実在と手順の露出を見る)。
   * `available: false` なら S16 は何も見ない。
   */
  readonly usecases: UsecaseSpecModel;
  /** 製品が置いたプレビューの断片(名前 → 断片。S22)。省略は断片の置き場が無い構成。 */
  readonly previews?: ReadonlyMap<string, string>;
}
