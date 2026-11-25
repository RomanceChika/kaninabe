/**
 * config_spec(設定カタログ)のモデル型。
 *
 * 「このシステムを動かすのに何を設定する必要があり、それが無いと何が起きるか」は、
 * これまでどの仕様書にも無い**暗黙の挙動**だった(実装の `process.env` 参照と
 * `app/.env.example` のコメントに散っていた)。カタログはその穴を塞ぐ一級市民の宣言であり、
 * 実装の参照(K1)と雛形(K2)の両方と**双方向の閉世界**を組む。notification_spec /
 * job_spec と同型である。
 *
 * **語彙の線引き**: このカタログには**フレームワークが固定する軸が 1 つも無い**。
 * K1 / K2 のどちらも語で分岐しないためで(J 群の `source` に相当するものが要らない)、
 * `kind` / `requirement` / `used_by` の語彙はすべてカタログ文書側が宣言する。
 * 「秘密」「Discord Bot」はこのアプリの事情であって、体系の一部ではない。
 */

import type { SourceLocation } from '../types.js';
import type { ConfigLoggingDecl } from './logging-types.js';

export { CONFIG_LOG_FORMATS, CONFIG_LOG_SINK_MODES } from './logging-types.js';
export type { ConfigLogDestination, ConfigLogFormat, ConfigLoggingDecl, ConfigLogSinkDecl, ConfigLogSinkMode } from './logging-types.js';

/**
 * カタログが宣言する語彙の軸。
 *
 * - `kind` … 値の性質(秘密か・URL か・識別子か)。取り扱いの重さがここで決まる
 * - `requirement` … 無いと困る度合い(必須 / 未設定でも縮退して動く / ローカル専用)
 * - `used_by` … **何のために繋がっているか**。この軸が連携カタログを兼ねる
 * - `provision` … **調達のしかた**(人が値を貼るか・道具が生成するか)。行が省略したら
 *   `vocabulary.provision` の**先頭に宣言された語**になる(`kind` / `requirement` と違い、
 *   行ごとの必須ではない)。既定の語そのものはこのアプリの選択であり、体系側は
 *   「先頭が既定」という位置づけのルールだけを持つ(語を仕組み側にリテラルで持たない — W1)
 * - `target` … **置き場**(値がどこに要るか)。語ごとに「名前を列挙する手」(`probe`)を宣言し、
 *   体系側が持つのは `probe.kind` の値域だけである(置き場の名前もコマンドの綴りも持たない)。
 *   行が `targets` を省略したら `requirement` の語が宣言した `default_targets` を引く
 */
export const CONFIG_VOCABULARY_AXES = ['kind', 'requirement', 'used_by', 'provision', 'target'] as const;

/** 語彙の軸。 */
export type ConfigVocabularyAxis = (typeof CONFIG_VOCABULARY_AXES)[number];

/** 値を 1 つだけ取る、かつ行ごとに必須の軸。 */
export const CONFIG_SINGLE_AXES = ['kind', 'requirement'] as const;

/** 単一値の軸。 */
export type ConfigSingleAxis = (typeof CONFIG_SINGLE_AXES)[number];

/**
 * `probe.kind` の値域(**体系側が持つのはこれだけ**)。
 *
 * - `dotenv` … dotenv 形式のファイルから**キー名だけ**を読む(`NAME=` の左辺)
 * - `command` … コマンドを実行し、その出力に**名前が現れるか**だけを見る
 *
 * どちらも**値を返せない形**である。「道具が値を読まない」を規約ではなく**宣言の形**で
 * 担保するのが狙いで、値を返す probe はこの値域が許さないので宣言に書けない
 * (設計メモ `docs/design/config-provisioning.md` §3-1)。置き場の名前もコマンドの綴りも
 * 体系側は持たない —— 基盤を替える日に直るのはカタログの `vocabulary.target` である。
 */
export const CONFIG_PROBE_KINDS = ['dotenv', 'command'] as const;

/** probe の種類。 */
export type ConfigProbeKind = (typeof CONFIG_PROBE_KINDS)[number];

/** 置き場にどの名前が入っているかを列挙する手(値は取れない)。 */
export type ConfigProbe =
  | {
      readonly kind: 'dotenv';
      /** dotenv 形式のファイル(リポジトリルート相対)。読むのはキー名だけ。 */
      readonly path: string;
    }
  | {
      readonly kind: 'command';
      /** 実行するコマンドと引数。名前の列挙しか返さないものを宣言する。 */
      readonly argv: readonly string[];
      /** 実行する位置(リポジトリルート相対)。省略ならリポジトリルート。 */
      readonly cwd?: string;
    };

