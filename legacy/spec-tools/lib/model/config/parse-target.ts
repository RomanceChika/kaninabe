/**
 * config_spec の**置き場の軸**(`targets`)を読む。
 *
 * 「値がどこに要るか」は `kind`(画面に出してよいか)からも `requirement`(無いと困る度合い)
 * からも出ない —— CI だけに要る行・どこにも人が入れない行は、性質や要求度の言い換えでは
 * 表せない(設計メモ `docs/design/config-provisioning.md` §3)。そこで置き場を独立の軸にし、
 * **大半は `requirement` の語が宣言した既定から導出し、例外だけを行が宣言する**という形を採る。
 *
 * 導出は**両方向**である(A15 と同じ流儀)—— 導出できないのに宣言が無ければ落とし、
 * **導出できるのに宣言していても落とす**。そうしないと「既定と同じ値を書き写した行」が増え、
 * 既定を変えた日にどこが追随しないかが読めなくなる。
 *
 * 既定の中身(どの要求度がどの置き場を引くか)は**カタログの宣言**であり、このファイルは
 * 語を 1 つも持たない(W1「軸は仕組み、語はアプリ」)。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type { ConfigTermDecl, ConfigVocabularyAxis } from './types.js';
import { CONFIG_VOCABULARY_AXES } from './types.js';
import { knows, reportUnknownTerm } from './vocabulary-lookup.js';

/** 語彙(軸ごと)。 */
type Vocabulary = Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>;

/** `targets` の書き方(違反のときに出す対処)。 */
const TARGETS_SUGGESTION =
  'targets に「値がどこに要るか」を vocabulary.target の語で書く' +
  '(requirement の語の default_targets と同じなら書かない — 導出できる宣言は重複である)';

/**
 * 語彙の軸をまたいだ整合を見る(K0)。
 *
 * - `target` の語は `probe`(名前を列挙する手)を必ず持つ
 * - `probe` / `read_by` は `target` の語だけが持つ
 * - `default_targets` は `requirement` の語だけが持ち、値は `vocabulary.target` に閉じる
 *
 * @param vocabulary カタログが宣言した語彙(軸ごと)
 * @param reporter 違反の記録先
 */
export function validateTargetVocabulary(vocabulary: Vocabulary, reporter: SpecReporter): void {
  for (const axis of CONFIG_VOCABULARY_AXES) {
    for (const term of vocabulary[axis]) {
      validateTerm(axis, term, vocabulary, reporter);
    }
  }
}

/** 語 1 つ分の付随宣言が、その軸に許された形になっているか。 */
function validateTerm(
  axis: ConfigVocabularyAxis,
  term: ConfigTermDecl,
  vocabulary: Vocabulary,
  reporter: SpecReporter,
): void {
  const pointer = (key: string): string => `vocabulary.${axis}.${term.id}.${key}`;
  if (axis === 'target') {
    if (term.probe === undefined) {
      reporter.error(
        pointer('probe'),
        `置き場 ${term.id} に probe がありません`,
        'probe に「その置き場の名前を列挙する手」を宣言する(名前を列挙できない置き場は doctor が見られない)',
        { target: term.id },
      );
    }
  } else {
    for (const key of ['probe', 'read_by'] as const) {
      const declared = key === 'probe' ? term.probe : term.readBy;
      if (declared === undefined) continue;
      reporter.error(
        pointer(key),
        `${axis} の語 ${term.id} が ${key} を持っています`,
        `${key} は vocabulary.target の語だけが持つ(置き場でない語から消す)`,
        { [axis]: term.id },
      );
    }
  }
  validateDefaultTargets(axis, term, vocabulary, reporter);
  if (term.url !== undefined && axis !== 'kind') {
    reporter.error(
      pointer('url'),
      `${axis} の語 ${term.id} が url を持っています`,
      'url は vocabulary.kind の語だけが持つ(この種類の値が URL であることの宣言)',
      { [axis]: term.id },
    );
  }
  if (term.confidential !== undefined && axis !== 'kind') {
    reporter.error(
      pointer('confidential'),
      `${axis} の語 ${term.id} が confidential を持っています`,
      'confidential は vocabulary.kind の語だけが持つ(この種類の値が秘密であることの宣言)',
      { [axis]: term.id },
    );
  }
  if (term.serviceAuth !== undefined && axis !== 'used_by') {
    reporter.error(
      pointer('service_auth'),
      `${axis} の語 ${term.id} が service_auth を持っています`,
      'service_auth は vocabulary.used_by の語だけが持つ(この使い先が共有秘密だけで認証する口であることの宣言)',
      { [axis]: term.id },
    );
  }
}

