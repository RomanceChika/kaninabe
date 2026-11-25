/**
 * state_spec({aggregate}/states.md)のパーサー。
 *
 * スキーマの正: domain-spec-writing.md §state_spec。
 * 1 ファイルに状態機械を 1 つ書く形(トップレベルの state_machine)と、
 * 直交する複数の状態フィールドのために複数書く形(machines: のリスト)の両方を受け付ける。
 *
 * ここで見るのは V1(構造・必須フィールド・型・initial/final が states にあるか・by が空でないか)だけ。
 * states[].label / events[].label は生成ドキュメント用の任意項目で、型が違う場合のみ指摘する。
 * 全域性(V3)・到達可能性(V5)・デッドエンド(V6)・final 不変(V7)は検証器が見る。
 */

import type { SettlesTermDecl, StateMachineSpec, StateTone } from './types.js';
import { STATE_TONES } from './types.js';
import { asRecord, checkDocType, elementPointer, SpecReporter, type ParseResult } from './parse-common.js';
import { eachRecord, YamlReader } from './yaml-reader.js';
import { parseEffects, parseEvents, parseForbidden } from './parse-state-event.js';
import { identifierField } from './sql-fields.js';

const TONE_SUGGESTION = `tone は ${STATE_TONES.join(' / ')} のいずれか(省略時は neutral)`;

const SETTLES_VOCABULARY_SUGGESTION =
  'vocabulary.settles に "- id / label" の形で語彙を宣言する(何を確定させるかはこのアプリの' +
  '事情なので体系側に持たない — domain-spec-writing.md)';

const MACHINES_SUGGESTION =
  'machines: に状態機械のマッピング(state_machine / states / initial / final / events)を並べる';

/** 節の要約・段の場面(`summary`)の書き方。 */
const SUMMARY_SUGGESTION =
  'summary は人の言葉の文を空でない文字列で書く(機械の節の要約・状態の場面)。文体の規則は domain-spec-writing.md §summary。' +
  '書かないなら、キーごと消す(ブックに「まだ書かれていない」と出る)';

const STATES_SUGGESTION = 'states: に "- id: {state_id}" の形で状態を列挙する(template.state_spec.md 参照)';

/**
 * states.md のフロントマターを状態機械のリストに変換する。
 *
 * トップレベルに state_machine があれば 1 つの機械として、machines があればその要素ごとに読む。
 * 両方書かれている場合は machines を採用し、併記を V1 違反として記録する。
 *
 * @param data フロントマターのパース結果(unknown)
 * @param file リポジトリルートからの相対パス(Finding の location に入る)
 * @returns 状態機械のリストと V1 違反。フロントマターがマッピングでない場合のみ value=null
 */
export function parseStateSpecs(
  data: unknown,
  file: string,
): ParseResult<readonly StateMachineSpec[]> {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(
      undefined,
      'states.md のフロントマターがマッピングではありません',
      'フロントマターを doc_type: state_spec から始まる YAML マッピングとして書き直す',
    );
    return { value: null, findings: reporter.findings() };
  }

  checkDocType(record, 'state_spec', reporter);
  const root = new YamlReader(record, '', reporter);
  const settlesVocabulary = parseSettlesVocabulary(root, reporter);
  rejectRemovedMachineKey(root, reporter);
  const hasSingle = root.has('state_machine');
  const hasMultiple = root.has('machines');

  if (hasSingle && hasMultiple) {
    reporter.error(
      'machines',
      'state_machine と machines は併記できません',
      '状態機械が 1 つなら state_machine だけを、複数なら machines だけを書く。machines 側を採用して読み進めた',
    );
  }
  if (!hasSingle && !hasMultiple) {
    reporter.error(
      'state_machine',
      'state_machine がありません',
      '状態機械が 1 つなら state_machine: {machine_name} を書く。直交する複数の機械を書くなら machines: のリストにする',
    );
    return { value: [], findings: reporter.findings() };
  }

  const machines = hasMultiple
    ? parseMachineList(root, settlesVocabulary, reporter)
    : collect(parseMachine(root, settlesVocabulary, reporter));
  return { value: machines, findings: reporter.findings() };
}

/**
 * `vocabulary.settles` を読む(ファイル先頭・machines 有無に関わらず 1 回だけ)。
 *
 * このファイルの全機械が共有する語彙であり、`settles` を使わないファイルでは省略できる
 * (省略時は空 — 個々の状態が settles を書けば、その時点で「未宣言」の V1 違反になる)。
 */
