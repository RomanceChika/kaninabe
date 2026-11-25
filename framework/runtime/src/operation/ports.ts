/**
 * operation が要求する外部依存のインターフェース（ポート）。
 *
 * 実装は infrastructure に置き、composition が配線する。この向き（依存性逆転）により
 * operation は具象を知らずに済み、テストでは任意の実装を引数で渡せる。
 *
 * 集約ごとのポートは ARCH-BE-0001 のとおり `src/operation/{aggregate}/ports.ts` に置く。
 * ここには集約に属さない横断的なポートだけを置く。
 */

import type { ActionError } from '../domain/result';

import type { CommitOutcome } from './commit-outcome';
import type { RefusalCode, SecurityEventId } from './security-events';
import type { Json, RpcReturn } from './wire-types';

export type { Change, Json, NonNullJson, Presence, RpcArg, RpcReturn } from './wire-types';
export type {
  CommitOutcome,
  CommitReceipt,
  SettledOutcome,
  TransportFailed,
  UnknownFailure,
  UsecaseCallOutcome,
} from './commit-outcome';
export { DbInfrastructureError, receiptOf, settle } from './commit-outcome';

/**
 * 現在時刻の取得口。
 *
 * ドメイン仕様DSLの予約語 `now`（締切ガード等）に対応する注入点。
 * domain は日時の取得を行わない（`now` は引数で受ける）ため、時刻は必ずここを通す。
 */
export interface Clock {
  /**
   * 現在時刻を返す。
   *
   * @returns 評価時点の時刻
   */
  now(): Date;
}

/**
 * **`claim:` で宣言された行属性ロールが立つか**の読み取り（行属性で決まるロールの解決）。
 *
 * グローバルロールは実行者自身の 1 ビットで決まる（roles.md の `claim: {集約}.{欄}`）。対象の列との
 * 突合で決まる文脈依存ロールと違い、根拠は実行者の行の欄ひとつしかない。したがってこの口は
 * **どの集約にも属さない** —— `Clock` / `Logger` と同じくここに置く（集約ごとの `ports.ts` に写すと、
 * 同じ 1 ビットの読み取りが集約の数だけ増える）。
 *
 * 実行者の集約のリポジトリを丸ごと渡さないのは、ロールの解決に要るのがこの 1 ビットだけ
 * だからである（書き込み口まで見えてしまう。PRIN-0010）。実装は製品の
 * `infrastructure/{実行者の集約}/{集約}.repository.ts` に置く。
 *
 * **名前は仕組みの語である**（束 ①-d 手 2 で改名した）。かつては製品の役割名を名前に使っていたが、
 * それは「軸は仕組み・語はアプリ」の破れであり、**W1 は文字列リテラル・W2 は散文しか見ないので
 * 識別子は落ちなかった**（束 ①-c-b の実測。設計メモ §9-12）。宣言の語彙に合わせた語は
 * `claim` である —— `roles.md` の `claim:` キー、生成物の `claimField`、RLS のオラクルが読む根拠（`basis: 'claim'`）と同じ語で、
 * 「どのロールか」は製品が配線で決める（この口は 1 ロールぶんの 1 ビットしか知らない）。
 *
 * **先行実装との関係**: 集約ごとの `ports.ts` に同じ形の IF が個別に宣言されている製品が
 * ありうる（構造的部分型なので実装は共通）。それらをこの宣言に寄せるのは別作業である。
 */
export interface ClaimRoleReader {
  /**
   * その実行者に、配線されたロールの根拠（行属性）が立つかを返す。
   *
   * @param actorId - 実行者の識別子
   * @returns 根拠が立つなら `true`（実行者の行が無い場合も `false`）
   */
  holdsClaimRole(actorId: string): Promise<boolean>;
}

/**
 * ログの重大度。
 *
 * `warn` は「仕様どおりに拒否された」＝ 起きてよいこと、`error` は「起きてはいけないこと」に使う。
 * 拒否を `error` に混ぜると、監視の閾値が拒否の多さで決まってしまう。
 */
export type LogLevel = 'info' | 'warn' | 'error';

/**
 * 構造化ログ 1 行の形。**フィールドはこの値域だけ**である。
 *
 * 正は
 * [logging.md](../../../docs/rules/process/backend/system/standards/conventions/logging.md)。
 * 各フィールドの値は**仕様に実在する ID**（ドメインイベント ID・`INV-*`・`effects[].do` の
 * 副作用 ID）であり、実装が発明した語彙ではない（PRIN-0008）。値域であること自体が
 * 執行機構である——新しい観測項目を足すには、この型に足す＝規約を改訂することになる。
 *
 * キーが snake_case なのは、これが TS の内部語彙ではなく**ログを検索するときに打つ名前**
 * だからである。
 */
