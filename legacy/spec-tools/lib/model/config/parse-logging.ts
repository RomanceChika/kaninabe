/**
 * config_spec の **ログの目録の宣言**(`logging:`)のパーサー(K0 = 形と語彙の閉世界)。
 *
 * 目録は「何を・どの形式で・どこへ・誰が読む・何日残す」の 5 つ(ASVS V16.1.1)に答える宣言で、設定カタログの最上位に 1 つ置く。
 * ログは環境変数の値ではないが、**出荷する環境(置き場)が関わる運用の設定**であり、`target` の語彙(どの置き場か)をそのまま使う
 * ので、設定カタログの隣に住む。
 *
 *   - 何を … 事象の目録は仕組みが持つ(`@kaninabe/runtime/security-log` の `SECURITY_EVENTS`)ので、宣言には書かない。ハンドブックが並べる
 *   - どの形式で … `format`(`json_lines` = 1 行 1 JSON。値域は体系が持つ)
 *   - どこへ … `sink`(別の系の転送先。V16.4.3)。置き場のうち**転送先を必須にする環境**(`required_in`。省略・空は「本番を宣言しない」で、
 *     試験環境や趣味の用途では何も言われない)、送り方(`mode`: `app_direct` = アプリから直接 / `host_drain` = 配置先のログドレイン)、
 *     鍵の環境変数名(`key_env`。`app_direct` だけ)、転送先がホストの外にあること(`off_host`。侵入されても残る)、設定する場所の説明
 *     (`configured_in`。プロバイダの設定は宣言に書き写さず、場所だけを指す)。本番でも要らないなら転送先の代わりに `exempt: 理由` で外せる
 *   - 誰が読む … `readers`(読める人の呼び名。権限の付与は運用)
 *   - 何日残す … `retention`(日数と理由)
 *
 * 形だけを見る。転送先が本当に設定されているかはプラットフォームの管理画面にあり、検査からは見えない(K5 が毎回「未検証」と名指す)。
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { ConfigLogDestination, ConfigLoggingDecl, ConfigLogSinkMode, ConfigTermDecl, ConfigVocabularyAxis } from './types.js';
import { CONFIG_LOG_FORMATS, CONFIG_LOG_SINK_MODES } from './types.js';
import { knows, reportUnknownTerm } from './vocabulary-lookup.js';

/** 書き方の案内。 */
const LOGGING_SUGGESTION =
  'logging に format(json_lines)・sink(label / off_host / required_in / configured_in)・retention(days / reason)・readers を書く' +
  '(ログの目録。何を出すかは仕組みの事象の目録が持つので書かない)';

/** 宣言を読み出した結果(`declared` = キーが書かれている)。 */
export interface ParsedLogging {
  /** `logging` のキーが書かれているか(書かれていて読めなければ `decl` は無く、K0 が言う)。 */
  readonly declared: boolean;
  readonly decl?: ConfigLoggingDecl;
}

/**
 * `logging` を読む。
 *
 * @param root カタログのフロントマター
 * @param vocabulary 軸ごとの語彙(`required_in` は `target` の語に閉じる)
 * @param reporter 違反の記録先
 * @returns 読んだ宣言
 */
export function parseLogging(
  root: YamlReader,
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  reporter: SpecReporter,
): ParsedLogging {
  const raw = root.raw('logging');
  if (raw === undefined || raw === null) return { declared: false };
  const record = asRecord(raw);
  if (record === null) {
    reporter.error('logging', 'logging はマッピングで書きます', LOGGING_SUGGESTION);
    reporter.dropRows();
    return { declared: true };
  }
  const reader = new YamlReader(record, 'logging', reporter);
  reader.rejectUnknownKeys(['format', 'sink', 'dead_letter_alert', 'retention', 'readers'], 'logging', LOGGING_SUGGESTION);
  const format = parseFormat(reader, reporter);
  const sink = parseSink(reader, 'sink', vocabulary, reporter);
  const alert = reader.has('dead_letter_alert') ? parseSink(reader, 'dead_letter_alert', vocabulary, reporter) : undefined;
  // 本番を宣言した製品で知らせ先の `required_in` を空にすると、K5 の警告を `exempt` を通らず黙らせられる(点検 15 回目 C15-7)。外すなら理由を書く。
  if (sink !== null && alert !== undefined && alert !== null && sink.requiredIn.length > 0 && alert.requiredIn.length === 0) {
    reporter.error(reader.pointer('dead_letter_alert'), 'dead_letter_alert の required_in が空です(sink が本番を宣言しています)', 'required_in に sink と同じ置き場を書く。要らないなら exempt に理由を書く。欄ごと省略すると sink の置き場を継ぐ');
    reporter.dropRows();
    return { declared: true };
  }
  const retention = parseRetention(reader, reporter);
  const readers = reader.requiredStringList('readers', 'readers にログを読める人の呼び名を 1 つ以上書く(権限の付与は運用で行う)', false);
  if (format === null || sink === null || alert === null || retention === null || readers === null) {
    reporter.dropRows();
    return { declared: true };
  }
  return { declared: true, decl: { format, sink, ...(alert === undefined ? {} : { deadLetterAlert: alert }), retention, readers, location: reporter.location('logging') } };
}

