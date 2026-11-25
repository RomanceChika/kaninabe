/**
 * config_spec の `vocabulary.target` が語ごとに持つ付随宣言 —— `probe`(置き場の名前を
 * 列挙する手)と `read_by`(その置き場の名前をリポジトリの中で読んでいる場所)—— のパーサー。
 *
 * **体系側が持つのは `kind` の値域だけ**である(`CONFIG_PROBE_KINDS` /
 * `CONFIG_READ_BY_KINDS`)。置き場の名前もコマンドの綴りもファイルのパスも、すべてカタログが
 * 宣言する(「軸は仕組み、語はアプリ」— dsl-extension-triage.md §軸と語)。基盤を替える日に
 * 直すのはカタログの 10 行であり、このファイルではない。
 *
 * `probe` の `kind` が 2 語しかないことが「**道具は値を読めない**」の担保である ——
 * 値を返す形はこの値域に無いので、宣言として書けない(設計メモ §3-1)。
 *
 * ただし `kind: command` は宣言した argv をそのまま実行する。仕様の束は信頼できない入力でありうるので、
 * **実行してよい argv の形と位置は閉じた許可表で縛る**(`probe-policy.ts`。製品の実行器の `probe-guard.ts` も同じ表で二重に縛る)。
 * 「道具は値を読まない」の担保は、`kind` の値域と、この許可表の両方である。
 */

import type { SpecReporter } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import { PROBE_COMMAND_SUGGESTION, PROBE_CWD_CHOICES, commandCwdProblem, commandProbeProblem, rootRelativePathProblem } from './probe-policy.js';
import type { ConfigProbe, ConfigReadBy, ConfigTermDecl } from './types.js';
import { CONFIG_PROBE_KINDS, CONFIG_READ_BY_KINDS } from './types.js';

/** `probe` の書き方(違反のときに出す対処)。 */
const PROBE_SUGGESTION =
  'probe を "{ kind: dotenv, path: {ファイル} }" か "{ kind: command, argv: [{コマンド}, ...] }" で書く' +
  '(名前の列挙しか返さない形だけが書ける — 値を返す probe は宣言できない)';

/** `read_by` の書き方(違反のときに出す対処)。 */
const READ_BY_SUGGESTION =
  'read_by を "{ kind: workflow_secret, path: {ディレクトリ} }" で書く' +
  '(この置き場の名前をリポジトリの中で読んでいる場所)';

/**
 * 語の下のマッピングを読む器を作る。マッピングでなければ違反を記録して null。
 *
 * @param item 語のマッピング
 * @param key 読むキー(`probe` / `read_by`)
 * @param suggestion 違反のときに出す対処
 * @param reporter 違反の記録先
 * @returns 読み器。キーが無ければ undefined、型が違えば null
 */
function nested(
  item: YamlReader,
  key: string,
  suggestion: string,
  reporter: SpecReporter,
): YamlReader | null | undefined {
  if (!item.has(key)) return undefined;
  const raw = item.raw(key);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    reporter.error(item.pointer(key), `${key} がマッピングではありません`, suggestion);
    return null;
  }
  return new YamlReader(raw as Readonly<Record<string, unknown>>, item.pointer(key), reporter);
}

/**
 * 語の付随宣言(`probe` / `read_by` / `default_targets`)を読む。
 *
 * どの軸の語にも同じ形で読み、**どの軸が持ってよいかの判定は `validateTargetVocabulary`** が
 * 語彙全体を見てから行う(置き場の語が揃う前には判定できない)。1 つでも読めなければ null を
 * 返して語ごと落とす(壊れた宣言を半端に通すと、後段の閉世界の指摘が本当の原因を隠す)。
 *
 * @param item 語のマッピング
 * @param reporter 違反の記録先
 * @returns 付随宣言(無い分は欠けたまま)。読めなければ null
 */
export function parseTermExtras(item: YamlReader, reporter: SpecReporter): Partial<ConfigTermDecl> | null {
  const probe = parseProbe(item, reporter);
  if (probe === null) return null;
  const readBy = parseReadBy(item, reporter);
  if (readBy === null) return null;
  const defaults = item.has('default_targets')
    ? item.optionalStringList('default_targets', 'default_targets に既定の置き場を vocabulary.target の語で書く')
    : undefined;
  const url = item.has('url')
    ? item.optionalBoolean('url', 'url は true / false で書く(この種類の値が URL なら true。kind の語だけが持つ)')
    : undefined;
  const confidential = item.has('confidential')
    ? item.optionalBoolean('confidential', 'confidential は true / false で書く(この種類の値が秘密なら true。kind の語だけが持つ)')
    : undefined;
  const serviceAuth = item.has('service_auth')
    ? item.optionalBoolean('service_auth', 'service_auth は true / false で書く(この使い先が共有秘密だけで認証する口なら true。used_by の語だけが持つ)')
    : undefined;
  return {
    ...(url === undefined ? {} : { url }),
    ...(confidential === undefined ? {} : { confidential }),
    ...(serviceAuth === undefined ? {} : { serviceAuth }),
    ...(probe === undefined ? {} : { probe }),
    ...(readBy === undefined ? {} : { readBy }),
    ...(defaults === undefined ? {} : { defaultTargets: defaults }),
  };
}

