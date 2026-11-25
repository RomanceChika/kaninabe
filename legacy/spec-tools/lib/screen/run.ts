/**
 * 画面仕様の検証(S0 + S 群)の実行口。
 *
 * CLI はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。
 */

import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { QuerySpecModel } from '../model/query/types.js';
import type { TcRegistry, TestScanResult } from '../testcase/types.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import type { ScreenContext } from './verifier.js';
import type { AppRoutesModel } from '../model/screen/app-types.js';
import type { ScreenInput, ScreenSpecModel } from '../model/screen/types.js';
import { ALL_SCREEN_VERIFIERS } from './verifiers/index.js';

/** 登録済みの検査器 ID(実行ログの範囲表記の母集合)。手書きの `S1〜S15` は腐る。 */
const SCREEN_VERIFIER_IDS: readonly string[] = ALL_SCREEN_VERIFIERS.map((verifier) => verifier.id);

/** runScreenVerification の入力。 */
export interface ScreenRunOptions {
  /** 構築済みのドメイン仕様モデル(S2 / S4 の突合先)。 */
  readonly domain: SpecModel;
  /** 読み込み済みの query_spec(S2 の reads / S4 のロール整合が使う)。 */
  readonly queries: QuerySpecModel;
  /** 読み込み済みの screen_spec / chrome_spec。`available: false` なら検証しない。 */
  readonly screens: ScreenSpecModel;
  /**
   * 読み込み済みの実ルート(S7 の突合先)。
   *
   * 走査の起点は CLI が決める(検証器も run も app/ の位置を知らない)。省略した場合は
   * 「実装がまだ無い」として S7 だけが黙る。
   */
  readonly app?: AppRoutesModel;
  /** 全仕様種のテストケース ID 台帳(CLI が 1 回だけ構築したものを受け取る)。 */
  readonly registry: TcRegistry;
  /**
   * app/ の走査結果(S8 の突合先)。トレース検証が作ったものを渡す。
   * 省略した場合は「実装がまだ無い」として S8 だけが黙る。
   */
  readonly tests?: TestScanResult;
  /**
   * 読み込み済みの auth_spec(S13 が `gates[].role` を引くのに使う)。
   * 省略した場合は「auth_spec がまだ無い」として role_gate の掛からない画面として扱う。
   */
  readonly auth?: AuthSpecModel;
  /**
   * 読み込み済みの usecase_spec(S16 が `usecases` の実在と手順の露出を見る)。
   * 省略した場合は「タスクをまだ仕様化していない」として S16 だけが黙る。
   */
  readonly usecases?: UsecaseSpecModel;
  /** 製品が置いたプレビューの断片(S22)。省略は断片の置き場が無い構成。 */
  readonly previews?: ReadonlyMap<string, string>;
  /** ガード式の共有サービス(S5 が使う)。 */
  readonly context: ScreenContext;
}

/** runScreenVerification の結果。 */
export interface ScreenRunResult {
  readonly findings: Finding[];
  /** specs/frontend/screens を読めたか。false なら S 群は実行していない。 */
  readonly available: boolean;
  /** 読み込めた screen_spec の数(CLI のサマリ表示用)。 */
  readonly screenCount: number;
  /** 読み込めた chrome_spec の数(CLI のサマリ表示用)。 */
  readonly chromeCount: number;
  /** 実ルートを読めたか。false なら S7 は実行していない(CLI のサマリ表示用)。 */
  readonly appAvailable: boolean;
  /** app/ のテストを走査できたか。false なら S8 は実行していない(CLI のサマリ表示用)。 */
  readonly testsAvailable: boolean;
  /** 実行した検査器の ID(登録配列そのまま。実行ログの範囲表記をここから導く)。 */
  readonly verifierIds: readonly string[];
}

/** 実装(app/)を読めなかったときの空モデル。 */
const NO_APP: AppRoutesModel = {
  available: false,
  routes: [],
  proxy: { available: false, file: '', patterns: [] },
};

/** app/ のテストを走査できなかったときの空の結果。 */
const NO_TESTS: TestScanResult = {
  available: false,
  testFiles: [],
  annotations: [],
  actionFiles: [],
  operationFiles: [],
};

/** auth_spec を読めなかったときの空モデル(role_gate が掛からない画面として扱う)。 */
const NO_AUTH: AuthSpecModel = { available: false, flow: null };

/** usecase_spec を読めなかったときの空モデル(S16 は何も見ない)。 */
const NO_USECASES: UsecaseSpecModel = { available: false, usecases: [] };

/**
 * 画面仕様の検証を実行する。
 *
 * screen_spec が 1 件も無い(ディレクトリごと無い)環境でも壊れない。その場合
 * `available: false` を返し、検証は行わない。
 *
 * @param options ドメインモデル・query_spec・画面仕様・台帳・共有サービス
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runScreenVerification(options: ScreenRunOptions): ScreenRunResult {
  const screens = options.screens;
  const app = options.app ?? NO_APP;
  const tests = options.tests ?? NO_TESTS;
  const auth = options.auth ?? NO_AUTH;
  const usecases = options.usecases ?? NO_USECASES;
  if (!screens.available) {
    return {
      findings: [],
      available: false,
      screenCount: 0,
      chromeCount: 0,
      appAvailable: app.available,
      testsAvailable: tests.available,
      verifierIds: SCREEN_VERIFIER_IDS,
    };
  }

  const input: ScreenInput = {
    domain: options.domain,
    queries: options.queries,
    screens,
    app,
    registry: options.registry,
    tests,
    auth,
    usecases,
    ...(options.previews === undefined ? {} : { previews: options.previews }),
  };
  const findings: Finding[] = [];
  for (const verifier of ALL_SCREEN_VERIFIERS) {
    findings.push(...verifier.verify(input, options.context));
  }
  return {
    findings,
    available: true,
    screenCount: screens.screens.length,
    chromeCount: screens.chromes.length,
    appAvailable: app.available,
    testsAvailable: tests.available,
    verifierIds: SCREEN_VERIFIER_IDS,
  };
}
