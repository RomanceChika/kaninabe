/**
 * auth_spec(認証フロー仕様)のモデル型。
 *
 * 「サインインすると何が起きるか」は、これまでどの仕様書にも無い**暗黙の挙動**だった
 * (OAuth コールバックの route handler と `sign-in-sync.ts` の if の並びにしか無く、
 * 「招待を持たない人はどこへ行くのか」「無効化された人が入り直すと有効に戻るのか」は
 * 実装を読むまで分からなかった)。この仕様はその穴を塞ぐ一級市民の宣言である。
 *
 * **形の判断(なぜ「手順の列」ではなく「決定表」なのか)**: サインインの分岐は、
 * 主語の状態といくつかの補助条件で**結末が一意に決まる**。順序を持つ手順として
 * 書くと「上から何行目で止まったか」という実装の都合が仕様に住みつき、しかも
 * **1 行だけを取り出してテストで駆動できなくなる**。行ごとに終端(`lands`)まで書く
 * 決定表にすれば、宣言はそのまま検査の駆動表になる(実装との突合は
 * app 側の `sign-in-sync.test.ts` が生成物 `SIGN_IN_BRANCHES` を回して行う)。
 * これは notification / job / config と同じ「1 プロジェクト 1 カタログ・行の集合・実装と双方向に閉じる」の 4 例目であり、**新しい機構ではない**。
 *
 * **語彙の線引き**: 決定表の**軸は仕様が宣言する**(`axes[]`)。体系側が持つのは軸の種類
 * (`kind` = state / enum)・関門の対象・関門の失敗の扱いという 3 つの値域だけであり、
 * 軸の名前・値・表示名・「どの行がその軸を持つか」はすべてこのアプリの事情である。
 * かつては `member` / `invitation` という 2 語を**必須の軸名**として体系側が要求しており、招待制でないシステムは決定表を 1 行も書けなかった(束 ⑱ の実測 → 束 ⑲-2a で開いた)。
 * 一方で、主語の値(主語の軸の値 —— 状態機械の状態か enum の欄の値)と着地先(`screen`)と実行する操作(`runs`)は
 * **既存の仕様に接地する**(state_spec / screen_spec / state_spec の events)。
 */

import type { SourceLocation } from '../types.js';
import type { ActionTestCase } from '../../testcase/types.js';
import type { AuthSessionsDecl } from './sessions.js';
import type { AuthMfaDecl } from './mfa.js';
import type { AuthIdpSessionDecl } from './idp-session.js';
import type { AuthPlatformOps } from './platform-ops.js';

/**
 * 決定表の軸の種類の値域(フレームワーク固定)。
 *
 * **主語の軸**は 2 通りある。どちらも「値の全体が別の宣言から来る」ことが肝であり、
 * 値を 1 つ足したら着地の宣言が要る(H1 の全域性)という性質を失わない。
 * - `state` … 状態機械の状態 ID を値に取る(`of: {状態機械名}`)。
 * - `field` … エンティティの `enum` の欄の値を取る(`of: {エンティティ}.{欄}`)。**在籍の
 *   状態機械を持たないアプリ**(人事台帳が正で、こちらは利用可否だけを持つ等)はこちらを使う
 *   —— `state` しか無かったあいだ、そういうシステムは決定表を 1 行も書けなかった(束 ⑱ の実測)。
 * どちらも行が無いことを表す `absent` の値をあわせて宣言する(体系はこの 1 語を
 * `none` と決め打ちしない)。
 * - `enum` … 補助の軸。このアプリが宣言する閉じた値のリストを値に取る(`values`)。
 *
 * どちらも**値そのものはこのアプリの事情**であり、体系側の値域ではない
 * (notification カタログの `vocabulary` と同じ線引き)。**軸の名前も同じ**である ——
 * かつては `member`(state)と `invitation`(enum)の 2 つを**必須の軸名**として
 * ここ(体系側)が要求しており、別のシステムは自分の語で決定表を書けなかった
 * (束 ⑱ の題材 A / D が auth_spec を 1 行も書けなかった実測)。いま体系が要求するのは
 * 「**主語の軸**(`kind: state` か `kind: field`)が**ちょうど 1 本**あり、その `of` が
 * `subject` と一致すること」だけである(H0)。
 */
