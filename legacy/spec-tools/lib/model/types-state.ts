/**
 * state_spec(docs/specs/domain/{aggregate}/states.md)の型。
 *
 * 状態機械と遷移の実行権限。遷移表・状態遷移図の生成と V3〜V8 の入力になる。
 * 入口は types.ts(ファサード)。スキーマの正:
 * docs/rules/process/common/specification/standards/domain-spec-writing.md
 */

import type { CopyAccept } from './parse-copy-accept.js';
import type { SelfAssignDecl, SourceLocation } from './types-common.js';

/**
 * 状態の「色」(tone)。値域 — `negative` 以外は書かない(省略時が `neutral`)。
 *
 * メンバーの使い勝手ではなく**方針の導出**(action-spec-writing.md「方針の導出」)の入力であり、
 * `negative` への遷移は無条件で `confirm_required` になる。自由記述にすると「どの色が
 * どんな見た目か」が読み手ごとにずれるため、語彙を 1 語(`negative`)だけに絞ってある。
 */
export const STATE_TONES = ['negative'] as const;

/** 状態の tone。 */
export type StateTone = (typeof STATE_TONES)[number];

/**
 * settles の語彙 1 語の宣言(内部名 + 表示名)。
 *
 * `settles` を持つ状態への遷移は無条件で `confirm_required` になる
 * (action-spec-writing.md「方針の導出」)。**何を確定させるか(`fees` 等)はこのアプリの事情**
 * であり、体系側の値域ではない(notification の `vocabulary` と同じ線引き)。
 * `label` は確認文言の定型(`「{label}がこの時点で確定します。」`)に直接使うため必須。
 */
export interface SettlesTermDecl {
  /** 内部名(スネークケース)。状態の `settles:` が指す値。 */
  readonly id: string;
  /** 表示名(確認文言に載る)。 */
  readonly label: string;
}

/** 状態機械のイベント(遷移)定義。 */
export interface EventDef {
  readonly id: string;
  /** 人間向けの日本語名(例: "提出")。生成ドキュメント用で、検証には使わない。 */
  readonly label?: string;
  /** 遷移元状態(1 つ以上) */
  readonly from: readonly string[];
  /** 遷移先状態(1 つ) */
  readonly to: string;
  /** 実行を許可するロール ID のリスト(空はスキーマ違反) */
  readonly by: readonly string[];
  /** ガード式(生文字列)。パースは guard モジュールが行う。 */
  readonly guard?: string;
  /** from に無い全状態を包括的に禁止する理由。個別理由は forbidden で上書きできる。 */
  readonly otherwiseForbidden?: string;
  /**
   * **この遷移が実行者を書き留める自分の列**(`records_actor`)。
   *
   * 遷移の RPC が状態列のほかに `p_{列}` を受け取ることがある(対応者・担当者)。その値は
   * 入力にも DB にも無く、**その遷移を起こした人そのもの**である。「どの遷移がその列を書くか」は
   * イベントごとに違う(対応開始は書くが再開は書かない)ので、集約単位の `access_spec.writes`
   * では表せない —— ここがイベント単位の唯一の宣言である。
   *
   * 宣言に無い列を RPC が引数に持つなら、その遷移は**その列を書かない**(実行器は null を渡す)。
   * 接地(実在・`ref(実行者の集約)`・`writes` の `by: system` にあること)は V19 が見る。
   */
  readonly recordsActor?: readonly string[];
  /**
   * **この遷移が「いま」を書き留める自分の列**(`records_time`)。
   *
   * `records_actor` の対である。行を**作る**ときは `effects[].snapshot` の `from: now` で
   * 「いま」を書けたのに、行を**動かす**ときだけ書けなかった —— 遷移が自分の行に書く値の
   * 種類は「実行者 / いま / 空 / 別集約の写し / 純関数の値 / 入力の値」の 6 つで閉じており、
   * そのうち「いま」だけが遷移の側に置き場を持っていなかった
   * (docs/design/triage-transition-writes-2.md §2 の全数表)。ここがその置き場である。
   *
   * **`records_actor` と違って RPC の引数は増えない** —— 値は SQL の `now()` であり、
   * 呼び出し側から届くものではない(生成される UPDATE は `clears` と同じ形の
   * `case when p_event_id in (…) then now() else t.{列} end`)。
   *
   * 接地(実在・`datetime` 型・行で必ず値がある列でないこと・`writes` の `by: system` に
   * あること・`records_actor` / `clears` と同じ列を重ねないこと)は V19 が見る。
   */
  readonly recordsTime?: readonly string[];
  /**
   * **この遷移が空にする自分の列**(`clears`)。
   *
   * `records_actor` の裏返しである。遷移の RPC が受け取る自集約の列を、その遷移が
   * 「触れない」のか「空にする」のかは**業務上の事実**であり(紐付けを外す遷移は
   * 紐づくアカウントの列を空にする)、いままでは RPC の本文だけがそれを知っていた ——
   * 計画はどちらの場合も空を渡すので、同じ宣言の不在が正反対の結果を生んでいた
   * (独立レビュー 5-A)。ここがその 1 行である。
   *
   * 宣言の**無い**列は「触れない」であり、RPC は `coalesce` でそれを実現する。宣言のある列は
   * 代入である。どちらであるかは rpc-parity が実 DB の本文と突き合わせる。接地(実在・
   * 空にできること・`writes` の `by: system` にあること)は V19 が見る。
   */
  readonly clears?: readonly string[];
  /**
   * **役の根拠の欄をこの遷移の実行者が書いてよいことの、理由つき受け入れ**(`self_assign: [{ field, role, by, reason }]`。欄 × 役を名指す。R2)。
   *
   * 役の根拠の欄(`claim` の欄・`binding` の欄・`actor.{欄}` の欄)は、その役を持つか含意する役と、追える内部実行の
   * 入口だけが書ける。ほかの書き手が書く規則(作った人が自分を所有者にする・自分の状態を戻す・所有者を指名する)は、
   * そのイベントに理由を書いたときだけ通る。書いたのに根拠の欄を書かない規則は、腐った受け入れとして R2 が止める。
   */
  readonly selfAssign?: readonly SelfAssignDecl[];
  /**
   * **未ログインに開く書き込みの、理由つき受け入れ**(`public: 理由`。R5-5)。
   *
   * `by` に未ログインのロールがいる遷移は、意図して開いているときだけこの場所に理由を書いて通す。
   * 未ログインのロールでない規則に書いた `public` は、腐った受け入れとして R5-6 が止める。
   */
  readonly public?: string;
  readonly location: SourceLocation;
}