/**
 * `read_by.kind` の値域(**体系側が持つのはこれだけ**)。
 *
 * - `workflow_secret` … GitHub Actions の workflow が `secrets.NAME` の形で読む
 *
 * 「この置き場の名前を、リポジトリの中で読んでいるのは誰か」の宣言である。K1(誰も読まない
 * 宣言を残さない)と K3(置き場の宣言と読み口の双方向)の材料になる。`probe` が
 * 「外の置き場をどう覗くか」なのに対し、こちらは**リポジトリの中の読み口**を指す。
 */
export const CONFIG_READ_BY_KINDS = ['workflow_secret'] as const;

/** 読み口の種類。 */
export type ConfigReadByKind = (typeof CONFIG_READ_BY_KINDS)[number];

/** この置き場の名前をリポジトリの中で読んでいる場所。 */
export interface ConfigReadBy {
  /** 読み方(体系が持つ値域)。 */
  readonly kind: ConfigReadByKind;
  /** 走査する場所(リポジトリルート相対のディレクトリ)。 */
  readonly path: string;
}

/** 語彙 1 語の宣言(内部名 + 表示名 + 軸ごとの付随宣言)。表示名は生成物の表に出る。 */
export interface ConfigTermDecl {
  /** 内部名(スネークケース)。行の `kind` / `requirement` / `used_by` / `targets` が指す値。 */
  readonly id: string;
  /**
   * **`kind` の語だけが持つ**(任意): この種類の値は URL である(`url: true`)。
   * この種類の行は `format: url` と `scheme` を必ず宣言する(K4)—— 外へ出る URL を、種類の宣言から漏らさない。
   */
  readonly url?: boolean;
  /**
   * **`kind` の語だけが持つ**(任意): この種類の値は秘密である(`confidential: true`。漏れたら作り直しが要る値)。
   * この種類の行は `rotation`(寿命・更新の手順・持つ者)を必ず宣言する(K6。ASVS V11.1.1)。
   */
  readonly confidential?: boolean;
  /**
   * **`used_by` の語だけが持つ**(任意): この使い先は**サービスの認証**(口を叩けることの根拠が共有秘密だけの呼び出し。ASVS V13.2.3)。
   * この使い先の秘密の行は `strength`(長さの下限)を必ず宣言し、実装は関門(`readServiceSecret`)を通して読む(K6)。
   */
  readonly serviceAuth?: boolean;
  /** 表示名(任意)。`used_by` では「何のために繋がっているか」をここに書く。 */
  readonly label?: string;
  /** **`target` の語だけが持つ**(必須): その置き場の名前を列挙する手。 */
  readonly probe?: ConfigProbe;
  /** **`target` の語だけが持つ**(任意): その置き場の名前をリポジトリの中で読んでいる場所。 */
  readonly readBy?: ConfigReadBy;
  /**
   * **`requirement` の語だけが持つ**(任意): `targets` を省略した行が引く既定の置き場。
   *
   * 宣言が無い語の行は `targets` を書かないと K0 が落とす(どこに要るかが決まらない)。
   * 空リスト(`[]`)は「どこにも人が入れない」を意味する正当な宣言である。
   */
  readonly defaultTargets?: readonly string[];
}

/**
 * 設定の URL の `scheme` の値域(**体系側が持つのはこれだけ**)。
 *
 * - `https` … https の絶対 URL だけ(外部サービスの Webhook・招待・デプロイフックなど、平文の送り先を作らない)
 * - `https_or_loopback` … https に加えて、**自分の機械(localhost / 127.0.0.1)への http だけ**を許す
 *   (開発機が自分のスタックにつなぐ接続先用。外部の http は許さない)
 *
 * 文法の正は `lib/kernel/url-format.ts`、実行時の判定は `@kaninabe/runtime/url` の `readConfigUrl`(ASVS V12.3.1)。
 */
export const CONFIG_URL_SCHEMES = ['https', 'https_or_loopback'] as const;

/** 設定の URL の `scheme`。 */
export type ConfigUrlScheme = (typeof CONFIG_URL_SCHEMES)[number];

/** `rotation.every` の単位(体系が持つ値域)。 */
export const CONFIG_ROTATION_UNITS = ['day', 'month'] as const;

/** `rotation.every` の単位。 */
export type ConfigRotationUnit = (typeof CONFIG_ROTATION_UNITS)[number];

/**
 * 秘密の行の**寿命と更新の手順**(`rotation`。ASVS V11.1.1)。値は書かない。
 * 仮置きの値は `procedure` か `every` の根拠に「仮置き」と明記し、運営が決め直す(組織の事実を発明しない)。
 */
