/**
 * 画面仕様(screen_spec / chrome_spec)の型付きモデル。
 *
 * スキーマの正: docs/rules/process/frontend/specification/standards/screen-spec-writing.md
 *
 * screen_spec が宣言するのは画面の**構造と配線**(何を読み・何を発火し・どこへ遷移し・
 * どのスロットに何が載るか)だけであり、見た目・文言・操作感は実装の自由に残す。
 * 参照先(query_spec の id・ドメインイベント ID・他画面の id)を**再定義しない**のは
 * backend 仕様と同じ流儀で、S 群の検証はすべて「この宣言が他の仕様と食い違っていないか」を問う。
 */

import type { SourceLocation } from '../types.js';
import type { ActionTestCase } from '../../testcase/types.js';
import type { ScreenLayout, ScreenRef } from './types-layout.js';
import type { ScreenSmoke } from './types-smoke.js';
import type { ScreenUxAccept } from './types-ux.js';

export type { ExposureDecl, PlatformOpExposureDecl, RoleStateReachDecl, StateVisibilityDecl } from './guide-decls.js';
export type { ScreenSmoke } from './types-smoke.js';
export type { ScreenUxAccept } from './types-ux.js';
export { COMPONENT_KINDS, isComponentKind } from './types-component.js';
export type { ComponentKind } from './types-component.js';
export type { LayoutComponent, LayoutSlot, ScreenLayout, ScreenRef, VariantMembership } from './types-layout.js';
export type { ScreenSpecModel, ScreenInput } from './types-model.js';

/**
 * screen_spec の test_cases 1 件。
 *
 * action_spec / query_spec と同形式であり、`@tc` 突合も同じ規則で行うため型を共有する
 * (突合そのもの = screenTest 側の検査は Phase C-3。v1 は台帳への登録までを行う)。
 */
export type ScreenTestCase = ActionTestCase;

/** 遷移 1 本。 */
export interface ScreenNavigation {
  /**
   * 遷移のきっかけ。`{ドメインイベント ID}.success`(操作の結果)か、
   * UI 都合の自由語彙(ドットを含まない snake_case)のどちらか。前者は S2 が
   * `actions` との対応と接地を見る(ドットを含むのに `.success` 形でないものはエラーにする)。
   */
  readonly on: string;
  /** 遷移先の画面 id。実在を S2 が見る。 */
  readonly to: string;
  /**
   * この遷移が共有クロームから継承されたものなら、その chrome の id。
   *
   * chrome の `navigations` はローダーが継承画面へ展開する(共有部に置いたボタンの遷移を
   * 画面ごとに書き写さないため)。展開元を持つのは、重複や実在の指摘で
   * 「直すのは chrome の側だ」と示せるようにするため。
   */
  readonly viaChrome?: string;
  readonly location: SourceLocation;
}

/** 画面に重なる表示(モーダル・ポップアップ)1 件。 */
export interface ScreenOverlay {
  /** 画面内で一意な識別子(snake_case)。 */
  readonly id: string;
  readonly layout: ScreenLayout;
  /** これを開くコンポーネント名(任意)。 */
  readonly openedBy?: string;
  /** 確認の見出し(任意。確認の文言と実行ボタンの文言になる。無ければ遷移はイベントの `label`・予約 ID は既定の語)。 */
  readonly label?: string;
  readonly actions: readonly ScreenRef[];
  /** この重ね表示が発火するプラットフォーム操作(auth_spec の `platform_ops` の id。確認の器の相手。S20)。 */
  readonly platformOps: readonly ScreenRef[];
  /** 閉じるきっかけ(navigations の `on` と同じ語彙。遷移は伴わない)。 */
  readonly closesOn: readonly string[];
  readonly location: SourceLocation;
}

/** 入場条件が成立しなかったときの行き先。 */
export interface ScreenOnFail {
  /** 書かれたままの文字列(例: `redirect(screen-login)`)。 */
  readonly raw: string;
  /** 行き先の画面 id。実在を S5 が見る。 */
  readonly screen: string;
  readonly location: SourceLocation;
}

/**
 * 入場条件(ガード式と同じ文法の生文字列)。
 *
 * 参照できるのは `subject` に宣言したエンティティから `context` で辿れる範囲だけであり、
 * S5 が接地まで検査する。**セッションの有無は入場条件では表さない**(`requires_auth` の役目)。
 */
export interface ScreenPrecondition {
  readonly source: string;
  readonly location: SourceLocation;
}

/**
 * 表示義務のある状態。値域。「その状態を画面が表示できること」だけを縛り、
 * **見せ方は縛らない**(スピナーかスケルトンか、文言が何かは実装の自由)。
 */
export type RequiredState = 'loading' | 'empty' | 'error' | 'not_found';

/** 表示義務のある状態の値域。 */
export const REQUIRED_STATES: readonly RequiredState[] = ['loading', 'empty', 'error', 'not_found'];

/** 文字列が表示義務の語彙かを判定する。 */
export function isRequiredState(value: string): value is RequiredState {
  return (REQUIRED_STATES as readonly string[]).includes(value);
}

