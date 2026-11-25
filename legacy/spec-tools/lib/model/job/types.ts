/**
 * job_spec(ジョブ機能仕様)のモデル型。
 *
 * 「誰も見ていないときに何が動くか」は、これまでどの仕様書にも無い**暗黙の挙動**だった
 * (Cron の登録は app/vercel.json、ジョブ種別は実装のハンドラ一覧、発火時刻の供給元は
 * 走査のクエリの中、という具合に散っていた)。カタログはその穴を塞ぐ一級市民の宣言であり、
 * `state_spec` の `effects`・Cron の登録・実装のハンドラ一覧と**双方向の閉世界**を組む
 * (J1 / J2 + 実装側の突合テスト)。notification_spec と同型である。
 *
 * **語彙の線引き**: 機械が分岐に使う軸(`source`)だけがフレームワーク固定の値域であり、
 * 分岐に使わない軸(`kind` / `on_failure`)の語彙は**カタログ文書側が宣言する**。
 * 「通知」「指数バックオフ」はこのアプリの事情であって、体系の一部ではない
 * (doc_types.md の「検証器がコード分岐に使う区別だけを機械が持つ」打ち切り規則と同じ線)。
 */

import type { SourceLocation } from '../types.js';
import type { ActionTestCase } from '../../testcase/types.js';

/**
 * 発火の出どころの値域(フレームワーク固定)。
 *
 * ここだけを固定するのは、**J1 / J2 がこの値で分岐する**ためである。
 * - `outbox` … ドメインイベントの `effects` から積まれる(J1 が effects と 1 対 1 で閉じる)
 * - `schedule` … 時刻で起きる(J2 が Cron の登録・実装・発火時刻の供給元と閉じる)
 * - `manual`  … **人が押して積まれる**(J1 は effects との一致を要求せず、逆に effects に
 *   現れたらエラーにする)。台帳としては outbox の行に積まれるが、発火元がドメインイベント
 *   ではないので `outbox` とは別の軸になる —— 対外告知(`trigger: manual` の通知)が
 *   最初の実物である。時刻の宣言は持たない(`outbox` と同じ)
 */
export const JOB_SOURCES = ['outbox', 'schedule', 'manual'] as const;

/** 発火の出どころ。 */
export type JobSource = (typeof JOB_SOURCES)[number];

/**
 * カタログが宣言する語彙の軸(kind / on_failure)。
 *
 * 値の一覧を体系側に持たないための、宣言される語彙の側の名前である。
 */
export const JOB_VOCABULARY_AXES = ['kind', 'on_failure'] as const;

/** 語彙の軸。 */
export type JobVocabularyAxis = (typeof JOB_VOCABULARY_AXES)[number];

/**
 * `kind` の語の `declares` に書けるキー(その語の行が**必ず持つ**行のキー)。
 *
 * 行のキーのうち、**機械が読む軸が「キーの有無」で表されるもの**だけがここに載る(匿名化の対象の集約
 * `anonymizes`・走査が積む通知の一覧 `emits`・セッションを終える対象の集約 `ends_sessions`)。語を選んだのにキーを書き忘れると、語は体系が比べないので
 * 黙って別の種類として通ってしまう — その穴を、語の側の宣言で塞ぐ(語を選べば宣言が付いてくる。
 * `in_transaction` と同じ形)。
 */
export const JOB_DECLARABLE_KEYS = ['anonymizes', 'emits', 'ends_sessions'] as const;

/** 語が宣言できる行のキー。 */
export type JobDeclarableKey = (typeof JOB_DECLARABLE_KEYS)[number];

/**
 * 宣言できるキーごとに、**そのキーを持てる行の `source`**(軸の取り違えを J0 が落とす表)。
 *
 * 匿名化の対象は書き込みと同一トランザクションで実現される効果(`outbox`)の宣言であり、
 * 積む通知の一覧は時刻で起きる走査(`schedule`)の宣言である。
 */
