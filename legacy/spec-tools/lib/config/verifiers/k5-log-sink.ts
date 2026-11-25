/**
 * K5 ログの目録(`logging:`)と、別の系への転送先(ASVS V16.1.1 / V16.4.3)。
 *
 * ログを出すだけでは、侵入されたときに証拠が同じホストごと失われ、運用が何を・どこに・誰が・何日 残しているかも読めない。設定カタログは
 * 出荷する環境(置き場)を知っているので、**ログの目録と転送先を宣言として持たせる**。
 *
 * **導入はマストではない(オプトイン)。** 転送先の鍵(環境変数)が設定されたときだけ送り、無ければ標準出力だけで正常に動く。
 * だから警告は**製品が本番の置き場を宣言したとき(`sink.required_in`)だけ**で、試験環境・趣味の用途(`required_in` が空)では何も言わない。
 *
 * | 形 | 結果 |
 * |---|---|
 * | 設定カタログに `logging:` が無い | error。`logging` に format / sink / retention / readers を宣言する |
 * | 転送先が `off_host: false`(アプリの動くホストの中) | error。ホストの外の系を転送先にする |
 * | `app_direct` の `key_env` が `variables` に無い | error。鍵を読む環境変数の行を足す |
 * | `app_direct` の鍵の置き場に、`required_in` の置き場が入っていない | error。本番に鍵を置けない宣言になっている |
 * | 本番を宣言している(`required_in`)が、転送先も `exempt` も無い | warning(未分類)。転送先を宣言するか、理由つきで外す |
 * | 本番を宣言していて `exempt: 理由` で外している | warning(**受け入れた危険**。毎回名指す。区分は `Finding.acceptance`、宣言の実在は W5) |
 * | 本番を宣言していない(`required_in` が空・省略) | 何も言わない |
 * | `logging.dead_letter_alert`(死んだジョブの知らせ先。形は `sink` と同じ。省略は `sink` の `required_in` を継いで宛先なし) | 上の 5 行と同じ判定(宛先も `exempt` も無ければ warning。エラーのログは宣言によらず必ず出る) |
 *
 * **見ないもの**: 転送先が本当に設定されているか(本番に鍵が置かれているか)・保管日数が効いているか・読める人が宣言どおりか。いずれも
 * プラットフォームの管理画面にあり、検査からは見えない。本番を宣言して転送先を持つ製品は、実行ログが毎回「未検証」と名指す
 * (`describeLogSinkRun`。H5 の本番の設定と同じ扱い)。
 *
 * 形の検査(値域・`required_in` が置き場の語であること・`exempt` と転送先の排他)は K0 が済ませる。アプリの語彙は 1 語も持たない。
 */

import type { AcceptedRiskDecl, Finding } from '../../kernel/finding.js';
import type { SourceLocation } from '../../model/types.js';
import type { ConfigLogDestination, ConfigLoggingDecl, ConfigLogSinkDecl, ConfigSpecModel, ConfigVariableDecl } from '../../model/config/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'K5';

/** K5 の入力。 */
export interface LogSinkInput {
  /** 読み込み済みの設定カタログ。 */
  readonly config: ConfigSpecModel;
}

