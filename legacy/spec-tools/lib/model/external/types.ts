/**
 * external_spec(外部連携カタログ)のモデル型。
 *
 * 規約(ARCH-BE-0014 / ARCH-BE-0015)はアダプタの構造・冪等キー・outbox 経由のリトライを
 * 詳細に定義していたが、**検査器はゼロで `docs/specs/backend/external.md` は不在**であり、
 * 実在する外部連携アダプタ(Discord / Anthropic / Notion / LINE)が仕様のどこにも宣言されて
 * いなかった。カタログはその穴を塞ぐ一級市民の宣言であり、notification_spec / job_spec /
 * config_spec / auth_spec / guarantee_spec と同じ「1 プロジェクト 1 カタログ・行の集合」の
 * 器であり、新しい機構ではない(6 本目)。
 *
 * **語彙の線引き**: `direction`(outbound | inbound)・`effect`(read | write)・
 * `degrade`(refuse | not_configured | fallback)・`retry`(none | job | inline)・
 * `signature`(hmac_sha256 | provider_sdk | none)は**体系側の値域**である。`service`(相手の名前。discord /
 * anthropic / notion / line …)だけが**カタログ自身の `vocabulary` が宣言する**語であり、
 * `config_spec` の `used_by` と同じ理由で体系に持たせない(アプリの事情だからである)。
 */

import type { SourceLocation } from '../types.js';
import type { ActionTestCase } from '../../testcase/types.js';
import type { ExternalSendsDecl } from './types-neutralize.js';
import type { ExternalClientUiDecl } from './types-sdk.js';
import type { ExternalAbuseDecl, ExternalAuthzDecl, ExternalSpend } from './types-paid.js';

export * from './types-neutralize.js';
export * from './types-sdk.js';
export * from './types-paid.js';

/**
 * 連携の向きの値域。
 *
 * `inbound`(受信 Webhook)は束 ⑲-2b で開いた。開けた条件は「**3 つの軸がどれも実装と
 * 突き合わされる**」ことである —— 署名検証の方式(`signature`)は受信口の生成が読み、
 * 外部イベント ID の一意制約(`event_id_table`)は data_table の宣言に接地し、
 * 外部イベント → ドメインイベントの写像(`emits`)は `by: [system]` の遷移に接地する。
 * 主張だけの宣言にならない形になった時点で軸を開ける、という予約どおりの順序である。
 */
export const EXTERNAL_DIRECTIONS = ['outbound', 'inbound'] as const;

/** 連携の向き。 */
export type ExternalDirection = (typeof EXTERNAL_DIRECTIONS)[number];

/** 外部呼び出しが外部の状態を変えるか(write は idempotency の宣言が必須)。 */
export const EXTERNAL_EFFECTS = ['read', 'write'] as const;

/** 呼び出しの効果。 */
export type ExternalEffect = (typeof EXTERNAL_EFFECTS)[number];

/**
 * 鍵(config)が無いときの挙動の値域。
 *
 * - `not_configured` … 呼ばずに `not_configured` 相当の結果を返す(失敗にしない)
 * - `fallback` … 代わりの既定の挙動で応答する(「常に在籍」「同梱の最小文書」等)
 * - `refuse` … その口自体を閉じる(産まれない・常に拒否する)
 */
export const EXTERNAL_DEGRADES = ['refuse', 'not_configured', 'fallback'] as const;

/** 縮退のしかた。 */
export type ExternalDegrade = (typeof EXTERNAL_DEGRADES)[number];

/**
 * 失敗したときの再試行の値域。
 *
 * - `none` … 再試行しない(同期呼び出しでその場に失敗が返る)
 * - `job` … outbox のリトライに委ねる(`job_spec` の `on_failure` と接続)
 * - `inline` … その場で有限回だけ再試行する(`retry_max` が必須)
 */
export const EXTERNAL_RETRIES = ['none', 'job', 'inline'] as const;

/** 再試行の方針。 */
export type ExternalRetry = (typeof EXTERNAL_RETRIES)[number];