function parseSettlesVocabulary(root: YamlReader, reporter: SpecReporter): Readonly<Record<string, string>> {
  const raw = root.raw('vocabulary');
  if (raw === undefined) return {};
  const vocabRecord = asRecord(raw);
  if (vocabRecord === null) {
    reporter.error('vocabulary', 'vocabulary はマッピングで書きます', SETTLES_VOCABULARY_SUGGESTION);
    return {};
  }
  const reader = new YamlReader(vocabRecord, 'vocabulary', reporter);
  const items = reader.optionalList('settles', SETTLES_VOCABULARY_SUGGESTION);
  const terms: SettlesTermDecl[] = [];
  const seen = new Set<string>();
  eachRecord(items, 'vocabulary.settles', reporter, SETTLES_VOCABULARY_SUGGESTION, (item) => {
    const id = item.requiredString('id', 'id に settles の語(スネークケース)を書く');
    const label = item.requiredString('label', 'label に確認文言に載る表示名を書く');
    if (id === null || label === null) return;
    if (seen.has(id)) {
      reporter.error(item.pointer('id'), `settles の語 ${id} が重複しています`, '重複した要素を削除する', { id });
      return;
    }
    seen.add(id);
    terms.push({ id, label });
  });
  return Object.fromEntries(terms.map((term) => [term.id, term.label]));
}

function collect(machine: StateMachineSpec | null): readonly StateMachineSpec[] {
  return machine === null ? [] : [machine];
}

function parseMachineList(
  root: YamlReader,
  settlesVocabulary: Readonly<Record<string, string>>,
  reporter: SpecReporter,
): readonly StateMachineSpec[] {
  const items = root.requiredList('machines', MACHINES_SUGGESTION);
  if (items === null) return [];
  const machines: StateMachineSpec[] = [];
  eachRecord(items, 'machines', reporter, MACHINES_SUGGESTION, (reader) => {
    rejectRemovedMachineKey(reader, reporter);
    const machine = parseMachine(reader, settlesVocabulary, reporter);
    if (machine !== null) machines.push(machine);
  });
  return machines;
}

/**
 * 1 つの状態機械を読む。machine 名・states・initial・final が揃わない場合は null を返す。
 * events / forbidden / effects は機械を構築できない場合でも読む(1 か所の壊れで残りの指摘が消えないため)。
 */
function parseMachine(
  reader: YamlReader,
  settlesVocabulary: Readonly<Record<string, string>>,
  reporter: SpecReporter,
): StateMachineSpec | null {
  // 状態機械名・状態 ID は生成 TS の識別子と import の指定子・生成 SQL の値に置かれるので、識別子の文法で閉じる(R17)。
  const raw = reader.requiredString('state_machine', 'state_machine に状態機械名を書く。例: state_machine: entry');
  const name = identifierField(reader, reporter, 'state_machine', raw);
  const parsed = parseStates(reader, settlesVocabulary, reporter);
  const events = parseEvents(reader, reporter);
  const forbidden = parseForbidden(reader, reporter);
  const effects = parseEffects(reader, reporter);
  if (name === null || parsed === null) return null;

  const { states, stateLabels, stateSummaries, stateTone, stateSettles } = parsed;
  const summary = reader.optionalLabel('summary', SUMMARY_SUGGESTION);
  const initial = readInitial(reader, states, reporter);
  const final = readFinal(reader, states, reporter);
  if (initial === null || final === null) return null;

  return {
    machine: name,
    states,
    stateLabels,
    stateTone,
    stateSettles,
    settlesVocabulary,
    ...(summary === undefined ? {} : { summary }),
    stateSummaries,
    initial,
    final,
    events,
    forbidden,
    effects,
    location: reporter.location(reader.pointer('state_machine')),
  };
}

/** 別綴りだった `machine:` は無くなった。黙って読み捨てず、書き直し先を名指す。 */
function rejectRemovedMachineKey(reader: YamlReader, reporter: SpecReporter): void {
  if (!reader.has('machine')) return;
  reporter.error(
    reader.pointer('machine'),
    'machine: は書けません(state_machine の別綴りは無くなりました)',
    'machine: を state_machine: に書き直す',
  );
}