/** `format` を読む。 */
function parseFormat(reader: YamlReader, reporter: SpecReporter): ConfigLoggingDecl['format'] | null {
  const value = reader.requiredString('format', `format を ${CONFIG_LOG_FORMATS.join(' / ')} のいずれかで書く`);
  if (value === null) return null;
  const found = CONFIG_LOG_FORMATS.find((candidate) => candidate === value);
  if (found === undefined) {
    reporter.error(reader.pointer('format'), `format ${value} は使えません`, `format は ${CONFIG_LOG_FORMATS.join(' / ')} のいずれか(1 行 1 JSON が機械で読める形式)`, { format: value });
    return null;
  }
  return found;
}

/** 転送先の書き方の案内。 */
const SINK_SUGGESTION =
  'sink に required_in(本番の置き場。省略は本番を宣言しない)と、転送先(mode / label / off_host / key_env / configured_in)または exempt(本番でも要らない理由)のどちらかを書く' +
  '(config-spec-writing.md §ログの目録)';

/** 転送先を宣言する欄(`exempt` と同時には書けない)。 */
const DESTINATION_KEYS = ['mode', 'label', 'off_host', 'key_env', 'configured_in'] as const;

/** 環境変数名の形(SCREAMING_SNAKE)。 */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/u;

/** `sink` / `dead_letter_alert` を読む(同じ形。省略は「本番を宣言せず、転送先も書かない」)。 */
function parseSink(
  reader: YamlReader,
  key: 'sink' | 'dead_letter_alert',
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  reporter: SpecReporter,
): ConfigLoggingDecl['sink'] | null {
  const raw = reader.raw(key);
  if (raw === undefined || raw === null) return { requiredIn: [], destination: { kind: 'none' } };
  const record = asRecord(raw);
  if (record === null) {
    reporter.error(reader.pointer(key), `${key} はマッピングで書きます`, SINK_SUGGESTION);
    return null;
  }
  const sink = new YamlReader(record, reader.pointer(key), reporter);
  sink.rejectUnknownKeys(['required_in', 'exempt', ...DESTINATION_KEYS], `logging.${key}`, SINK_SUGGESTION);
  const requiredIn = parseRequiredIn(sink, vocabulary, reporter);
  if (requiredIn === null) return null;
  const destination = sink.has('exempt') ? parseExempt(sink, requiredIn, reporter) : parseForward(sink, reporter);
  return destination === null ? null : { requiredIn, destination };
}

/** `required_in`(本番の置き場。省略・空は本番を宣言しない)を読む。 */
function parseRequiredIn(
  sink: YamlReader,
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  reporter: SpecReporter,
): readonly string[] | null {
  const suggestion = 'required_in に、転送先を必須にする置き場を vocabulary.target の語のリストで書く(本番を宣言しないなら省略する)';
  const raw = sink.raw('required_in');
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    reporter.error(sink.pointer('required_in'), 'required_in はリストで書きます', suggestion);
    return null;
  }
  const requiredIn = sink.optionalStringList('required_in', suggestion);
  for (const target of requiredIn) {
    if (!knows(vocabulary, 'target', target)) {
      reportUnknownTerm(sink.pointer('required_in'), 'target', target, vocabulary, reporter);
      return null;
    }
  }
  if (new Set(requiredIn).size !== requiredIn.length) {
    reporter.error(sink.pointer('required_in'), 'required_in に同じ置き場が重複しています', '重複した語を削除する');
    return null;
  }
  return requiredIn;
}

/** `exempt`(本番でも転送先を要らないと外す宣言)を読む。 */
function parseExempt(sink: YamlReader, requiredIn: readonly string[], reporter: SpecReporter): ConfigLogDestination | null {
  const reason = sink.requiredString('exempt', 'exempt に、本番でもログを別の系へ送らない理由を書く(毎回 verify が受け入れた危険として名指す)');
  if (reason === null) return null;
  const clash = DESTINATION_KEYS.filter((key) => sink.has(key));
  if (clash.length > 0) {
    reporter.error(sink.pointer('exempt'), `exempt は転送先の宣言(${clash.join(' / ')})と同時には書けません`, '転送先を使うなら exempt を消す。外すなら転送先の欄を消す');
    return null;
  }
  if (reason.trim() === '') {
    reporter.error(sink.pointer('exempt'), 'exempt の理由が空です', 'exempt に、本番でもログを別の系へ送らない理由を書く');
    return null;
  }
  if (requiredIn.length === 0) {
    reporter.error(sink.pointer('exempt'), 'exempt は required_in(本番の置き場)があるときだけ意味を持ちます', '本番を宣言していないなら exempt は要らない(何も言われない)。本番を宣言して外すなら required_in を書く');
    return null;
  }
  return { kind: 'exempt', reason, location: reporter.location(sink.pointer('exempt')) };
}