/** `default_targets` の置き場(requirement だけ)と値の閉世界を見る。 */
function validateDefaultTargets(
  axis: ConfigVocabularyAxis,
  term: ConfigTermDecl,
  vocabulary: Vocabulary,
  reporter: SpecReporter,
): void {
  const values = term.defaultTargets;
  if (values === undefined) return;
  const pointer = `vocabulary.${axis}.${term.id}.default_targets`;
  if (axis !== 'requirement') {
    reporter.error(
      pointer,
      `${axis} の語 ${term.id} が default_targets を持っています`,
      'default_targets は vocabulary.requirement の語だけが持つ(行が targets を省略したときの既定)',
      { [axis]: term.id },
    );
    return;
  }
  checkTargetList(values, pointer, `requirement ${term.id} の default_targets`, vocabulary, reporter);
}

/**
 * 1 行分の `targets` を決める(宣言 or `requirement` からの導出)。
 *
 * @param item 行のマッピング
 * @param id 環境変数名(違反の文に出す)
 * @param requirement その行の要求度(既定の引き先)
 * @param vocabulary カタログが宣言した語彙(軸ごと)
 * @param reporter 違反の記録先
 * @returns 置き場のリスト。決められなければ null(行ごと落とす)
 */
export function resolveTargets(
  item: YamlReader,
  id: string,
  requirement: string,
  vocabulary: Vocabulary,
  reporter: SpecReporter,
): readonly string[] | null {
  const fallback = vocabulary.requirement.find((term) => term.id === requirement)?.defaultTargets;
  if (!item.has('targets')) return derivedTargets(item, id, requirement, fallback, reporter);

  const declared = item.optionalStringList('targets', TARGETS_SUGGESTION);
  if (!checkTargetList(declared, item.pointer('targets'), `設定 ${id} の targets`, vocabulary, reporter)) {
    return null;
  }
  if (fallback !== undefined && sameSet(declared, fallback)) {
    reporter.error(
      item.pointer('targets'),
      `設定 ${id} の targets は requirement ${requirement} の既定と同じです`,
      `targets を消す(requirement ${requirement} の default_targets から導出される)`,
      { variable: id, requirement, targets: declared.join(' / ') || '(空)' },
    );
    return null;
  }
  return declared;
}

/** `targets` を省略した行の置き場(`requirement` の語の `default_targets`)を返す。 */
function derivedTargets(
  item: YamlReader,
  id: string,
  requirement: string,
  fallback: readonly string[] | undefined,
  reporter: SpecReporter,
): readonly string[] | null {
  if (fallback !== undefined) return fallback;
  reporter.error(
    item.pointer('targets'),
    `設定 ${id} の置き場が決まりません(requirement ${requirement} に default_targets がありません)`,
    `この行に targets を書くか、vocabulary.requirement の ${requirement} に default_targets を宣言する` +
      '(「どこにも人が入れない」なら空リストを宣言する — 黙って決まらないままにしない)',
    { variable: id, requirement },
  );
  return null;
}

/** 置き場のリストが語彙に閉じていて重複が無いか。 */
function checkTargetList(
  values: readonly string[],
  pointer: string,
  what: string,
  vocabulary: Vocabulary,
  reporter: SpecReporter,
): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    if (!knows(vocabulary, 'target', value)) {
      reportUnknownTerm(pointer, 'target', value, vocabulary, reporter);
      return false;
    }
    if (seen.has(value)) {
      reporter.error(pointer, `${what} に ${value} が重複しています`, '重複した語を削除する', { target: value });
      return false;
    }
    seen.add(value);
  }
  return true;
}

/** 2 つの置き場のリストが集合として同じか(並びの違いは意味を持たない)。 */
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(right);
  return left.every((value) => set.has(value));
}