/**
 * 二重反映を**何が**防ぐかの値域(`effect: write` の行だけが持ち、必須)。
 *
 * - `external_key` … 相手に冪等キーを渡し、相手の側で重複を潰してもらう
 *   (X6 がアダプタの実装に冪等キーの受け渡しが実在することを見る)
 * - `local_ledger` … こちら側の台帳で二重反映を防ぐ。**台帳の実在が接地条件**である ——
 *   inbound は `event_id_table` の一意制約、outbound は**アダプタが引く送信済みの台帳**
 *   (X6 がその対応を見る)。**outbox の job 行はこの台帳ではない** —— 防ぐのは同じ行を
 *   2 つのワーカーが同時に掴むことまでで、送信後にタイムアウトして失敗と記録された配信は
 *   指数バックオフで**再送**される(独立レビュー 束 ㉑ の 4-B。それまでは `retry: job` が
 *   接地条件だったので、二重反映を生む当の仕組みが「防いでいる」証拠になっていた)
 * - `none` … 防がない(**at-least-once がそのまま二重反映になる**という宣言。
 *   `idempotency_reason` が必須 —— この体系は免除に必ず理由を要求する)。
 *   `retry: job` / `inline` と組み合わさる行は「同じ知らせが二度届きうる」経路であり、
 *   ハンドブックの外部連携の章がその一覧を出す(黙らせない)
 *
 * **なぜ散文だけにしないのか。** 束 ⑳ 以前の `idempotency` は自由文 1 行であり、
 * 「outbox の job id を Webhook の冪等キーにする」と書いてあるのに実装は冪等キーを
 * 1 度も相手へ渡していない、という**主張と実装の食い違い**が誰にも見えなかった
 * (検査の漏れ探し 2026-09-12 §1)。源を値域にすると、どの値も接地先が 1 つに決まる。
 */
export const IDEMPOTENCY_SOURCES = ['external_key', 'local_ledger', 'none'] as const;

/** 二重反映を防ぐ源。 */
export type IdempotencySource = (typeof IDEMPOTENCY_SOURCES)[number];

/**
 * 受信口が検証する署名の方式の値域(`direction: inbound` の行だけが持つ)。
 *
 * - `hmac_sha256` … 共有秘密で本文の HMAC-SHA256 を計算し、ヘッダの値と定数時間で比べる
 * - `provider_sdk` … 相手の SDK が検証する(こちらは鍵を渡すだけ。実体はアダプタ)
 * - `none` … 署名が無い(**検証しない**という宣言。誰でも叩ける口になるので `signature_reason`
 *   が必須である —— この体系は免除に必ず理由を要求する)
 *
 * 方式を体系側の値域にするのは、`service` と違って**受信口の生成が分岐に使う**ためである
 * (相手の名前は分岐に使わないので語彙はカタログが持つ、という線引きと対になる)。
 *
 * **鍵は位置ではなく名前で指す**(`signature_key`)。`config` の先頭を暗黙の鍵にすると、
 * 鍵以外の設定を 1 つ足した瞬間に検証が常に落ちる(そして verify は緑のままである)。
 */
export const INBOUND_SIGNATURES = ['hmac_sha256', 'provider_sdk', 'none'] as const;

/** 署名検証の方式。 */
export type InboundSignature = (typeof INBOUND_SIGNATURES)[number];

/**
 * 遷移が拒否された(状態が合わなかった)ときに相手へ返す形の値域
 * (`direction: inbound` の行だけが持ち、必須)。
 *
 * - `retry` … 5xx を返して相手に再送させる(こちらが先に別の通知を処理しているだけで、
 *   いずれ整合する見込みがあるとき)
 * - `ack` … 2xx で閉じる(「もうその状態へ進んでいる」等、再送しても結果が変わらないとき)
 *
 * **既定を持たない。** どちらが正しいかは相手の再送の契約でしか決まらず、体系が推測すると
 * 「入金通知を黙って捨てる」か「相手の再送が永久に止まらない」のどちらかを引き当てる。
 */
export const INBOUND_CONFLICT_REPLIES = ['retry', 'ack'] as const;

/** 遷移が拒否されたときの返し方。 */
export type InboundConflictReply = (typeof INBOUND_CONFLICT_REPLIES)[number];

/**
 * カタログが宣言する語彙の軸。`service` の 1 つしか無いのは、この版の体系側の値域
 * (`direction` / `effect` / `degrade` / `retry` / `signature`)が語で分岐しないためである。
 */
export const EXTERNAL_VOCABULARY_AXES = ['service'] as const;

/** 語彙の軸。 */
export type ExternalVocabularyAxis = (typeof EXTERNAL_VOCABULARY_AXES)[number];