export const AUTH_AXIS_KINDS = ['state', 'field', 'enum'] as const;

/** 決定表の軸の種類。 */
export type AuthAxisKind = (typeof AUTH_AXIS_KINDS)[number];

/**
 * その軸を**どの行が持つか**の宣言(`when` / `optional` のどちらか。両方は書けない)。
 *
 * - `when` … 別の軸がその値のときだけ持ち、それ以外の行では**持ってはいけない**
 *   (「行が無い人だけが持つ軸」のように、**補助条件が主語に従属する**ことを宣言する。
 *   この 1 行があるおかげで、その判断が散文ではなく検査になる)。
 * - `optional` … 行ごとに任意(その条件を確かめた行だけが持つ)。
 *
 * どちらも宣言しなければ**全行で必須**である(主語の軸がその形)。
 */
export interface AuthAxisPresence {
  /** 条件付きで必須になる相手の軸 ID。 */
  readonly axis: string;
  /** 相手の軸がこの値のときだけ持つ。 */
  readonly value: string;
}

/**
 * 決定表の軸 1 本の宣言(`axes[]`)。
 *
 * 軸の ID・値・表示名・「どの行が持つか」はすべてこのアプリの事情である。体系側は
 * `kind` の 3 語(state / field / enum)しか持たない。
 */
export interface AuthAxisDecl {
  /** 軸 ID(スネークケース)。`sign_in[]` の同名キーが指す。 */
  readonly id: string;
  readonly kind: AuthAxisKind;
  /** この軸が何を表すかを 1 行で(生成物の doc コメント・分岐図の見出しに出る)。 */
  readonly summary: string;
  /**
   * 主語の軸(`kind: state` / `kind: field`)だけが持つ、値の出どころ。
   * `state` なら状態機械名、`field` なら `{エンティティ}.{欄}`。どちらも `subject` と同じ文字列。
   */
  readonly of?: string;
  /** 主語の軸だけが持つ、行(該当する値)が無いことを表す値。 */
  readonly absent?: string;
  /** `kind: enum` のときだけ持つ、値の値域。 */
  readonly values?: readonly string[];
  /** 値 → 表示名(分岐図とマトリクスに出る日本語)。宣言が無い値は値そのものが出る。 */
  readonly labels?: Readonly<Record<string, string>>;
  /** その軸を持つ行の条件(`when`)。`optional` と排他。 */
  readonly when?: AuthAxisPresence;
  /** 行ごとに任意か(`optional: true`)。`when` と排他。 */
  readonly optional?: boolean;
  readonly location: SourceLocation;
}

/**
 * 関門が守る対象の値域(画面仕様のどの宣言が関門を呼ぶか)。
 *
 * - `requires_auth` … 画面仕様の `requires_auth: true`。
 * - `role_gate` … 画面仕様の `for: [{role}]`。**どのロールを見るかは仕様側が宣言する**
 *   (`gates[].role`。かつては `role_staff` という関門名自体に `staff` を固定していた)。
 *
 * 2 本だけの**閉じた辞書**であり、新しい語彙は増やさない(新しいロールを関門にしたくなったら
 * `role_gate` の `role` を差し替えるのではなく、新しい `GateSubject` を足すかどうかを
 * auth-spec-writing.md §語彙をどちらが持つか、で判断する)。
 */
export const GATE_SUBJECTS = ['requires_auth', 'role_gate'] as const;

/** 関門が守る対象。 */
export type GateSubject = (typeof GATE_SUBJECTS)[number];

/** 関門を通れなかった人の扱いの値域。 */
export const GATE_FAILURES = ['redirect', 'not_found'] as const;

/** 関門を通れなかった人の扱い。 */
export type GateFailure = (typeof GATE_FAILURES)[number];

