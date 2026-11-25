/**
 * guarantee_spec(安全性の保証台帳)のモデル型。
 *
 * 「設計で不可能にした事実」は、これまでどの仕様書にも無い**主張だけの安全性**だった
 * (「RLS を有効にしてある」「書き込みは RPC 経由だけ」は口頭や README の一文でしか
 * 確認できず、消えても誰も気づかなかった)。カタログはその穴を塞ぐ一級市民の宣言であり、
 * **1 行(1 保証)ごとに見張りテストの宣言を必須にする**ことで、「保証している」を
 * 目録にする(見張りテストを宣言していない保証は主張しているだけなのでエラーになる)。
 *
 * notification_spec / job_spec / config_spec / auth_spec と同じ「1 プロジェクト 1 カタログ・
 * 行の集合」の器であり、新しい機構ではない。
 *
 * **語彙の線引き**: `status`(`enforced` / `planned`)だけが体系側の値域である
 * (Z0 / Z2 と生成物がこの値で分岐する)。`enforcer`(執行者)はカタログ自身の
 * `vocabulary` が宣言する(`config_spec` の `used_by` と同じ — 検査器は語で分岐しない)。
 */

import type { SourceLocation } from '../types.js';
import type { ActionTestCase } from '../../testcase/types.js';

/**
 * カタログが宣言する語彙の軸。
 *
 * `enforcer` の 1 つしか無いのは、Z0〜Z2 のどれもこの軸の値で分岐しないためである
 * (`config_spec` と同じ理由。「執行者は何か」はこのアプリの事情であって体系の一部ではない)。
 */
export const GUARANTEE_VOCABULARY_AXES = ['enforcer'] as const;

/** 語彙の軸。 */
export type GuaranteeVocabularyAxis = (typeof GUARANTEE_VOCABULARY_AXES)[number];

/** 語彙 1 語の宣言(内部名 + 表示名)。表示名は生成物の表に出る。 */
export interface GuaranteeTermDecl {
  /** 内部名(スネークケース)。保証の `enforced_by` が指す値。 */
  readonly id: string;
  /** 表示名(任意)。宣言が無ければ内部名だけを出す。 */
  readonly label?: string;
}

/**
 * 保証の執行状態の値域(フレームワーク固定)。
 *
 * - `enforced` … いま守られている。見張りテスト(`canaries`)が 1 つ以上必須
 * - `planned` … まだ執行されていない。`planned_reason` が必須で、Z2 が毎回 warning を出す
 *   (免除の口は無い。消し込まれるまで出続ける)
 */
export const GUARANTEE_STATUSES = ['enforced', 'planned'] as const;

/** 保証の執行状態。 */
export type GuaranteeStatus = (typeof GUARANTEE_STATUSES)[number];

/** 保証 1 件の宣言。 */
export interface GuaranteeDecl {
  /** 保証 ID(スネークケース・一意)。 */
  readonly id: string;
  /** 何が起こりえないか(人間向けの短い言い切り)。 */
  readonly label: string;
  /** 執行者(1 つ以上)。カタログの `vocabulary.enforcer` に宣言された語のいずれか。 */
  readonly enforcedBy: readonly string[];
  /** 執行状態。 */
  readonly status: GuaranteeStatus;
  /** 見張りテストの ID(`test_cases` の id)。`status: enforced` の行だけが持つ。 */
  readonly canaries?: readonly string[];
  /** まだ執行されていない理由。`status: planned` の行だけが持つ。 */
  readonly plannedReason?: string;
  /** どういう保証かを 1 行で。 */
  readonly summary: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** カタログ 1 ファイル分の宣言。 */
export interface GuaranteeCatalogSpec {
  /** 文書 ID(`guarantee-catalog` 固定 — 1 プロジェクト 1 カタログ)。 */
  readonly id: string;
  /** 軸ごとの語彙(宣言順)。 */
  readonly vocabulary: Readonly<Record<GuaranteeVocabularyAxis, readonly GuaranteeTermDecl[]>>;
  /** 保証の全数(宣言順)。 */
  readonly guarantees: readonly GuaranteeDecl[];
  /** テストケース宣言(見張りテストの実装を指す)。 */
  readonly testCases: readonly ActionTestCase[];
  /** 仕様ファイルの位置。 */
  readonly location: SourceLocation;
}

/** 読み込んだ保証台帳。 */
export interface GuaranteeSpecModel {
  /** カタログファイルが存在したか。false なら Z 群はスキップされる。 */
  readonly available: boolean;
  /** 読み込めたカタログ。スキーマ違反で構築できなければ null。 */
  readonly catalog: GuaranteeCatalogSpec | null;
}
