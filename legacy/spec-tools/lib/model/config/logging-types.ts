/**
 * config_spec の **ログの目録の宣言**(`logging:`。ASVS V16.1.1 / V16.4.3)のモデル型。
 *
 * `types.ts` が 300 行を超えないよう、ログの目録の型だけをここに分けた(`types.ts` が再輸出するので、使う側の import は変わらない)。
 */

import type { SourceLocation } from '../types.js';

/**
 * ログの形式の値域(**体系側が持つのはこれだけ**)。`json_lines` = 1 行 1 JSON(ログ処理系が読める共通の形式。ASVS V16.2.4)。
 * 実行時の出力(`@kaninabe/runtime/security-log` の `stdoutLogger`・製品の出力口)がこの形で出す。
 */
export const CONFIG_LOG_FORMATS = ['json_lines'] as const;

/** ログの形式。 */
export type ConfigLogFormat = (typeof CONFIG_LOG_FORMATS)[number];

/**
 * ログの送り方の値域(**体系側が持つのはこれだけ**。送り先のサービス名は宣言の `label` に書き、体系は知らない)。
 *   - `app_direct` … アプリから直接ホストの外の収集先へ送る(鍵は環境変数。`key_env` がその名前。鍵が無ければ送らない = オプトイン)
 *   - `host_drain` … 配置先のログドレインに任せる(配置先の管理画面で設定する。アプリは鍵を持たない)
 */
export const CONFIG_LOG_SINK_MODES = ['app_direct', 'host_drain'] as const;

/** ログの送り方。 */
export type ConfigLogSinkMode = (typeof CONFIG_LOG_SINK_MODES)[number];

/**
 * ログの転送先の宣言の 3 つの形。
 *   - `none` … 転送先を書いていない(`required_in` があれば K5 が警告する)
 *   - `forward` … 転送先を宣言している
 *   - `exempt` … 本番でも転送先を要らないと、理由つきで外している(K5 が毎回「受け入れた危険」として名指す)
 */
export type ConfigLogDestination =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'forward';
      /** 送り方。 */
      readonly mode: ConfigLogSinkMode;
      /** 転送先の呼び名。 */
      readonly label: string;
      /** 転送先がアプリの動くホストの外にあるか(`true` でなければ、侵入されたときにログごと失う)。 */
      readonly offHost: boolean;
      /** `app_direct` の鍵の環境変数名(`variables` の行。`host_drain` では無い)。 */
      readonly keyEnv: string | null;
      /** 転送先を設定する場所(管理画面・CLI など。設定の値は書かない)。 */
      readonly configuredIn: string;
    }
  | { readonly kind: 'exempt'; readonly reason: string; readonly location: SourceLocation };

/** ログの転送先の宣言(`logging.sink`)。 */
export interface ConfigLogSinkDecl {
  /** 転送先を必須にする置き場(`vocabulary.target` の語)。**空なら本番を宣言していない**(K5 は何も言わない)。 */
  readonly requiredIn: readonly string[];
  /** 転送先(あるか・どこか・外しているか)。 */
  readonly destination: ConfigLogDestination;
}

/**
 * ログの目録の宣言(ASVS V16.1.1 / V16.4.3)。何を出すか(事象の目録)は仕組みが持つので宣言しない。
 * 転送先が本当に設定されているかは、プラットフォームの管理画面にあって検査から見えない(K5 が毎回「未検証」と名指す)。
 */
export interface ConfigLoggingDecl {
  /** どの形式で出すか。 */
  readonly format: ConfigLogFormat;
  /** どこへ送るか(別の系の転送先と、それを必須にする本番の置き場)。 */
  readonly sink: ConfigLogSinkDecl;
  /**
   * 死んだジョブ(dead letter)の知らせ先(`logging.dead_letter_alert`。形は `sink` と同じ)。省略は `sink` と同じ置き場を必須にし、宛先なしと読む(K5 が警告する)。
   * エラーのログは宣言によらず必ず出る。宛先はそれを人へ届ける口で、鍵が設定されたときだけ送る。
   */
  readonly deadLetterAlert?: ConfigLogSinkDecl;
  /** 何日残すか。 */
  readonly retention: { readonly days: number; readonly reason: string };
  /** 誰が読めるか(呼び名。権限の付与は運用)。 */
  readonly readers: readonly string[];
  /** 宣言の位置。 */
  readonly location: SourceLocation;
}

