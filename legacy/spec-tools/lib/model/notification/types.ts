/**
 * notification_spec(通知機能仕様)のモデル型。
 *
 * 通知は「形式検証できないから仕様に書かない」で済ませてきた領域であり、その結果
 * 「どの操作で誰に何が飛ぶか」がどの仕様書にも無い**暗黙の挙動**になっていた。
 * カタログはその穴を塞ぐ一級市民の宣言であり、`state_spec` の `effects` に現れる
 * 通知 ID・実装のハンドラ一覧と**双方向の閉世界**を組む(N1 + 実装側の突合テスト)。
 *
 * **語彙の線引き**: 機械が分岐に使う軸(`trigger`)だけがフレームワーク固定の値域であり、
 * 分岐に使わない軸(`medium` / `audience` / `mention`)の語彙は**カタログ文書側が宣言する**。
 * 「Discord」「運営スタッフのチャンネル」はこのアプリの事情であって、体系の一部ではない
 * (doc_types.md の「検証器がコード分岐に使う区別だけを機械が持つ」打ち切り規則と同じ線)。
 */

import type { SourceLocation } from '../types.js';
import type { ActionTestCase } from '../../testcase/types.js';

/**
 * 発火のしかたの値域(フレームワーク固定)。
 *
 * ここだけを固定するのは、**N1 がこの値で分岐する**ためである。発火元は 3 つで、値が「どれを持つか」を宣言する。
 * - `auto` … 遷移の `effects` に接続され、システムが送る(effects と 1 対 1 で閉じる。走査の `emits` が
 *   積み直すのは許す)
 * - `manual` … 下書きを作って人が送る(`effects` にも `emits` にも現れない)
 * - `schedule` … 時刻で起きる走査(`source: schedule` のジョブ)が `emits` で積む(`effects` には現れない)
 */
export const NOTIFICATION_TRIGGERS = ['auto', 'manual', 'schedule'] as const;

/** 発火のしかた。 */
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

/**
 * カタログが宣言する語彙の軸(medium / audience / mention)。
 *
 * 値の一覧を体系側に持たないための、宣言される語彙の側の名前である。
 */
export const NOTIFICATION_VOCABULARY_AXES = ['medium', 'audience', 'mention'] as const;

/** 語彙の軸。 */
export type NotificationVocabularyAxis = (typeof NOTIFICATION_VOCABULARY_AXES)[number];

/** 語彙 1 語の宣言(内部名 + 表示名)。表示名は生成物の表に出る。 */
export interface NotificationTermDecl {
  /** 内部名(スネークケース)。行の `medium` / `audience` / `mention` が指す値。 */
  readonly id: string;
  /** 表示名(任意)。宣言が無ければ内部名だけを出す。 */
  readonly label?: string;
  /**
   * `audience` の語だけが持つ、宛先の種別(実装が INV-MEMBER-005 の判定に使う)。
   * `medium` / `mention` の語は持たない。
   */
  readonly recipient?: NotificationRecipientDecl;
  /**
   * この語を選んだ行は**本人を名指す**メンションである、という宣言(`mention` の語だけが持つ。`mentions_person: true`)。
   *
   * 機械が分岐に使う軸は**この宣言**で、語の綴りは体系が比べない(`kind` の語の `in_transaction` と同じ形 —
   * 語を選べば宣言が付いてくる)。宣言した語を選んだ行は `person_from` を必ず書き、宣言の無い語の行は書けない
   * (N0)。語の綴りを体系に持たないのは、語彙 id と同じ綴りの文字列リテラルを仕組み側に置くと W1 が落とすため。
   */
  readonly mentionsPerson?: boolean;
  /**
   * この宛先の語は、本人を名指すメンション(`mentions_person` の語)と組める、という宣言(`audience` の語だけが持つ。
   * `allows_person_mention: true`。**チャンネル宛(`recipient.kind: channel`)の語だけが宣言できる**)。
   *
   * どの宛先に個人を名指してよいかは**アプリの判断**で、体系は語の綴りを比べない(`mentions_person` と同じ形)。
   * 宣言の無い宛先の行が本人を名指す語を選べば N0 が落とす(たとえば公開のチャンネルに個人を名指さない、をここで表す)。
   */
  readonly allowsPersonMention?: boolean;
}

