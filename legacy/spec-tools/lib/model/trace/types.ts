/**
 * action_spec(Server Action 仕様)の宣言の型付きモデル。
 *
 * `ActionSpecModel` は specs/backend/actions を lib/model/trace/loader が読んで構築する。ここは**宣言の形**だけを
 * 持つ —— 他の仕様種のモデル(job・data_table・external)も、検査への入力(`TraceInput`。`input.ts`)も、
 * app/ の走査結果(`testcase/types-scan.ts`)も知らない。テストケースの共通の語彙(`ActionTestCase` など)は
 * 種類に属さない `testcase/types.ts` にある。
 *
 * スキーマの正: docs/rules/process/backend/specification/standards/action-spec-writing.md
 */

import type { SourceLocation } from '../types.js';
import type { ActionTestCase } from '../../testcase/types.js';
import type { ActionUxOverride } from './types-ux.js';
import type { LintExceptionDecl } from '../parse-lint-exceptions.js';
import type { ActionComputeDecl, ActionRunnerDecl } from './types-plan.js';

export type { ActionUxConfirm, ActionUxOverride } from './types-ux.js';
export { ACTION_UX_CONFIRM_VALUES } from './types-ux.js';

// ---------------------------------------------------------------------------
// action_spec
// ---------------------------------------------------------------------------

/** `{machine}.{event}` 形式のドメインイベント参照。パース時に形式検査済み。 */
export interface EventRef {
  /** 書かれたままの文字列(例: "entry.submit")。メッセージ・突合キーに使う。 */
  readonly raw: string;
  /** 状態機械名(例: "entry")。 */
  readonly machine: string;
  /** イベント ID(例: "submit")。 */
  readonly event: string;
}

/** `{entity}.{field}` 形式の入力フィールド参照。パース時に形式検査済み。 */
export interface InputFieldRef {
  readonly raw: string;
  readonly entity: string;
  readonly field: string;
  readonly location: SourceLocation;
}
// 実行計画にかかわる 2 つの宣言(`computes` / `runner`)の型は types-plan.ts にある
// (パーサーを parse-action-plan.ts に分けてあるのと同じ線である)。
export type {
  ActionComputeDecl,
  ActionComputeExample,
  ActionComputeReadRef,
  ActionRunnerDecl,
  ActionRunnerKind,
  ComputeExampleValue,
  ComputeShape,
} from './types-plan.js';
export { ACTION_RUNNER_KINDS, COMPUTE_SHAPES } from './types-plan.js';

/** アクション固有のエラー(共通 3 分類に載らないもの)。 */
export interface ActionErrorDef {
  readonly kind: string;
  /** 発生条件(日本語)。 */
  readonly when: string;
  readonly location: SourceLocation;
}

/** errors ブロック。3 分類は共通規約への参照(inherits)で表す。 */
export interface ActionErrors {
  /** 継承元。現状 "common" のみ。 */
  readonly inherits: string;
  readonly additional: readonly ActionErrorDef[];
}

/**
 * 欠番にした(廃止した)テストケース ID の宣言 1 件(`retired:`)。
 *
 * action-spec-writing.md §test_cases の「id の番号は追記専用にする。廃止したケースの番号は
 * 欠番のまま残す」を機械が見えるようにする口。以前は「◯◯は欠番」という散文コメントでしか
 * 残っておらず、その番号が後から別のケースに再利用されても誰も気付けなかった(A9 は
 * *現在の* test_cases の重複しか見ておらず、退場した番号の再利用は視界の外にあった)。
 */
export interface RetiredTestCaseRef {
  /** 欠番にしたテストケース ID。 */
  readonly id: string;
  readonly location: SourceLocation;
}