/** states リストの読み取り結果。ID の並びと、任意の日本語ラベル(書かれた状態のみ)。 */
interface ParsedStates {
  readonly states: readonly string[];
  readonly stateLabels: Readonly<Record<string, string>>;
  readonly stateSummaries: Readonly<Record<string, string>>;
  readonly stateTone: Readonly<Record<string, StateTone>>;
  readonly stateSettles: Readonly<Record<string, readonly string[]>>;
}

function parseStates(
  reader: YamlReader,
  settlesVocabulary: Readonly<Record<string, string>>,
  reporter: SpecReporter,
): ParsedStates | null {
  const items = reader.requiredList('states', STATES_SUGGESTION);
  if (items === null) return null;
  const path = reader.pointer('states');
  const states: string[] = [];
  const stateLabels: Record<string, string> = {};
  const stateSummaries: Record<string, string> = {};
  const stateTone: Record<string, StateTone> = {};
  const stateSettles: Record<string, readonly string[]> = {};
  const settlesIds = new Set(Object.keys(settlesVocabulary));
  const settlesSuggestion =
    settlesIds.size === 0
      ? 'settles を使うには、まず vocabulary.settles に語彙を宣言する(domain-spec-writing.md)'
      : `settles の各要素は ${[...settlesIds].join(' / ')} のいずれか(vocabulary.settles が正)`;
  eachRecord(items, path, reporter, STATES_SUGGESTION, (stateReader) => {
    const id = identifierField(stateReader, reporter, 'id', stateReader.requiredString('id', '状態 ID(スネークケース)を id に書く。例: "- id: draft"'));
    if (id === null) return;
    states.push(id);
    const label = stateReader.optionalString(
      'label',
      'label は人間向けの日本語名を文字列で書く。例: "- id: draft" に対して label: 下書き',
    );
    if (label !== undefined) stateLabels[id] = label;
    const stateSummary = stateReader.optionalLabel('summary', SUMMARY_SUGGESTION);
    if (stateSummary !== undefined) stateSummaries[id] = stateSummary;

    const tone = stateReader.optionalString('tone', TONE_SUGGESTION);
    if (tone !== undefined) {
      if (!(STATE_TONES as readonly string[]).includes(tone)) {
        reporter.error(stateReader.pointer('tone'), `tone "${tone}" は値域にありません`, TONE_SUGGESTION, { tone });
      } else {
        stateTone[id] = tone as StateTone;
      }
    }

    const settles = stateReader.optionalStringList('settles', settlesSuggestion);
    const validSettles = settles.filter((value) => {
      if (settlesIds.has(value)) return true;
      reporter.error(stateReader.pointer('settles'), `settles の "${value}" は vocabulary.settles にありません`, settlesSuggestion, {
        value,
      });
      return false;
    });
    if (validSettles.length > 0) stateSettles[id] = validSettles;
  });
  if (states.length === 0) {
    reporter.error(path, 'states に状態が 1 つもありません', STATES_SUGGESTION);
    return null;
  }
  return { states, stateLabels, stateSummaries, stateTone, stateSettles };
}

function readInitial(
  reader: YamlReader,
  states: readonly string[],
  reporter: SpecReporter,
): string | null {
  const suggestion = `initial に初期状態を書く。states に並べた ${states.join(' / ')} のいずれか`;
  const initial = reader.requiredString('initial', suggestion);
  if (initial === null) return null;
  if (!states.includes(initial)) {
    reporter.error(reader.pointer('initial'), `initial "${initial}" が states にありません`, suggestion, {
      initial,
      states: states.join(', '),
    });
    return null;
  }
  return initial;
}

function readFinal(
  reader: YamlReader,
  states: readonly string[],
  reporter: SpecReporter,
): readonly string[] | null {
  const suggestion = `final に終了状態を書く(無い場合も final: [] を明示する)。要素は ${states.join(' / ')} のいずれか`;
  const final = reader.requiredStringList('final', suggestion);
  if (final === null) return null;
  const path = reader.pointer('final');
  final.forEach((state, index) => {
    if (states.includes(state)) return;
    reporter.error(
      elementPointer(path, index, state),
      `final の "${state}" が states にありません`,
      suggestion,
      { state, states: states.join(', ') },
    );
  });
  return final.filter((state) => states.includes(state));
}