/**
 * 本人のメンバー ID の出どころ(`person_from: {集約}.{欄}`)。
 *
 * 通知を起こしたイベントの集約の行から、その欄(メンバーへの参照)を辿って本人のメンバー行を引く。
 * 辿るのは 1 段だけである(欄は集約自身が持つ)。
 */
export interface NotificationPersonFrom {
  /** 集約(エンティティ)名。 */
  readonly entity: string;
  /** その集約の欄名。メンバー(実行者の集約)への参照でなければならない(N2)。 */
  readonly field: string;
}

/**
 * 宛先種別の値域(フレームワーク固定)。**この 3 値だけが体系の語彙**であり、
 * `role` の中身(どのロールか)はこのアプリの事情(`role` フィールド)。
 *
 * - `self`  … payload の `subject_key` が指すメンバー本人。INV-MEMBER-005 の判定対象
 * - `role`  … 特定の役割の担当者。宛先の生存は問わない(役割そのものは死なない)
 * - `channel` … 経路だけ(誰か 1 人という単位を持たない)
 */
export const NOTIFICATION_RECIPIENT_KINDS = ['self', 'role', 'channel'] as const;

/** 宛先種別。 */
export type NotificationRecipientKind = (typeof NOTIFICATION_RECIPIENT_KINDS)[number];

/** 宛先種別の宣言(`vocabulary.audience[].recipient`)。 */
export interface NotificationRecipientDecl {
  readonly kind: NotificationRecipientKind;
  /** `kind: role` のときだけ持つ、宛先のロール ID(roles.md の語彙。ここでは実在を見ない)。 */
  readonly role?: string;
  /** `kind: self` のときだけ持つ、ジョブ payload から本人のメンバー ID を取り出すキー名。 */
  readonly subjectKey?: string;
}

/** 通知 1 本の宣言。 */
export interface NotificationDecl {
  /** 通知 ID。`effects[].do` に現れる ID と同じ語彙(`notify_` で始まる)。 */
  readonly id: string;
  /** 送信経路。カタログの `vocabulary.medium` に宣言された語のいずれか。 */
  readonly medium: string;
  /** 宛先。カタログの `vocabulary.audience` に宣言された語のいずれか。 */
  readonly audience: string;
  /** 宛先種別(`audience` の語が宣言した `recipient` の写し)。実装が送達可否の判定に使う。 */
  readonly recipient: NotificationRecipientDecl;
  /** メンション。カタログの `vocabulary.mention` に宣言された語のいずれか。 */
  readonly mention: string;
  /** 発火のしかた。 */
  readonly trigger: NotificationTrigger;
  /**
   * 本人のメンバー ID の出どころ(`mention` の語が `mentions_person` を宣言しているときだけ持ち、必ず持つ)。
   * 本人を名指すメンションの相手を、通知を起こした集約の行から決める。
   */
  readonly personFrom?: NotificationPersonFrom;
  /** 1 行の説明(何を知らせるか)。 */
  readonly summary: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** カタログ 1 ファイル分の宣言。 */
export interface NotificationCatalogSpec {
  /** 文書 ID(`notification-catalog` 固定 — 1 プロジェクト 1 カタログ)。 */
  readonly id: string;
  /** 軸ごとの語彙(宣言順)。 */
  readonly vocabulary: Readonly<Record<NotificationVocabularyAxis, readonly NotificationTermDecl[]>>;
  /** 通知の全数(宣言順)。 */
  readonly notifications: readonly NotificationDecl[];
  /** テストケース宣言(実装側の突合テストを指す)。 */
  readonly testCases: readonly ActionTestCase[];
  /** 仕様ファイルの位置。 */
  readonly location: SourceLocation;
}

/** 読み込んだ通知カタログ。 */
export interface NotificationSpecModel {
  /** カタログファイルが存在したか。false なら N 群はスキップされる。 */
  readonly available: boolean;
  /** 読み込めたカタログ。スキーマ違反で構築できなければ null。 */
  readonly catalog: NotificationCatalogSpec | null;
}