/** 1 つの action_spec ファイル(= 1 アクション)。 */
export interface ActionSpec {
  /** `{aggregate}-{event}-action`。 */
  readonly id: string;
  readonly handles: EventRef;
  readonly input: readonly InputFieldRef[];
  /** 入力に無く、実行時に純関数が決める欄(任意。V18 が接地を見る)。 */
  readonly computes: readonly ActionComputeDecl[];
  /**
   * 作成の**持ち主の欄**(任意。`owner: {entity}.{field}`)—— 作成者(実行者)そのもので埋める欄の明示の宣言。
   *
   * 作成で実行者が入る欄は、この宣言・ユースケースの `defaults.self`・遷移の `records_actor` だけで、
   * 「必須で入力に無い実行者への参照は作成者」の暗黙の補完は無い(点検 9 回目 A9-1。接地は V19 が見る)。
   */
  readonly owner?: InputFieldRef;
  /** 実行器の選び方(任意。書かなければ生成された実行計画で走る)。 */
  readonly runner?: ActionRunnerDecl;
  readonly errors: ActionErrors;
  readonly testCases: readonly ActionTestCase[];
  /** 方針の導出の上書き(任意。書けば V14 が reason 必須を見る)。 */
  readonly ux?: ActionUxOverride;
  /** 欠番にしたテストケース ID(A9 が再利用を検出する)。 */
  readonly retired: readonly RetiredTestCaseRef[];
  /** ESLint 違反の理由つき受け入れ(任意。免除の一本化。eslint-disable の代わりにここへ宣言する)。 */
  readonly exceptions: readonly LintExceptionDecl[];
  /** specs/backend/actions からの相対パス(例: "entry/submit.md")。A2 がこれと handles を突き合わせる。 */
  readonly relPath: string;
  readonly location: SourceLocation;
}

/**
 * action_spec を持たないイベントの理由宣言(A4 の免除)。
 * specs/backend/actions/README.md のフロントマター `unhandled` に書く。
 */
export interface UnhandledDecl {
  /** `{machine}.{event}`。 */
  readonly event: string;
  /** action_spec を用意していない理由(日本語)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}

/**
 * system が起こすイベントの走査実装の宣言(A10)。
 * specs/backend/actions/README.md のフロントマター `scans` に書く。
 *
 * `by` に `system` を含むイベントは Server Action の入口を持たない(A4 の母集合外)ため、
 * 「誰が起こすのか」が仕様のどこにも現れない。それを 1 か所で宣言させるのがこのキーである。
 */
export interface ScanDecl {
  /** `{machine}.{event}`。 */
  readonly event: string;
  /** 走査を実装しているモジュール(リポジトリルートからの相対パス)。 */
  readonly implementation: string;
  /**
   * この走査を守るテストケース(テスト義務の全域化。任意)。
   *
   * system が起こすイベントは action_spec を持たないため、通常の test_cases の置き場が無い。
   * ここに書けば A10 が(A6 と同じ 3 段で)`@tc` と突合する。書かなくてもエラーにはならない
   * (走査の実在そのものは `implementation` の実在検査が既に見ている)。
   */
  readonly testCases?: readonly ActionTestCase[];
  readonly location: SourceLocation;
}

/**
 * 走査を用意していないイベントの理由宣言(A10 の免除)。
 * specs/backend/actions/README.md のフロントマター `unscanned` に書く。
 */
export interface UnscannedDecl {
  /** `{machine}.{event}`。 */
  readonly event: string;
  /** 走査を用意していない理由(日本語)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}

/**
 * 注釈の無いテストファイルの既知台帳の 1 行(A12)。
 * specs/backend/actions/README.md のフロントマター `test_tag_baseline` に書く。
 *
 * 免除(unhandled / unscanned)と同じ書式だが意味が違う — これは**未処理一覧**であり、
 * ラチェット(新規の無印だけをエラーにする)の基準線である。行は消すだけで、足さない。
 */
export interface TestTagBaselineDecl {
  /** テストファイルのリポジトリルートからの相対パス。 */
  readonly file: string;
  readonly location: SourceLocation;
}

/** specs/backend/actions 全体。トレース検証器への入力の 1 つ。 */
export interface ActionSpecModel {
  readonly actions: readonly ActionSpec[];
  readonly unhandled: readonly UnhandledDecl[];
  /** system が起こすイベントの走査実装(A10)。 */
  readonly scans: readonly ScanDecl[];
  /** 走査を用意していないイベントの理由(A10 の免除)。 */
  readonly unscanned: readonly UnscannedDecl[];
  /** 注釈の無いテストファイルの既知台帳(A12 のラチェット基準線)。 */
  readonly testTagBaseline: readonly TestTagBaselineDecl[];
}