/** K5 の指摘を組み立てる。 */
function k5(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * ログの目録の宣言を検証する。
 *
 * @param input 設定カタログ
 * @returns 違反と警告
 */
export function verifyLogSink(input: LogSinkInput): Finding[] {
  const catalog = input.config.catalog;
  if (catalog === null) return [];
  if (catalog.logging === undefined) {
    // 書かれていて読めなかった宣言は K0 が言う。ここは書かれていないときだけ。
    if (catalog.loggingDeclared === true) return [];
    return [
      k5({
        message: '設定カタログにログの目録(logging)がありません(何を・どの形式で・どこへ・誰が読む・何日残すかが宣言されていません)',
        location: catalog.location,
        suggestion:
          'logging に format: json_lines・sink(required_in と、転送先の mode / label / off_host / key_env / configured_in または exempt)・retention(days / reason)・readers を宣言する' +
          '(転送先の設定は管理画面や CLI にあるので、宣言には「どこで設定するか」だけを書き、設定の値は書かない。config-spec-writing.md §logging)',
        counterexample: { declared: 'false' },
      }),
    ];
  }
  const { sink, location } = catalog.logging;
  const alert = deadLetterAlertOf(catalog.logging);
  return [...destinationFindings(sink, LOG_SINK, catalog.variables, location), ...destinationFindings(alert, DEAD_LETTER, catalog.variables, location)];
}

/** 宛先の種類ごとの文面。 */
interface DestinationWords {
  /** 宛先の呼び方。 */
  readonly name: string;
  /** 宛先が無いときに起きること。 */
  readonly harm: string;
  /** 宣言の欄。 */
  readonly key: string;
}

/** ログの転送先。 */
const LOG_SINK: DestinationWords = { name: 'ログの転送先', harm: 'ホストに侵入されたとき、証拠のログも一緒に失われます', key: 'sink' };

/** 死んだジョブの知らせ先。 */
const DEAD_LETTER: DestinationWords = { name: '死んだジョブの知らせ先', harm: '止まったジョブに、エラーのログを読みに行く人しか気づけません', key: 'dead_letter_alert' };

/** 死んだジョブの知らせ先の宣言(省略は `sink` の置き場を継いで宛先なし。本番を宣言した製品の中の空の `required_in` は K0 が止める。15 回目 C15-7)。 */
function deadLetterAlertOf(logging: ConfigLoggingDecl): ConfigLogSinkDecl {
  return logging.deadLetterAlert ?? { requiredIn: logging.sink.requiredIn, destination: { kind: 'none' } };
}

/** 1 つの宛先の宣言を見る。 */
function destinationFindings(decl: ConfigLogSinkDecl, words: DestinationWords, variables: readonly ConfigVariableDecl[], location: SourceLocation): Finding[] {
  const destination = decl.destination;
  switch (destination.kind) {
    case 'forward':
      return [...hostFinding(destination, words, location), ...keyEnvFindings(destination, words, decl.requiredIn, variables, location)];
    case 'exempt':
      return [exemptFinding(destination, words, decl.requiredIn)];
    case 'none':
      return decl.requiredIn.length === 0 ? [] : [missingSinkFinding(decl.requiredIn, words, location)];
  }
}

type ForwardDestination = Extract<ConfigLogDestination, { kind: 'forward' }>;

/** 転送先がホストの中なら止める。 */
function hostFinding(destination: ForwardDestination, words: DestinationWords, location: SourceLocation): Finding[] {
  if (destination.offHost) return [];
  return [
    k5({
      message: `${words.name} ${destination.label} がアプリの動くホストの外にありません(off_host: false)。${words.harm}`,
      location,
      suggestion: `ホストの外の系(ログドレイン・ログ収集のサービスなど)を宛先にして、${words.key}.off_host を true にする`,
      counterexample: { sink: destination.label, offHost: 'false' },
    }),
  ];
}

/** `app_direct` の鍵の環境変数が、カタログの行で、本番の置き場に置かれる宣言になっていること。 */
function keyEnvFindings(destination: ForwardDestination, words: DestinationWords, requiredIn: readonly string[], variables: readonly ConfigVariableDecl[], location: SourceLocation): Finding[] {
  const keyEnv = destination.keyEnv;
  if (destination.mode !== 'app_direct' || keyEnv === null) return [];
  const row = variables.find((variable) => variable.id === keyEnv);
  if (row === undefined) {
    return [
      k5({
        message: `${words.name} ${destination.label} の鍵の環境変数 ${keyEnv}(key_env)が variables にありません。実装が読む設定は、カタログの行と 1 対 1 でなければなりません`,
        location,
        suggestion: `variables に ${keyEnv} の行を足す(kind: secret・requirement: optional_degrades。未設定なら「ログを送らない」が absence)`,
        counterexample: { key_env: keyEnv },
      }),
    ];
  }
  const missing = requiredIn.filter((target) => !row.targets.includes(target));
  if (missing.length === 0) return [];
  return [
    k5({
      message: `${words.name}の鍵 ${keyEnv} の置き場に、転送先を必須にした置き場(${missing.join(' / ')})が入っていません。本番に鍵を置けない宣言になっています`,
      location: row.location,
      suggestion: `${keyEnv} の targets に ${missing.join(' / ')} を足す(requirement の default_targets に入っていれば省略でよい)`,
      counterexample: { key_env: keyEnv, missing: missing.join(',') },
    }),
  ];
}

/** 本番を宣言しているのに転送先が無い(未分類の警告)。 */
function missingSinkFinding(requiredIn: readonly string[], words: DestinationWords, location: SourceLocation): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'warning',
    message: `本番の置き場(${requiredIn.join(' / ')})を宣言していますが、${words.name}がありません。${words.harm}`,
    location,
    suggestion: `${words.key} に宛先(mode: app_direct と key_env、または host_drain)を宣言する。本番でも要らないなら exempt に理由を書いて外す(毎回受け入れた危険として名指される)`,
    counterexample: { required_in: requiredIn.join(','), [words.key]: 'none' },
  };
}

/** 本番でも要らないと外している(受け入れた危険)。 */
function exemptFinding(destination: Extract<ConfigLogDestination, { kind: 'exempt' }>, words: DestinationWords, requiredIn: readonly string[]): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'warning',
    message: `本番(${requiredIn.join(' / ')})で${words.name}を持たないと受け入れています(理由: ${destination.reason})。${words.harm}`,
    location: destination.location,
    suggestion: '外す理由が今も成り立つかを確かめる。成り立たなくなったら exempt を消し、宛先(mode / key_env)を宣言する',
    counterexample: { exempt: destination.reason },
    acceptance: { reason: destination.reason, location: destination.location },
  };
}

/**
 * ログの転送先を外す宣言を、受け入れた危険の宣言として取り出す(組み立ての根が W5 へ渡す。警告の `acceptance` と同じもの)。
 *
 * @param config 読み込み済みの設定カタログ
 * @returns 宣言(無ければ空)
 */
export function logSinkAcceptances(config: ConfigSpecModel): readonly AcceptedRiskDecl[] {
  const logging = config.catalog?.logging;
  if (logging === undefined) return [];
  return [logging.sink, deadLetterAlertOf(logging)].flatMap((decl) => (decl.destination.kind !== 'exempt' || decl.requiredIn.length === 0 ? [] : [{ reason: decl.destination.reason, location: decl.destination.location }]));
}