/**
 * 語の `probe` を読む。
 *
 * @param item 語のマッピング
 * @param reporter 違反の記録先
 * @returns 名前を列挙する手。宣言が無ければ undefined、読めなければ null
 */
function parseProbe(item: YamlReader, reporter: SpecReporter): ConfigProbe | null | undefined {
  const reader = nested(item, 'probe', PROBE_SUGGESTION, reporter);
  if (reader === undefined || reader === null) return reader;
  const kind = reader.requiredString('kind', PROBE_SUGGESTION);
  if (kind === null) return null;
  if (!isProbeKind(kind)) {
    reporter.error(
      reader.pointer('kind'),
      `probe.kind ${kind} は体系が持つ値域にありません`,
      `probe.kind を ${CONFIG_PROBE_KINDS.join(' / ')} から選ぶ(${PROBE_SUGGESTION})`,
      { kind },
    );
    return null;
  }
  return kind === 'dotenv' ? parseDotenvProbe(reader, reporter) : parseCommandProbe(reader, reporter);
}

/** 位置の宣言(`cwd` / `dotenv.path`)が根の中の相対パスの綴りか。外れたら違反を記録して false。 */
function checkRootRelative(reader: YamlReader, key: string, value: string, reporter: SpecReporter): boolean {
  const problem = rootRelativePathProblem(value);
  if (problem === null) return true;
  reporter.error(
    reader.pointer(key),
    `probe.${key} が安全な位置ではありません: ${problem}`,
    `probe.${key} をリポジトリルートからの相対パス(\`..\`・絶対パス・\`~\` なし)で書く`,
  );
  return false;
}

/** `kind: dotenv` の probe を読む(読むのはキー名だけ)。 */
function parseDotenvProbe(reader: YamlReader, reporter: SpecReporter): ConfigProbe | null {
  const path = reader.requiredString('path', PROBE_SUGGESTION);
  if (path === null || !checkRootRelative(reader, 'path', path, reporter)) return null;
  return { kind: 'dotenv', path };
}

/**
 * `kind: command` の probe を読む(出力に名前が現れるかだけを見る)。
 *
 * **argv は閉じた許可表(`probe-policy.ts`)の形だけ**。`kind: command` は宣言した argv をそのまま実行するので、
 * 表に無い形(`sh -c` ・任意の実行ファイル・パスつきの実行ファイル・`npx`)は宣言として書けない。`cwd` も閉じた表(`.` / `app`)だけ
 * (根の中の任意の場所を許すと、そこに植えた `node_modules` / `.npmrc` を道具が拾いうる — 4 回目 C4-3)。
 */
function parseCommandProbe(reader: YamlReader, reporter: SpecReporter): ConfigProbe | null {
  const argv = reader.requiredStringList('argv', PROBE_SUGGESTION, false);
  if (argv === null) return null;
  const problem = commandProbeProblem(argv);
  if (problem !== null) {
    reporter.error(reader.pointer('argv'), `probe.argv を実行できません: ${problem}`, PROBE_COMMAND_SUGGESTION);
    return null;
  }
  const cwd = reader.optionalString('cwd', 'cwd に実行する位置(リポジトリルート相対)を書く');
  if (cwd !== undefined && !checkRootRelative(reader, 'cwd', cwd, reporter)) return null;
  const cwdProblem = cwd === undefined ? null : commandCwdProblem(cwd);
  if (cwdProblem !== null) {
    reporter.error(reader.pointer('cwd'), `probe.cwd が安全な位置ではありません: ${cwdProblem}`, `probe.cwd は ${PROBE_CWD_CHOICES.join(' / ')} のどれかにする(省略は .)`);
    return null;
  }
  return { kind: 'command', argv, ...(cwd === undefined ? {} : { cwd }) };
}

/**
 * 語の `read_by` を読む。
 *
 * @param item 語のマッピング
 * @param reporter 違反の記録先
 * @returns 読み口。宣言が無ければ undefined、読めなければ null
 */
function parseReadBy(item: YamlReader, reporter: SpecReporter): ConfigReadBy | null | undefined {
  const reader = nested(item, 'read_by', READ_BY_SUGGESTION, reporter);
  if (reader === undefined || reader === null) return reader;
  const kind = reader.requiredString('kind', READ_BY_SUGGESTION);
  if (kind === null) return null;
  if (!isReadByKind(kind)) {
    reporter.error(
      reader.pointer('kind'),
      `read_by.kind ${kind} は体系が持つ値域にありません`,
      `read_by.kind を ${CONFIG_READ_BY_KINDS.join(' / ')} から選ぶ(${READ_BY_SUGGESTION})`,
      { kind },
    );
    return null;
  }
  const path = reader.requiredString('path', READ_BY_SUGGESTION);
  return path === null ? null : { kind, path };
}

/** 体系が持つ probe の種類か。 */
function isProbeKind(value: string): value is ConfigProbe['kind'] {
  return CONFIG_PROBE_KINDS.some((kind) => kind === value);
}

/** 体系が持つ読み口の種類か。 */
function isReadByKind(value: string): value is ConfigReadBy['kind'] {
  return CONFIG_READ_BY_KINDS.some((kind) => kind === value);
}