export interface LogRecord {
  /** 重大度。 */
  readonly level: LogLevel;
  /** ドメインイベントID（`{集約}.{操作}`）。 */
  readonly event?: string;
  /** operation 関数名（`layer/operation-naming` がイベントIDと一致させている名前）。 */
  readonly operation?: string;
  /** 実行者の識別子。`null` は system（Cron・ワーカーなど、人間の実行者がいない経路）。 */
  readonly actor_id?: string | null;
  /** 対象の集約名（仕様が宣言した集約の id）。 */
  readonly entity?: string;
  /** 対象の識別子。 */
  readonly entity_id?: string;
  /** 拒否の分類（`ActionError` の 4 分類）。 */
  readonly error_kind?: ActionError['kind'];
  /** 破られた不変条件のID（`INV-{集約}-002`）。 */
  readonly invariant?: string;
  /** セキュリティの事象のID（`security-events.ts` の目録。拒否・認証・出どころの確認の行だけが持つ）。 */
  readonly security_event?: SecurityEventId;
  /** 拒否の分類コード（`security-events.ts` の `RefusalCode`。`error_kind` より細かい: 権限と多要素認証、状態とガード）。 */
  readonly refusal_code?: RefusalCode;
  /** 認証の結末（サインインの帰り道なら認証フロー仕様の決定表の着地、失敗なら固定のコード）。トークン・メールアドレスは載せない。 */
  readonly decision?: string;
  /** 要求の識別子（配置先が付けた ID。無ければ `null`）。同じ要求の行どうし、配置先の要求ログと突き合わせる鍵。 */
  /** 一時的な失敗が書けたかどうか(`not_committed` / `unknown`。点検 21 回目 B の O21-1)。 */
  readonly commit?: 'not_committed' | 'unknown';
  readonly request_id?: string | null;
  /** ジョブ識別子（`jobs.id`）。 */
  readonly job_id?: string;
  /** ジョブ種別（`state_spec` の `effects[].do`）。 */
  readonly job_type?: string;
  /** 所要時間（ミリ秒）。 */
  readonly duration_ms?: number;
  /**
   * 人間が読むための添え物。**機械はこれを読まない**。
   *
   * 構造化フィールドに載せる語彙が仕様に無いもの（外部から飛んできた例外の文言など）の
   * 置き場であり、ここに書いた内容を後から集計・分類できるとは考えない。集計したくなったら、
   * それは `LogRecord` にフィールドを足す＝規約を改訂する話である。
   */
  readonly message?: string;
}

/**
 * 構造化ログの出力口。
 *
 * 標準出力への書き出しは外界への I/O なので、operation は口だけを知る（ARCH-BE-0001）。
 * 実装は `src/infrastructure/console-logger.ts`。
 */
export interface Logger {
  /**
   * 1 件分の記録を出す。
   *
   * @param record - 出力する構造化レコード（フィールドは `LogRecord` の値域）
   */
  write(record: LogRecord): void;
}

/**
 * 読んだ 1 行の値（ガード式が扱えるスカラーだけ）。
 *
 * `Json` の部分集合である（配列・オブジェクトは載せない）。
 */
export type FactScalar = string | number | boolean | null;

/**
 * 保存点の `permit` が要る「保存点の外の行」を読む口（束⑯c / ③-e2A で 1 本に統合）。
 *
 * 集約ごとのリーダーと違い、**表名も列名も引数で受ける** —— 何を読むかは仕様から導いた
 * 実行計画（`@/domain/generated/usecase-plans` の `reads`）が決めるからである。保存点は
 * 集約をまたぐので、集約ごとの口を並べると保存点の数だけ配線が増える。
 * 実装は adapter の `facts/fact.reader.ts`(PostgREST の adapter。`framework/adapters/postgrest`)。
 *
 * かつて同じ形の口が 2 つあった（ここの `UsecaseFactReader` と `fact.reader.ts` の `FactReader`）。
 * 正はこの 1 本で、古い名は下の別名として 1 束だけ残す。
 */