export const DECLARABLE_KEY_SOURCE: Readonly<Record<JobDeclarableKey, JobSource>> = {
  anonymizes: 'outbox',
  emits: 'schedule',
  ends_sessions: 'outbox',
};

/**
 * `on_failure` の語の `means`(その語が「失敗したらどうなるか」の意味の値域。フレームワーク固定)。
 *
 * `on_failure` の語は**製品の語彙**なので、体系は語の綴りを比べない。ところが綴りを誰も読まないままだと、
 * 欄は散文と同じ扱いになる(2 本の `on_failure` を入れ替えても全部緑)。そこで `kind` の語に
 * `in_transaction` / `declares` を置いたのと同じ型で、**語の側に意味の宣言**を 1 つ置き、J6 が行と語の対を見る。
 * 値域は体系が固定する(行の種類 3 つ + 未定。語の綴りは製品が選ぶ):
 *
 * - `never_queued` … キューに積まれないはずの効果(書き込みと同じトランザクションで実現される)。積まれること自体が結線の誤り
 * - `retry_to_dead` … キューに積まれ、リトライして尽きたら dead letter に置く
 * - `next_run` … 時刻起点の走査。失敗しても、次の起動が拾い直す
 * - `pending_decision` … まだ決めていない(キューに積まれる行だけが宣言してよい。決めたら別の値に直す)
 */
export const JOB_FAILURE_MEANINGS = ['never_queued', 'retry_to_dead', 'next_run', 'pending_decision'] as const;

/** `on_failure` の語の意味。 */
export type JobFailureMeaning = (typeof JOB_FAILURE_MEANINGS)[number];

/** 語彙 1 語の宣言(内部名 + 表示名)。表示名は生成物の表に出る。 */
export interface JobTermDecl {
  /** 内部名(スネークケース)。行の `kind` / `on_failure` が指す値。 */
  readonly id: string;
  /** 表示名(任意)。宣言が無ければ内部名だけを出す。 */
  readonly label?: string;
  /**
   * この語の行は**書き込みと同じトランザクションで実現される**(キューには積まれない)ことの宣言
   * (`kind` の語だけが持つ。`in_transaction: true`。true の語だけが持つ)。
   *
   * 機械が分岐に使う軸は**この宣言**で、語(「同一トランザクションで実現済み」の呼び名)は
   * 体系が比べない —— 連鎖(複合 RPC の `also_writes`)を辿る入口の判定と実行計画の組み立てが読む。
   * 語に付けるのは、行ごとに書く形だと 1 行の書き忘れが黙って別の種類として扱われるため
   * (語を選べば宣言が付いてくる)。
   */
  readonly inTransaction?: boolean;
  /**
   * この語の行が**必ず持つキー**の宣言(`kind` の語だけが持つ。`declares: [anonymizes]`。空の宣言は持たない)。
   *
   * 宣言した語を選んだ行がキーを書き忘れた・キーを持つ行が宣言の無い語を選んだ、のどちらも J5 が落とす。
   * 語の綴りは体系が比べない(宣言の有無だけを読む)。
   */
  readonly declares?: readonly JobDeclarableKey[];
  /**
   * この語が「失敗したらどうなるか」の意味の宣言(`on_failure` の語だけが持つ。**`on_failure` の語は必ず持つ**)。
   *
   * 機械が読むのはこの宣言で、語の綴りは体系が比べない。J6 が、行の種類(同一トランザクションで実現される・
   * 時刻起点・キューに積まれる)と語の意味の対を見る。
   */
  readonly means?: JobFailureMeaning;
}