/**
 * `service` 語 1 件の宣言。他のカタログの語彙(`id` + 任意の `label`)と違い、
 * **`adapter_root` を必ず持つ**(X1 がこのディレクトリを閉世界の分類に使う)。
 */
export interface ExternalServiceTermDecl {
  /** 内部名(スネークケース)。`integrations[].service` が指す値。 */
  readonly id: string;
  /** 表示名(任意)。 */
  readonly label?: string;
  /** この service のアダプタが住むディレクトリ(リポジトリルート相対。X1 の閉世界の単位)。 */
  readonly adapterRoot: string;
  /** SDK のパッケージ名(`sdk_packages`。`ai` か `@scope/*`。省略は空)。値で引けるのは `adapterRoot` の下と `clientUi` だけ(X1 (d)・ESLint。B9-4)。 */
  readonly sdkPackages: readonly string[];
  /** SDK の UI 部品を値で引いてよい、自サイトの口とだけ話すクライアントの部品(`client_ui`。省略は空)。 */
  readonly clientUi: readonly ExternalClientUiDecl[];
}

/** 連携 1 件の宣言のうち、向きによらない欄。 */
interface IntegrationBase {
  /** 連携 ID(スネークケース・一意)。 */
  readonly id: string;
  /** 相手の名前。`vocabulary.service` に宣言された語のいずれか。 */
  readonly service: string;
  /** 外部の状態を変えるか。 */
  readonly effect: ExternalEffect;
  /** 業務側の IF 名(型・インターフェース名)。X1 がアダプタのファイル内に実在を見る。 */
  readonly port: string;
  /** アダプタの実装ファイル(リポジトリルート相対)。X1 が実在を見る。 */
  readonly adapter: string;
  /** 接地する config カタログの id(1 つ以上)。X2 が接地と `requirement` の食い違いを見る。 */
  readonly config: readonly string[];
  /** 鍵が無いときの挙動。 */
  readonly degrade: ExternalDegrade;
  /** 縮退の中身(散文 1 行)。`degrade: not_configured | fallback` の行だけが持つ。 */
  readonly degradeSummary?: string;
  /** 再試行の方針。 */
  readonly retry: ExternalRetry;
  /** 有限回の再試行の上限。`retry: inline` の行だけが持つ(正の整数)。 */
  readonly retryMax?: number;
  /** 冪等キーの説明(散文 1 行)。`effect: write` の行だけが持つ。 */
  readonly idempotency?: string;
  /**
   * 二重反映を**何が**防ぐか(値域)。**`effect: write` の行だけが持ち、必須**。
   * X6 が値ごとに接地先(アダプタの冪等キー / outbox / `event_id_table`)を見る。
   */
  readonly idempotencySource?: IdempotencySource;
  /**
   * なぜ二重反映を防がなくてよいか(散文 1 行)。**`idempotency_source: none` の行だけが
   * 持ち、必須**。`signature_reason` / `degrade_summary` と同じ「免除には理由」の形である。
   */
  readonly idempotencyReason?: string;
  /** 呼び出しごとの消費(`paid` だけ。R5-7 / R5-8 が見る)。 */
  readonly spend?: ExternalSpend;
  /** 有料の口の濫用の歯止めの宣言(R5-7 / R5-8)。 */
  readonly abuse?: ExternalAbuseDecl;
  /** 有料の口の枠を消費する RPC の名前(`data_table` の `kind: rpc` の関数。R5-7 が実在を・X8 が本文を見る)。 */
  readonly meter?: string;
  /** 有料の口の認可(`kind: role` と役。`public` は書けない: R5-9)。 */
  readonly authz?: ExternalAuthzDecl;
  /** 外へ出す情報。 */
  readonly sends: ExternalSendsDecl;
  /** 何をする連携かを 1 行で。 */
  readonly summary: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** 送信の連携(こちらから呼ぶ)。 */
export interface OutboundIntegrationDecl extends IntegrationBase {
  /** 向き。 */
  readonly direction: 'outbound';
  /** タイムアウト(ミリ秒)。`direction: outbound` は必須(正の整数)。 */
  readonly timeoutMs?: number;
  /**
   * この連携を使う**手書きの HTTP の入口**(Route Handler)の URL のパス(`/api/...`)。**`direction: outbound` の行だけが持ち、任意**。
   * ジョブの `endpoint` と同じく URL で名指す(受信の口は生成物で URL が決まるので持てない)。実在・衝突は J2 が見る。
   */
  readonly endpoints?: readonly string[];
}

/** 受信口の署名の検証(方式と、鍵か理由の対)。`none` だけが理由を持ち鍵を持たない(型で書き分ける。欠けた形は読み込みが落とす)。 */
export type InboundSignatureDecl =
  | {
      /** 署名検証の方式(検証する 2 つ)。 */
      readonly signature: 'hmac_sha256' | 'provider_sdk';
      /** 署名の鍵として使う設定の id(`config` に並んでいるもののいずれか。位置ではなく名前で指す)。 */
      readonly signatureKey: string;
    }
  | {
      /** 署名を検証しない(誰でも叩ける口になる)。 */
      readonly signature: 'none';
      /** なぜ署名を検証しなくてよいか(散文 1 行。理由の無い免除をこの体系は持たない)。 */
      readonly signatureReason: string;
    };

/** 受信本文の大きさの上限の既定(バイト)。緩めるのは `max_body_bytes` の宣言だけ。 */
export const DEFAULT_INBOUND_MAX_BODY_BYTES = 65_536;

/** `max_body_bytes` に書ける上限(バイト)。受信口は本文を全部メモリに載せてから署名を検証するので、天井を持つ。 */
export const MAX_INBOUND_BODY_BYTES = 16_777_216;

/** 受信の連携(向こうから届く)。受信の軸は**どれも必須**で、型で欠けない。 */
export type InboundIntegrationDecl = IntegrationBase &
  InboundSignatureDecl & {
    /** 向き。 */
    readonly direction: 'inbound';
    /**
     * 外部イベント ID の一意制約を持つ表(`data_table` の id)。冪等(同じ通知を 2 度反映しない)の実体であり、
     * X5 がその表に単一列の一意索引が**ちょうど 1 本**実在することを見る。
     */
    readonly eventIdTable: string;
    /**
     * 外部イベント → ドメインイベントの写像(`{machine}.{event}`)。screen_spec の `emits` / action_spec の
     * `handles` と並ぶ**第 3 の発火元**であり、X5 が `by: [system]` の遷移への接地を見る。
     */
    readonly emits: string;
    /**
     * 受信の複合 RPC(記録と遷移を 1 トランザクションで起こす生成物)を書き出す migration のファイル名
     * (`{14 桁}_inbound_{連携 id}.sql`)。SQL が変わる変更では名前を新しくする。
     */
    readonly migration: string;
    /** 遷移が拒否されたときに相手へ返す形(既定を持たない)。 */
    readonly onConflict: InboundConflictReply;
    /**
     * 受け取る本文の大きさの上限(バイト)。宣言が無ければ `DEFAULT_INBOUND_MAX_BODY_BYTES`(小さめ)で、
     * 緩めるのは `max_body_bytes` の宣言だけである。超えた本文は署名を検証する前に 413 で閉じる。
     */
    readonly maxBodyBytes: number;
  };

/** 連携 1 件の宣言(向きで書き分ける)。 */
export type IntegrationDecl = OutboundIntegrationDecl | InboundIntegrationDecl;

/** 受信の連携か。 */
export function isInbound(integration: IntegrationDecl): integration is InboundIntegrationDecl {
  return integration.direction === 'inbound';
}

/** カタログ 1 ファイル分の宣言。 */
export interface ExternalCatalogSpec {
  /** 文書 ID(`external-catalog` 固定 — 1 プロジェクト 1 カタログ)。 */
  readonly id: string;
  /** 軸ごとの語彙(宣言順)。 */
  readonly vocabulary: Readonly<Record<ExternalVocabularyAxis, readonly ExternalServiceTermDecl[]>>;
  /** 連携の全数(宣言順)。 */
  readonly integrations: readonly IntegrationDecl[];
  /** テストケース宣言(任意。書けば X4 が `@tc` と突合する)。 */
  readonly testCases: readonly ActionTestCase[];
  /** 仕様ファイルの位置。 */
  readonly location: SourceLocation;
}

/** 読み込んだ外部連携カタログ。 */
export interface ExternalSpecModel {
  /** カタログファイルが存在したか。false なら X 群はスキップされる。 */
  readonly available: boolean;
  /** 読み込めたカタログ。スキーマ違反で構築できなければ null。 */
  readonly catalog: ExternalCatalogSpec | null;
}