/** 転送先の宣言(mode / label / off_host / key_env / configured_in)を読む。1 つも書かれていなければ `none`。 */
function parseForward(sink: YamlReader, reporter: SpecReporter): ConfigLogDestination | null {
  if (!DESTINATION_KEYS.some((key) => sink.has(key))) return { kind: 'none' };
  const modeText = sink.requiredString('mode', `mode を ${CONFIG_LOG_SINK_MODES.join(' / ')} のいずれかで書く`);
  const label = sink.requiredString('label', 'label にログの転送先の呼び名を書く');
  const offHost = sink.requiredBoolean('off_host', 'off_host に、転送先がアプリの動くホストの外にあるか(true / false)を書く');
  const configuredIn = sink.requiredString('configured_in', 'configured_in に、転送先を設定する場所(プロバイダの管理画面・CLI など)を書く。設定の値は書かない');
  if (modeText === null || label === null || offHost === null || configuredIn === null) return null;
  const mode = CONFIG_LOG_SINK_MODES.find((candidate) => candidate === modeText);
  if (mode === undefined) {
    reporter.error(sink.pointer('mode'), `mode ${modeText} は使えません`, `mode は ${CONFIG_LOG_SINK_MODES.join(' / ')} のいずれか(アプリから直接送る / 配置先のログドレインに任せる)`, { mode: modeText });
    return null;
  }
  const keyEnv = parseKeyEnv(sink, mode, reporter);
  return keyEnv === undefined ? null : { kind: 'forward', mode, label, offHost, keyEnv, configuredIn };
}

/** `key_env`(`app_direct` の鍵の環境変数名)を読む。読めなければ undefined(違反は記録済み)。 */
function parseKeyEnv(sink: YamlReader, mode: ConfigLogSinkMode, reporter: SpecReporter): string | null | undefined {
  if (mode === 'host_drain') {
    if (!sink.has('key_env')) return null;
    reporter.error(sink.pointer('key_env'), 'host_drain に key_env は書けません(配置先のログドレインはアプリが鍵を持たない)', 'アプリから送るなら mode を app_direct にする。配置先に任せるなら key_env を消す');
    return undefined;
  }
  const keyEnv = sink.requiredString('key_env', 'app_direct の key_env に、鍵(API トークン)を読む環境変数の名前を書く(variables に同じ名前の行を持つ。値は書かない)');
  if (keyEnv === null) return undefined;
  if (!ENV_NAME.test(keyEnv)) {
    reporter.error(sink.pointer('key_env'), `key_env ${keyEnv} は環境変数名の形(SCREAMING_SNAKE)ではありません`, 'variables の行の id と同じ綴りで書く', { key_env: keyEnv });
    return undefined;
  }
  return keyEnv;
}

/** `retention` を読む。 */
function parseRetention(reader: YamlReader, reporter: SpecReporter): ConfigLoggingDecl['retention'] | null {
  const raw = reader.raw('retention');
  const record = asRecord(raw);
  if (record === null) {
    reporter.error(reader.pointer('retention'), 'retention がありません(ログを残す日数と理由。マッピングで書く)', LOGGING_SUGGESTION);
    return null;
  }
  const retention = new YamlReader(record, reader.pointer('retention'), reporter);
  retention.rejectUnknownKeys(['days', 'reason'], 'logging.retention', LOGGING_SUGGESTION);
  const days = retention.optionalNumber('days', 'days にログを残す日数(正の整数)を書く');
  const reason = retention.requiredString('reason', 'reason に、その日数にした理由を書く(調査に要る期間・法令・費用など)');
  if (days === undefined) {
    if (!retention.has('days')) reporter.error(retention.pointer('days'), 'days がありません', 'days にログを残す日数(正の整数)を書く');
    return null;
  }
  if (!Number.isInteger(days) || days < 1) {
    reporter.error(retention.pointer('days'), `days ${days} は正の整数ではありません`, 'days は 1 以上の整数で書く', { days: String(days) });
    return null;
  }
  if (reason === null) return null;
  return { days, reason };
}