/**
 * 時刻で起きるジョブの「鳴る場所」(時計がどこで鳴るか)の値域(フレームワーク固定)。
 *
 * ホストの Cron が起動できる頻度には上限があることがある。高頻度で叩く必要があるジョブは、
 * ホストの Cron の外に出し、DB 内のスケジューラから同じ HTTP の口を叩く形にする(ADR-0010)。
 * **この軸だけをフレームワーク固定にするのは、J2(ホストの Cron の登録との突合)・J3(DB 内の
 * スケジューラの登録との突合)・J4(ホストの頻度制約)がこの値で分岐するためである**。
 * 値は「どこで鳴るか」であり、具体のスタックの名前ではない(どの後段がその場所を受け持つかは
 * `lib/job/target-checks.ts` の `SCHEDULER_OWNER` が役割で宣言する)。
 * - `host`     … アプリを動かす場所の Cron が、HTTP の入口(`endpoint`)を叩く(ホストの設定ファイルの
 *   Cron の登録と J2 が双方向に閉じる。ホストの頻度制約は J4 が見る)
 * - `database` … DB の中のスケジューラが、関数を呼んで同じ口を叩く(migration の登録と J3 が
 *   双方向に閉じる。業務ロジックは置かない —— HTTP を叩くだけのトリガであり、計算は入口の
 *   Route Handler のまま)
 */
export const JOB_SCHEDULERS = ['host', 'database'] as const;

/** 時刻で起きるジョブの鳴る場所。 */
export type JobScheduler = (typeof JOB_SCHEDULERS)[number];

/** 時刻で起きるジョブだけが持つ宣言。 */
export interface JobScheduleDecl {
  /** cron 式。**Cron に登録されていない**ジョブは持たない(代わりに理由を持つ)。 */
  readonly cron?: string;
  /** cron を持たない理由(まだ結線していない、の免除。`cron` と排他で必ずどちらか)。 */
  readonly notScheduledReason?: string;
  /** Cron が叩く口(`/api/jobs/run`)。`cron` があるとき必須。 */
  readonly endpoint?: string;
  /** 走査・ワーカー本体の実装モジュール(リポジトリルート相対。実在も検査される)。 */
  readonly implementation: string;
  /** この走査が実行するドメインイベント ID(`{machine}.{event}`)。実行しないジョブは持たない。 */
  readonly fires?: string;
  /** 発火時刻の供給元(`{entity}.{field}`)。「いつ」が仕様から辿れるようにするための列。 */
  readonly dueFrom?: string;
  /** 鳴る場所(`host` / `database`)。`source: schedule` の行は必ず持つ(J0 が必須にする)。 */
  readonly scheduler: JobScheduler;
  /**
   * この走査が outbox に積む通知の ID の一覧(任意。持つなら 1 件以上)。
   *
   * **通知の発火元の 3 つ目**である(遷移の `effects` ・受信 Webhook の `emits` と並ぶ)。
   * `trigger: schedule` の通知は、この宣言で名指されることで発火元を持つ(N1 が双方向に見る)。
   * `kind` の語が `declares: [emits]` を持つなら、その語の行は必ず持つ。
   */
  readonly emits?: readonly string[];
}