export interface ConfigRotationDecl {
  /** 更新の周期の数(正の整数)。 */
  readonly everyCount: number;
  /** 更新の周期の単位。 */
  readonly everyUnit: ConfigRotationUnit;
  /** 更新の手順(短い文か、手順の文書の場所)。 */
  readonly procedure: string;
  /** 値を持つ者・置き場(呼び名。1 つ以上。権限の付与は運用)。 */
  readonly holders: readonly string[];
  /** 周期の根拠(任意)。運営がまだ決めていない仮置きの値は、ここに「仮置き・運用で決める」と明記する。 */
  readonly reason?: string;
}

/** 秘密の強さの宣言(`strength`。ASVS V13.2.3)。実行時は `@kaninabe/runtime/secret` の `readServiceSecret` が同じ値で判定する。 */
export interface ConfigStrengthDecl {
  /** 値の長さの下限(文字数。これに満たない値は設定されていないものとして口を閉じる)。 */
  readonly minLength: number;
}

/** 設定項目 1 件の宣言。 */
export interface ConfigVariableDecl {
  /** 環境変数名(SCREAMING_SNAKE)。実装の `process.env` 参照と同じ文字列。 */
  readonly id: string;
  /** 値の性質。カタログの `vocabulary.kind` に宣言された語のいずれか。 */
  readonly kind: string;
  /** 無いと困る度合い。カタログの `vocabulary.requirement` に宣言された語のいずれか。 */
  readonly requirement: string;
  /** 何が使うか(1 つ以上)。カタログの `vocabulary.used_by` に宣言された語。 */
  readonly usedBy: readonly string[];
  /**
   * 調達のしかた。カタログの `vocabulary.provision` に宣言された語のいずれか。
   * 行が省略していれば `vocabulary.provision` の先頭の語になる。
   */
  readonly provision: string;
  /**
   * **値がどこに要るか**(置き場)。カタログの `vocabulary.target` に宣言された語。
   *
   * 行が `targets` を書いていなければ `requirement` の語の `default_targets` を引いた結果が
   * 入る(導出できるのに宣言していれば K0 が落とす)。空リストは「どこにも人が入れない」。
   */
  readonly targets: readonly string[];
  /** 何を制御するかを 1 行で。 */
  readonly summary: string;
  /** **無いとどうなるか**(必須かどうかを言い換えでなく挙動で書く)。 */
  readonly absence: string;
  /**
   * 値が URL であること(`format: url`)。種類が `url: true` の行は必須で、種類を問わず宣言してよい
   * (URL 自体が秘密の Webhook を `secret` の種類に置く製品がある)。`scheme` と対で書く。
   */
  readonly format?: 'url';
  /** `format: url` の行の許すスキーム(`CONFIG_URL_SCHEMES`)。`format` と対で書く。 */
  readonly scheme?: ConfigUrlScheme;
  /** 秘密の寿命と更新の手順。種類が `confidential: true` の行は必須(K6)。 */
  readonly rotation?: ConfigRotationDecl;
  /** 秘密の強さ。サービスの認証の秘密(使い先が `service_auth: true`・受信の署名の鍵)は必須(K6)。 */
  readonly strength?: ConfigStrengthDecl;
  /**
   * 更新の間だけ**旧い秘密も受ける**ための、旧い値の環境変数名(別の行として宣言する。`strength` のある行だけが持てる)。
   * 実装は current と previous の両方を関門で読み、定数時間で照合する(`matchesAnySecret`。ASVS V11.2.2)。
   */
  readonly previous?: string;
  /** `app/.env.example` に雛形の行を持たない理由(持たない行だけが持つ。K2 の免除)。 */
  readonly notInTemplateReason?: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** カタログ 1 ファイル分の宣言。 */
export interface ConfigCatalogSpec {
  /** 文書 ID(`config-catalog` 固定 — 1 プロジェクト 1 カタログ)。 */
  readonly id: string;
  /** 軸ごとの語彙(宣言順)。 */
  readonly vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>;
  /** 設定項目の全数(宣言順)。 */
  readonly variables: readonly ConfigVariableDecl[];
  /** ログの目録の宣言(`logging:`)。書かれていない・読めなかったなら無い。 */
  readonly logging?: ConfigLoggingDecl;
  /** `logging:` のキーが書かれているか(書かれていて読めなければ K0 が言う。K5 は「無い」と二重に言わない)。 */
  readonly loggingDeclared: boolean;
  /** 仕様ファイルの位置。 */
  readonly location: SourceLocation;
}

/** 読み込んだ設定カタログ。 */
export interface ConfigSpecModel {
  /** カタログファイルが存在したか。false なら K 群はスキップされる。 */
  readonly available: boolean;
  /** 読み込めたカタログ。スキーマ違反で構築できなければ null。 */
  readonly catalog: ConfigCatalogSpec | null;
}
