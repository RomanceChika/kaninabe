/**
 * external_spec の**有料の口**の型(`spend` と `abuse`)。`types.ts` が束ねて再公開する(300 行の規則で分けた)。
 */

import type { SourceLocation } from '../types.js';

/**
 * 連携が**呼び出しごとにお金や枠を使う**ことの宣言の値域(`spend`)。いまの値は `paid` だけ。
 *
 * 設計: 凍結案 r5-abuse-freeze.md §2-2。**語だけ**を先に入れた —— `meter`(消費を数える RPC)・
 * `authz` は §7 の束が同じ欄の上に足す。`spend: paid` の連携がブラウザから叩かれる口(`endpoints`)を持つなら、
 * 入力の上限と回数の枠の**宣言**(`abuse`)を要求する(R5-7)。**宣言であって執行ではない**(本文を読む前の上限・課金の前の枠の消費が
 * 実装で効いているかは、この束では証明しない)。
 */
export const EXTERNAL_SPENDS = ['paid'] as const;

/** 呼び出しごとの消費。 */
export type ExternalSpend = (typeof EXTERNAL_SPENDS)[number];

/**
 * 有料の口の認可の種別(`authz.kind`)の値域。`role` = 宣言した役を持つ実行者だけ / `public` = 誰にでも開く。
 * **有料の口に `public` は書けない**(R5-9 が error にする。値域に載せるのは、無言の拒否でなく「なぜ書けないか」を名指すため)。
 * 共有秘密(`secret`)は cookie で認証するブラウザの口には当てはまらないので、いまの値域に無い。
 */
export const EXTERNAL_AUTHZ_KINDS = ['role', 'public'] as const;

/** 有料の口の認可の種別。 */
export type ExternalAuthzKind = (typeof EXTERNAL_AUTHZ_KINDS)[number];

/** 有料の口の認可の宣言(`authz`)。役は役の台帳(role_spec)のグローバルロールの ID。 */
export interface ExternalAuthzDecl {
  readonly kind: ExternalAuthzKind;
  /** `kind: role` の役の ID(`kind: public` では持たない)。 */
  readonly role?: string;
  /** 宣言の位置。 */
  readonly location: SourceLocation;
}

/** 回数の枠の鍵(誰ごとに数えるか)の値域。 */
export const QUOTA_KEYS = ['actor', 'global'] as const;

/** 回数の枠の鍵。 */
export type QuotaKey = (typeof QUOTA_KEYS)[number];

/** 有料の口の回数の枠(`abuse.quota`)。上限の数は `source`(config カタログの id)か `max`(リテラル)の**どちらか 1 つ**で持つ。 */
export interface ExternalQuotaDecl {
  /** 上限の数を持つ config の id(`max` と排他。R5-7 が実在を見る)。 */
  readonly source?: string;
  /** 上限の数そのもの(`source` と排他。1 以上の整数)。 */
  readonly max?: number;
  /** 期間の幅(`{n} {minute|hour|day}`)。 */
  readonly per: string;
  /** 数える単位。 */
  readonly key: QuotaKey;
}

/**
 * 有料の口の濫用の歯止め(`abuse`)の**宣言**。口ごとの本文の上限(バイト)と回数の枠。
 *
 * 読み込みが閉じるのは形だけで、**揃っているか**(`endpoints` の全部に上限があるか・枠が在るか)は R5-7 が見る。
 */
export interface ExternalAbuseDecl {
  /** 口(`endpoints` の URL)ごとの本文の上限(バイト。1 以上 `MAX_INBOUND_BODY_BYTES` 以下)。書かれていなければ空。 */
  readonly maxBodyBytes: Readonly<Record<string, number>>;
  /** 回数の枠(書かれていなければ undefined)。 */
  readonly quota?: ExternalQuotaDecl;
  /** 宣言の位置。 */
  readonly location: SourceLocation;
}