/** サインインの着地 1 件(結末の宣言)。 */
export interface AuthLandingDecl {
  /** 着地 ID。実装が返す着地先の語と同じ文字列(生成物経由で実装が使う)。 */
  readonly id: string;
  /** 着地する画面の screen_spec の id(H2 が実在と route を見る)。 */
  readonly screen: string;
  /** 着地する画面の排他表示(`variants`)のキー。画面が排他表示を持つときは必須(H2)。 */
  readonly variant?: string;
  /** どういう結末かを 1 行で。 */
  readonly summary: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** サインインの分岐 1 行(決定表の 1 行。条件が揃えば結末は一意)。 */
export interface SignInBranchDecl {
  /** 分岐 ID(スネークケース。生成物とテストの突合キー)。 */
  readonly id: string;
  /**
   * この行の条件(軸 ID → 値)。
   *
   * 鍵は `axes[]` で宣言された軸の ID であり、**体系側は固定の軸名を 1 つも知らない**。
   * 主語の軸(`kind: state` / `kind: field`)は必ず入っている。ほかの軸は `when` / `optional` の宣言に
   * 従って入る・入らないが決まる(H1 が見る)。
   */
  readonly values: Readonly<Record<string, string>>;
  /**
   * この行で**実行される**ドメインイベント(`{machine}.{event}`。実行しない行は空)。
   *
   * 「実行する」であって「成立する」ではない — 拒否された受諾・拒否された有効化も実行してはいる
   * (可否を決めるのは操作の側のガードであって、認証層ではない)。
   */
  readonly runs: readonly string[];
  /** 着地(`landings` の id)。 */
  readonly lands: string;
  /** 何が起きるかを 1 行で。 */
  readonly summary: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** 画面に入るときの関門 1 件(実装の `requireSession` / `requireStaff` に対応する)。 */
export interface AuthGateDecl {
  /** 関門 ID(スネークケース)。 */
  readonly id: string;
  /** 何が関門を呼ぶか(画面仕様のどの宣言か)。 */
  readonly guards: GateSubject;
  /**
   * `guards: role_gate` のときだけ持つ、画面仕様の `for: [...]` が見るロール ID(roles.md の任意のロール)。
   * `guards: requires_auth` は持たない(ロールを見ない関門なので意味を持たない)。
   */
  readonly role?: string;
  /** 通れなかった人の扱い。 */
  readonly onFail: GateFailure;
  /** 送り先の画面 id(`on_fail: redirect` のときだけ持つ。H2 が実在と自己参照を見る)。 */
  readonly to?: string;
  /** 実装(リポジトリルート相対パス`::`関数名)。H2 が実在を見る。 */
  readonly implementation: string;
  /** どういう関門かを 1 行で。 */
  readonly summary: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/**
 * OAuth の帰り道(プロバイダから戻ってきた人を受ける HTTP の入口)の宣言(`callback`。開始 `start`・ログアウト `logout` も同じ形)。
 *
 * サインインの分岐(`sign_in`)は「戻ってきた人が誰で、どこへ着くか」を宣言するが、**戻ってくる口そのもの**(URL)はどの宣言にも無かった。
 * ジョブの `endpoint` と同じく URL は中立に書き(置き場は配置が決める)、HTTP の入口の閉世界(J2 の続き)が認証の入口として数える。
 */
export interface AuthCallbackDecl {
  /** 口の URL のパス(`/api/...`)。 */
  readonly endpoint: string;
  /** どういう口かを 1 行で。 */
  readonly summary: string;
  /** `logout` だけが持つ、ログアウトの操作の名前(クロームの `navigations[].on`。例: `signed_out`)。H8 が見る。 */
  readonly control?: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** ローカルでだけ開けてよい方式 1 件(`local_only[]`)。 */
export interface LocalOnlyDecl {
  readonly method: string;
  /** 開けてよい理由(空でない)。 */
  readonly reason: string;
}

/** 認証フロー仕様 1 ファイル分の宣言。 */
export interface AuthFlowSpec {
  /** 文書 ID(`auth-flow` 固定 — 1 プロジェクト 1 フロー)。 */
  readonly id: string;
  /**
   * 分岐の主語の出どころ。状態機械名(例: `membership`)か `{エンティティ}.{欄}`
   * (例: `staff_member.access`)。主語の軸の `of` と一致していなければならない(H0)。
   * H1 が実在と全域性を見る。
   */
  readonly subject: string;
  /** 受け入れるサインインの方式(宣言順。空でない。語はプラットフォームの設定の綴り)。開いている方式の全数がここに収まっていること(H5)を後段の検査が見る。 */
  readonly providers: readonly string[];
  /** ローカル(開発・テスト)の設定でだけ開けてよい方式と理由(宣言順。`providers` と重ならない)。deploy 先には使えない。空でなければ実行ログが毎回「本番は未検証」と名指す。 */
  readonly localOnly: readonly LocalOnlyDecl[];
  /** 決定表の軸の宣言(宣言順)。軸の名前・値・表示名の正はここだけである。 */
  readonly axes: readonly AuthAxisDecl[];
  /** 着地の全数(宣言順)。 */
  readonly landings: readonly AuthLandingDecl[];
  /** 分岐の全数(宣言順。順序に意味は無い — 条件で一意に決まる)。 */
  readonly branches: readonly SignInBranchDecl[];
  /** 関門の全数(宣言順)。 */
  readonly gates: readonly AuthGateDecl[];
  /** 認証の口(どれも任意・同じ形): OAuth の帰り道 `callback`・サインインの開始 `start`・ログアウト `logout`。`callback` を書くなら `start` と `logout` も要る(H0)。どれもサーバーの口(server-only-session.md)。 */
  readonly callback?: AuthCallbackDecl;
  readonly start?: AuthCallbackDecl;
  readonly logout?: AuthCallbackDecl;
  /** セッションの寿命・多要素認証・IdP とのセッションの関係(sessions・mfa・idpSession は必須。読めなければ H0 が言い、ここは欠ける。設定との突合は H5、多要素認証の送り先と外す宣言の警告は H6)。`platformOps` は任意(認証基盤の操作を画面から叩く閉じた一覧。H9・S20・S21)。 */
  readonly sessions?: AuthSessionsDecl;
  readonly mfa?: AuthMfaDecl;
  readonly idpSession?: AuthIdpSessionDecl;
  readonly platformOps?: AuthPlatformOps;
  /** テストケース宣言(実装側の突合テストを指す)。 */
  readonly testCases: readonly ActionTestCase[];
  /** 仕様ファイルの位置。 */
  readonly location: SourceLocation;
}

/**
 * **主語の軸**(`kind: state` か `kind: field` の軸)。決定表の全域性はこの軸について見る。
 * H0 が「ちょうど 1 本あること」を見ているので、最初の 1 本を返すだけでよい(無ければ undefined —— H0 が報告済みで、H 群は積み増さない)。
 */
export function subjectAxis(flow: AuthFlowSpec): AuthAxisDecl | undefined {
  return flow.axes.find(isSubjectKind);
}

/** その軸が主語の軸か(値の全体が別の宣言から来る 2 種)。 */
export function isSubjectKind(axis: AuthAxisDecl): boolean {
  return axis.kind === 'state' || axis.kind === 'field';
}

/**
 * 値と持つ行をこの仕様が**直接宣言する軸**(`kind: enum`。主語の軸ではない軸)。
 *
 * 値の全体が別の宣言(状態機械・enum の欄)から来る主語の軸と違い、値域・`when` / `optional` の宣言に
 * 照合相手が無い(全域性検査 H1 はこの宣言を前提にする側)。だから読み方の分類では公理に置く(`auth.condition`)。
 */
export function declaredAxes(flow: AuthFlowSpec): readonly AuthAxisDecl[] {
  return flow.axes.filter((axis) => !isSubjectKind(axis));
}

/**
 * 主語の軸が宣言した「その行が無いこと」を表す値(値の正は `axes`。かつては `'none'` を体系側に固定していた)。
 * 宣言が無ければ空文字を返す(どの状態とも一致しないので、全域性の指摘が素直に出る)。
 */
export function absentValue(flow: AuthFlowSpec): string {
  return subjectAxis(flow)?.absent ?? '';
}

/** その軸が取り得る値(主語の軸は `absent` だけが分かる —— 残りは H1 がドメイン仕様から見る)。 */
export function axisValues(axis: AuthAxisDecl): readonly string[] {
  if (axis.kind === 'enum') return axis.values ?? [];
  return axis.absent === undefined ? [] : [axis.absent];
}

/** 値の表示名(`labels` の宣言が無ければ値そのもの)。 */
export function axisLabel(axis: AuthAxisDecl, value: string): string {
  return axis.labels?.[value] ?? value;
}

/** 読み込んだ認証フロー仕様。 */
export interface AuthSpecModel {
  /** 仕様ファイルが存在したか。false なら H 群はスキップされる。 */
  readonly available: boolean;
  /** 読み込めた宣言。スキーマ違反で構築できなければ null。 */
  readonly flow: AuthFlowSpec | null;
}