export interface FactReader {
  /**
   * 1 行の指定した列だけを読む。
   *
   * @param view - `api` スキーマの表（ビュー）名
   * @param id - 主キー
   * @param fields - 読む列
   * @returns 列名 → 値。行が無ければ `null`
   */
  readFields(
    view: string,
    id: string,
    fields: readonly string[],
  ): Promise<Readonly<Record<string, FactScalar>> | null>;
}

/** `FactReader` の古い名（③-e2A で統合。次の束で消す）。 */
export type UsecaseFactReader = FactReader;

/** 複合 RPC に渡すもの（引数の形は全保存点で同じ）。 */
export interface UsecaseCallArgs {
  /** 呼び側が 1 回だけ作る冪等キー。 */
  readonly id: string;
  readonly actorId: string | null;
  /**
   * 実行者に立つロール（`p_actor_roles`。束 ⑳-3）。
   *
   * **`implies` の推移閉包で閉じている**こと（`claim` で立つロールを含む）が DB 側の契約である
   * （`legacy/spec-tools/lib/sql/roles-to-sql.ts`）。作るのは `_template/actor.ts` の
   * `resolveActorRoles` 1 か所だけ。
   */
  readonly actorRoles: readonly string[];
  /** 保存点の**外**の集約の状態（鍵は `{entity}.{列}`）。 */
  readonly expected: Readonly<Record<string, string | null>>;
  /** 手順の操作 ID を鍵にした入力(入口の正規化 `toWire` を通した、DB に運べる形)。 */
  readonly input: Readonly<Record<string, Json>>;
}

/**
 * 保存点の複合 RPC を 1 回呼び出す口（束⑯c）。
 *
 * 実装は adapter の `usecase/usecase.repository.ts`(`framework/adapters/postgrest`)。関数名は実行計画が渡すので、
 * この口も**集約を知らない**。
 */
export interface UsecaseRepository {
  /**
   * 保存点を 1 トランザクションで実行する。
   *
   * @param rpc - 複合 RPC の関数名（実行計画の `rpc`）
   * @param args - 冪等キー・実行者・予測した状態・入力
   * @returns 書けた(受領)・業務の拒否・通信の失敗・想定外の失敗(`CommitOutcome`)
   */
  call(rpc: string, args: UsecaseCallArgs): Promise<CommitOutcome<RpcReturn>>;
}

/**
 * **汎用の RPC 呼び出し口**（単発の操作の定型 RPC。束 ⑰ / ADR-0012 ④）。
 *
 * 集約ごとのリポジトリ（`{集約}.repository.ts`）と違い、**この口は集約を知らない**。関数名も
 * 引数名も実行計画（`@/domain/generated/operation-plans`）が渡し、実装が持つのは
 * 「結末をどう読むか」という写像だけである（`UsecaseRepository` と同じ構えで、違いは引数が
 * 署名どおりの名前付きであることだけ）。
 *
 * 実装は adapter の `rpc/rpc.caller.ts`(`framework/adapters/postgrest`)。
 */
export interface RpcCaller {
  /**
   * 定型 RPC を 1 回呼び出す。
   *
   * @param rpc - 関数名（実行計画の `rpc`）
   * @param args - 引数名 → 値（実行計画の `call.params` から組み立てたもの）
   * @param options - 呼び出しごとの読み方（省略すると既定）
   * @returns 書けた(受領)・業務の拒否(0 行は競合)・通信の失敗・想定外の失敗(`CommitOutcome`)
   */
  call(rpc: string, args: Readonly<Record<string, unknown>>, options?: RpcCallOptions): Promise<CommitOutcome<RpcReturn>>;
}

/** `RpcCaller.call` の呼び出しごとの読み方。 */
export interface RpcCallOptions {
  /**
   * 引数 `p_effects` を、受領の `requestedEffects`（要求した効果）に写すか。既定は `true`。
   *
   * `false` は**効果が SQL の本体にあり、引数に載らない**呼び出し（受信口の RPC）のための宣言で、受領の
   * `requestedEffects` は `null`（追っていない）になる。載せない RPC に既定のまま呼ぶと空の配列
   * （「積まなかった」と読めてしまう）になるので、そういう RPC は必ず `false` で呼ぶ。
   */
  readonly tracksEffects?: boolean;
}

/**
 * DB への口の束（製品の配線 1 本が作って、組み立ての根に渡すもの）。
 *
 * 結果の型は `CommitOutcome`（③-e2B）。引数の型はこの束では変えない（`RpcArg` への置き換えは次の束）。
 */
export interface DbPorts {
  readonly facts: FactReader;
  readonly usecases: UsecaseRepository;
  readonly rpc: RpcCaller;
}