/** 1 つの screen_spec ファイル(= 1 画面)。 */
export interface ScreenSpec {
  /** `screen-{name をハイフン区切りにしたもの}`(例: screen-workshop-detail)。 */
  readonly id: string;
  /** 画面名(snake_case)。testid のスロットパスの先頭になる。 */
  readonly name: string;
  /**
   * 画面そのものの表示名(任意。例: 催し詳細)。部品の `label` の 1 段上で、規則も同じ「内部名で配線・
   * label で表示」— **testid にも route にも現れず**、併記するのはハンドブック(一覧・カードの見出し・
   * 遷移図の節点)だけ。空文字・全画面/全クローム間の重複は S0 がエラーにする。
   */
  readonly label?: string;
  /** URL の形(動的セグメントは `:param`。例: `/workshops/:id`)。 */
  readonly route: string;
  /** 継承する共有クローム(任意)。 */
  readonly chrome?: { readonly id: string; readonly location: SourceLocation };
  /** この画面を見るロール。グローバルロールに限る(S4)。 */
  readonly forRoles: readonly string[];
  /** ナビゲーショングラフの起点か(S3)。 */
  readonly entryPoint: boolean;
  /**
   * セッションが必須か(既定 false)。実装の `requireSession()` に対応する観測可能な事実。
   *
   * 「ログインしているか」は入場条件ではなく**この 1 つの真偽値**で表す。ガード式で
   * `actor.role != anonymous` のように書くと、ドメインに存在しないパスが仕様に住みついてしまう
   * (`actor` にロールというフィールドは無い)。
   */
  readonly requiresAuth: boolean;
  /**
   * この画面が扱う対象のエンティティ(任意)。`route` の動的セグメントが指すもの。
   *
   * `precondition` を書けるのは `subject` を宣言した画面だけで、式のパスはこのエンティティを
   * 起点に解決される(S5)。起点が無いと「`state` とは何の state か」が決まらない。
   */
  readonly subject?: { readonly entity: string; readonly location: SourceLocation };
  /** 入場条件(任意)。書いたときは subject と on_fail が必須。 */
  readonly precondition?: ScreenPrecondition;
  readonly onFail?: ScreenOnFail;
  readonly reads: readonly ScreenRef[];
  readonly actions: readonly ScreenRef[];
  /**
   * この画面から起こせる**保存点**(usecase_spec の `saves[]`)の鍵(`{ユースケース名}.{保存点 ID}`)。
   *
   * 操作(`actions`)と違い、保存点は複数の操作を 1 トランザクションで実行する(ADR-0011 §4)。
   * 宣言した保存点の各手順がこの画面の `actions` にも並んでいることは S16 が見る ——
   * **保存点を宣言した画面は、その手順を個別の操作としても持ち続けてよい**(下書き編集・
   * 世話役の代理入力の経路が要る)。
   */
  readonly usecases: readonly ScreenRef[];
  /**
   * この画面が露出するプラットフォーム操作(auth_spec の `platform_ops` の id)。`actions` と並ぶ第 3 の口で、
   * ドメインイベントでない認証基盤の操作(セッションの一覧・終了など)を宣言する。実在・ロール整合・確認の器は S20、網羅は S21 が見る。
   */
  readonly platformOps: readonly ScreenRef[];
  readonly navigations: readonly ScreenNavigation[];
  readonly overlays: readonly ScreenOverlay[];
  readonly layout: ScreenLayout;
  readonly requiredStates: readonly RequiredState[];
  readonly testCases: readonly ScreenTestCase[];
  /** E2E スモークがこの画面を通ることの宣言(任意。§ScreenSmoke)。 */
  readonly smoke: readonly ScreenSmoke[];
  /** UX 原則の受け入れ(`ux:`。任意。理由つき。U 群が読む)。 */
  readonly ux: readonly ScreenUxAccept[];
  /** specs/frontend/screens からの相対パス(例: "workshop/workshop_detail.md")。 */
  readonly relPath: string;
  readonly location: SourceLocation;
}

/** 1 つの chrome_spec ファイル(= 画面をまたいで共有するレイアウトの骨格)。 */
export interface ChromeSpec {
  /** `chrome-{name をハイフン区切りにしたもの}`(例: chrome-member)。 */
  readonly id: string;
  readonly name: string;
  /** 共有クロームの表示名(任意。例: メンバー向けクローム)。規則は ScreenSpec の label と同じ。 */
  readonly label?: string;
  readonly layout: ScreenLayout;
  /**
   * 共有部の部品から出る遷移(任意)。
   *
   * `on` は**ドットを含まない自由語彙に限る**。`{イベント ID}.success` を書けるのは
   * 「その操作を宣言している画面」だけであり(S2)、共有部は操作を持たないためである。
   * ここに書いた遷移はローダーが継承画面へ展開し、以降は画面自身の宣言と同じに扱われる。
   */
  readonly navigations: readonly ScreenNavigation[];
  /** specs/frontend/chrome からの相対パス(例: "member.md")。 */
  readonly relPath: string;
  readonly location: SourceLocation;
}