/** 明示的な禁止(状態ごとに理由を分けたい場合)。 */
export interface ForbiddenDef {
  readonly event: string;
  readonly from: readonly string[];
  readonly reason: string;
  readonly location: SourceLocation;
}

/**
 * スナップショットの写像 1 列分(写像元 → 写像先)。
 *
 * **式ではなく列の対応表である。** 変換(匿名化・連結・切り詰め)の中身はここに書けず、
 * `do` に並ぶ副作用 ID の実装が持つ(その正しさは不変条件とプロパティテストが守る)。
 */
export interface SnapshotFieldMap {
  /** 写像元。`{entity}.{field}` の 2 段、または予約語 `now`(この写しを作った時刻)。 */
  readonly from: string;
  /** 写像先のフィールド名(`to` のエンティティの裸のフィールド名)。 */
  readonly to: string;
  /** 隠し列・個人列の約束が写し先で崩れることの理由つき受け入れ(任意。V12 ⑥ が接地を見る。A12-2)。 */
  readonly accept?: readonly CopyAccept[];
  readonly location: SourceLocation;
}

/**
 * `effects[].snapshot`。その遷移が作るスナップショット行の列対応表(C-29)。
 *
 * 公開時Fix(迂回パターン P-1)の代償を宣言に載せるための欄である。写しの集約に列を足しても
 * 何も鳴らない、という穴(C-29a)を V12 が塞ぐ。
 */
export interface SnapshotDef {
  /** 写像先のエンティティ名(公開側集約)。 */
  readonly to: string;
  /** 列の対応表。写像先の非 auto フィールドを全部覆っていないと V12 が警告する。 */
  readonly fields: readonly SnapshotFieldMap[];
  readonly location: SourceLocation;
}

/** イベント発火時の副作用(outbox ジョブ ID)。実体は backend/external 仕様側が定義する。 */
export interface EffectDef {
  readonly on: string;
  readonly do: readonly string[];
  /** その副作用がスナップショット行を作る場合の列対応表(任意)。 */
  readonly snapshot?: SnapshotDef;
  readonly location: SourceLocation;
}

/** states.md。集約ごとに 0..n 個の状態機械(複数の直交状態フィールドに対応)。 */
export interface StateMachineSpec {
  readonly machine: string;
  readonly states: readonly string[];
  /**
   * 状態 ID → 人間向け日本語名(例: draft → "下書き")。
   * label を持たない状態はキー自体が無い。生成ドキュメント用で、検証には使わない。
   * (states を string[] のまま保ち検証器への波及を避けるため、別マップで持つ)
   */
  readonly stateLabels: Readonly<Record<string, string>>;
  /**
   * 状態 ID → tone(`negative` を持つ状態のみキーを持つ)。
   * 省略時(キーが無い)は `neutral` を意味する(action-spec-writing.md「方針の導出」)。
   */
  readonly stateTone: Readonly<Record<string, StateTone>>;
  /**
   * 状態 ID → settles(その状態への遷移が確定させるものの一覧。書かれた状態のみキーを持つ)。
   * 空(キーが無い)は「何も確定させない」を意味する(action-spec-writing.md「方針の導出」)。
   * 値は `settlesVocabulary` に宣言された id。
   */
  readonly stateSettles: Readonly<Record<string, readonly string[]>>;
  /**
   * settles の語彙(id → 表示名)。この state_spec ファイルが宣言したもの(`vocabulary.settles`)。
   * `stateSettles` の値はここに宣言された id でなければならない(V1)。
   */
  readonly settlesVocabulary: Readonly<Record<string, string>>;
  /**
   * 節の要約(この状態機械は何を管理するか)。**人が書く文**で、ハンドブックのライフサイクルの節に出る
   * (book-human-face.md §2)。検証には使わない(文書の欄)。書かなければ「(まだ書かれていない)」と出る。
   */
  readonly summary?: string;
  /**
   * 状態 ID → 段の場面(その段で何が起きているか)。**人が書く文**で、ハンドブックの段ごとに出る。
   * 書かれた状態のみキーを持つ。検証には使わない(文書の欄。`stateLabels` と同じ置き方)。
   */
  readonly stateSummaries: Readonly<Record<string, string>>;
  readonly initial: string;
  readonly final: readonly string[];
  readonly events: readonly EventDef[];
  readonly forbidden: readonly ForbiddenDef[];
  readonly effects: readonly EffectDef[];
  readonly location: SourceLocation;
}