/** ジョブ 1 本の宣言。 */
export interface JobDecl {
  /** ジョブ ID。`source: outbox` なら `effects[].do` の ID と同じ語彙。 */
  readonly id: string;
  /** 発火の出どころ。 */
  readonly source: JobSource;
  /** 種別。カタログの `vocabulary.kind` に宣言された語のいずれか。 */
  readonly kind: string;
  /** 失敗時の挙動。カタログの `vocabulary.on_failure` に宣言された語のいずれか。 */
  readonly onFailure: string;
  /** 1 行の説明(何をするか)。 */
  readonly summary: string;
  /** 時刻で起きるジョブの宣言(`source: schedule` のときだけ持つ)。 */
  readonly schedule?: JobScheduleDecl;
  /**
   * この効果が「personal 列を placeholder に書き換える」集約(集約 id。`source: outbox` の行だけが持つ)。
   *
   * **匿名化する効果の宣言**であり、書き込みと同一トランザクションで実現される(キューには積まれない)
   * 種別の 1 つである。機械が読む軸は**このキーの有無**で、`kind` の語(「匿名化」の呼び名)は
   * カタログが宣言する語彙のままにしてある(語を体系側に持たない)。語と宣言のずれは J5 が見る。
   */
  readonly anonymizes?: string;
  /**
   * この効果が「ログイン状態(認証基盤のセッション)を終える」アカウントの集約(集約 id。`source: outbox` の行だけが持つ)。
   *
   * **セッションを終える効果の宣言**であり、書き込みと同一トランザクションで実現される種別の 1 つである(R11)。
   * その集約の行の id が認証基盤のアカウントの id と同じで、遷移した**その行の持ち主**(遷移の主語)のセッションを全部終える。
   * 機械が読む軸は**このキーの有無**で、`kind` の語(「セッションを終える」の呼び名)はカタログが宣言する。語と宣言のずれは J7 が見る。
   */
  readonly endsSessions?: string;
  /**
   * `endsSessions` / `anonymizes` の行が持つ、**認証基盤の呼び出しを本文に持つ RPC**(data_table の `kind: rpc`。引数は uuid 1 つ)の名指し。
   * 匿名化の行では、認証フローの主語の集約を匿名化するときに必須である(認証基盤の個人データも同じ消去で消す。J5)。
   *
   * 認証基盤の綴り(セッションの表・管理 API)はこの 1 本の本文に閉じる。`realized_by` の RPC は、それ自身であるか
   * `calls` に宣言して呼ぶ(T19 が見る)。生成する遷移の RPC は、効果を載せるイベントでこの関数を呼ぶ本文になる。
   */
  readonly platformCall?: string;
  /**
   * 匿名化の行が持てる、**認証基盤の個人データをコミットの後に消すキューのジョブ**の名指し(`platform_call` の代わり。併記は不可)。
   * 認証基盤の管理 API はトランザクションの外なので、消去のコミットと同じトランザクションで積み、失敗は再試行に任せる形である。
   * 名指す先が実在のキューの行であること・同じ遷移の `effects` に載ることは J5 が見る。
   */
  readonly platformJob?: string;
  /**
   * この行の `kind` の語が `in_transaction` を宣言しているか(宣言していれば true。**語の宣言を写したもの**で、
   * 行には書かない。`source: outbox` の行だけが true になれる)。書き込みと同じトランザクションで実現される
   * (キューに積まれない)効果である。
   */
  readonly inTransaction?: boolean;
  /**
   * この効果を**実現する書き込み RPC**の名指し(`{ドメインイベント ID}: {RPC 名}`。同一トランザクションで実現される行
   * = `inTransaction` の行だけが持ち、そこでは必須)。
   *
   * キーはその効果を起こす全部のドメインイベント(`effects` の宣言元。`{machine}.{event}` または `{entity}.update`)で、
   * 値はそのイベントが実際に通る RPC(data_table の `kind: rpc`。遷移の定型でも複合でもよい)。
   * **連鎖(別の表も書くか・個人データを書き換えるか)は、名指しされた RPC の `also_writes` だけから導く** —— 集約に複合 RPC が
   * 何本あるかや、どれが「それらしい」かを推測しない。キーの過不足と RPC の実在は T19 が見る。
   */
  readonly realizedBy?: Readonly<Record<string, string>>;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** カタログ 1 ファイル分の宣言。 */
export interface JobCatalogSpec {
  /** 文書 ID(`job-catalog` 固定 — 1 プロジェクト 1 カタログ)。 */
  readonly id: string;
  /** 軸ごとの語彙(宣言順)。 */
  readonly vocabulary: Readonly<Record<JobVocabularyAxis, readonly JobTermDecl[]>>;
  /** ジョブの全数(宣言順)。 */
  readonly jobs: readonly JobDecl[];
  /** テストケース宣言(実装側の突合テストを指す)。 */
  readonly testCases: readonly ActionTestCase[];
  /** 仕様ファイルの位置。 */
  readonly location: SourceLocation;
}

/** 読み込んだジョブカタログ。 */
export interface JobSpecModel {
  /** カタログファイルが存在したか。false なら J 群はスキップされる。 */
  readonly available: boolean;
  /** 読み込めたカタログ。スキーマ違反で構築できなければ null。 */
  readonly catalog: JobCatalogSpec | null;
}
