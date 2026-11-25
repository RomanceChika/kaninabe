/**
 * 認証フロー仕様検証(H 群)の実行口。
 *
 * ローダー(H0)が構築した宣言を検証器(H1〜H5)に流すところまでをまとめる。
 * 配線(lib/compose/verify-pipeline.ts)はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。チェック内容の正は auth-spec-writing.md。
 */

import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { CatalogInput } from '../kernel/input-state.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import type { TestScanResult, TcRegistry } from '../testcase/types.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import { AUTH_STEPS } from './checks.js';
import { runAuthConfig } from './platform-config.js';
import type { AuthConfigRun, AuthConfigVerifier } from './platform-config.js';
import type { ProductRoots } from '../model/product/types.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ActionSpecModel } from '../model/trace/types.js';

/** runAuthVerification の入力。 */
export interface AuthRunInput {
  /** 構築済みのドメイン仕様モデル(主語の状態とイベントの出どころ)。 */
  readonly domain: SpecModel;
  /** 読み込み済みの認証フロー仕様(H0 はローダーが済ませてある)。 */
  readonly auth: AuthSpecModel;
  /**
   * 画面仕様の**入力の状態**(着地と関門の送り先の接地先)。未選択は画面を前提にする H2 / H4 を回さない(画面が無い構成は正当)。
   * **阻害**(採ったのに読めない・読めずに落とした画面がある)のときは、欠けたモデルで「着地の画面がありません」と言わないよう、画面との突合は出さない。
   * 出せる判定は出す: H2 は画面に依らない関門の `implementation` の実在を、H4 は(仕様を落としたときの)読めた画面が掛かる関門の宣言漏れを判定する
   * (止めるのは、画面の実在・排他表示の一致と、「どの画面も掛からない関門」だけ。行は呼び手が言う)。任意の欄ではなく**必須**。
   */
  readonly screens: CatalogInput<ScreenSpecModel>;
  /** リポジトリルートの絶対パス(関門の実装の実在を見る)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(H2 が実装の木の有無を判定するのに使う)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(H6 が書き込みの入口の解決の関数の住む、認証の組み立ての根を引く)。 */
  readonly layout: ProductLayout;
  /** action_spec の入力の状態(H6 が `runner: manual` の操作の手書きの入口を引く。阻害は名指しの表の行が言う)。 */
  readonly actions: CatalogInput<ActionSpecModel>;
  /** テストケース ID 台帳(H3 が auth_spec の宣言を引く)。 */
  readonly registry: TcRegistry;
  /** app/ の走査結果(H3 の `@tc` 突合。読めない構成では H3 は何も見ない)。 */
  readonly tests: TestScanResult;
  /**
   * プラットフォームの後段が登録した H5(サインインの方式と公開スキーマの突合)。**省略・null は「後段が登録していない」**で、
   * H5 は未実施と報告される(実行ログが言う。黙って緑にしない)。
   */
  readonly authConfig?: AuthConfigVerifier | null;
}

/** runAuthVerification の結果。 */
export interface AuthRunResult {
  readonly findings: Finding[];
  /** 仕様ファイルがあったか。false なら H1・H2 は実行していない。 */
  readonly available: boolean;
  /** 読み込めた分岐の件数(CLI のサマリ表示用)。 */
  readonly branchCount: number;
  /** 画面仕様を採っていないか(未選択)。true なら H2 / H4 はスキップされている(阻害は検査ごとの行が言う)。 */
  readonly screensUnselected: boolean;
  /** app/ を走査できたか。false なら H3 はスキップされている。 */
  readonly testsAvailable: boolean;
  /** H5 の実行の状態(設定ファイルを読めたか・読めなかったか・後段が登録していないか。実行ログが行で言う)。 */
  readonly authConfig: AuthConfigRun;
}

/**
 * 認証フロー仕様の検証(H1〜H5)を実行する。
 *
 * 仕様が無い環境では検証をスキップし、その旨を報告できる形で返す
 * (認証フロー仕様をまだ開設していないリポジトリでも壊れない)。
 *
 * @param input ドメインモデル・認証フロー仕様・画面仕様・台帳・走査結果
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runAuthVerification(input: AuthRunInput): AuthRunResult {
  if (!input.auth.available) {
    return {
      findings: [],
      available: false,
      branchCount: 0,
      screensUnselected: input.screens.state === 'unselected',
      testsAvailable: input.tests.available,
      authConfig: { state: 'no_declaration', cause: 'absent' },
    };
  }
  // 宣言(providers)を読めていないときは突き合わせる相手が無い(H0 が読めなかった理由を言っている)ので、H5 は何も見ない。
  const config =
    input.auth.flow === null
      ? { findings: [], run: { state: 'no_declaration', cause: 'unreadable' } as const }
      : runAuthConfig(input.authConfig, {
          providers: input.auth.flow.providers,
          localOnly: input.auth.flow.localOnly,
          ...(input.auth.flow.callback === undefined ? {} : { callback: input.auth.flow.callback.endpoint }),
          ...(input.auth.flow.sessions === undefined ? {} : { sessions: input.auth.flow.sessions }),
          ...(input.auth.flow.mfa === undefined ? {} : { mfa: input.auth.flow.mfa }),
          repoRoot: input.repoRoot,
          roots: input.roots,
        });
  return {
    findings: [...AUTH_STEPS.flatMap((step) => step.run(input)), ...config.findings],
    available: true,
    branchCount: input.auth.flow?.branches.length ?? 0,
    screensUnselected: input.screens.state === 'unselected',
    testsAvailable: input.tests.available,
    authConfig: config.run,
  };
}
