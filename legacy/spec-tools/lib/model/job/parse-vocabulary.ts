/**
 * job_spec(ジョブカタログ)の語彙(`vocabulary`)のパーサー。
 *
 * 軸(`kind` / `on_failure`)は体系が持ち、語はカタログ文書が宣言する。**`kind` の語だけが
 * `in_transaction`**(その語の行は書き込みと同じトランザクションで実現される)を宣言できる。
 * 行が語に閉じていること・行の軸ごとのキーは `parse-jobs.ts` が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { JobDeclarableKey, JobFailureMeaning, JobTermDecl, JobVocabularyAxis } from './types.js';
import { JOB_DECLARABLE_KEYS, JOB_FAILURE_MEANINGS, JOB_VOCABULARY_AXES } from './types.js';

/** 識別子(スネークケース)。 */
export const SNAKE = /^[a-z][a-z0-9_]*$/;

const VOCABULARY_SUGGESTION =
  'vocabulary に kind / on_failure の語彙を "- id / label" のリストで宣言する' +
  '(語彙はこのアプリの事情なので体系側に持たない — job-spec-writing.md)';

/** vocabulary を軸ごとに読む。軸そのものは体系が持ち、語彙は仕様が宣言する。 */
export function parseVocabulary(
  root: YamlReader,
  reporter: SpecReporter,
): Record<JobVocabularyAxis, readonly JobTermDecl[]> {
  const raw = root.raw('vocabulary');
  const reader =
    raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)
      ? null
      : new YamlReader(raw as Readonly<Record<string, unknown>>, 'vocabulary', reporter);
  if (reader === null) {
    reporter.error('vocabulary', 'vocabulary がありません', VOCABULARY_SUGGESTION);
    reporter.dropRows();
  }
  const result = {} as Record<JobVocabularyAxis, readonly JobTermDecl[]>;
  for (const axis of JOB_VOCABULARY_AXES) {
    result[axis] = reader === null ? [] : parseTerms(reader, axis, reporter);
  }
  return result;
}

/** 1 軸分の語彙を読む。重複した語は突合キーが壊れるのでここで落とす。 */
function parseTerms(
  reader: YamlReader,
  axis: JobVocabularyAxis,
  reporter: SpecReporter,
): readonly JobTermDecl[] {
  const items = reader.optionalList(axis, VOCABULARY_SUGGESTION);
  if (items.length === 0) {
    reporter.error(`vocabulary.${axis}`, `vocabulary.${axis} が空です`, VOCABULARY_SUGGESTION);
    return [];
  }
  const terms: JobTermDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, `vocabulary.${axis}`, reporter, VOCABULARY_SUGGESTION, (item, index) => {
    const id = item.requiredString('id', `id に ${axis} の語(スネークケース)を書く`);
    if (id === null) return;
    if (!SNAKE.test(id)) {
      reporter.error(item.pointer('id'), `${axis} の語 ${id} がスネークケースではありません`, VOCABULARY_SUGGESTION, { id });
      return;
    }
    if (seen.has(id)) {
      reporter.error(`vocabulary.${axis}[${index}].id`, `${axis} の語 ${id} が重複しています`, '重複した要素を削除する', { id });
      duplicates += 1;
      return;
    }
    seen.add(id);
    const label = item.optionalLabel('label', 'label に人間向けの表示名を書く(未定なら書かない)');
    const inTransaction = parseInTransaction(item, axis, id, reporter);
    const declares = parseDeclares(item, axis, id, reporter);
    const means = parseMeans(item, axis, id, reporter);
    terms.push({
      id,
      ...(label === undefined ? {} : { label }),
      ...(inTransaction ? { inTransaction } : {}),
      ...(declares.length > 0 ? { declares } : {}),
      ...(means === undefined ? {} : { means }),
    });
  });
  reporter.settleRows(items.length, terms.length, duplicates);
  return terms;
}

/**
 * 語の `in_transaction`(この語の行は書き込みと同じトランザクションで実現される)を読む。
 *
 * `kind` の語だけが宣言できる(`on_failure` の語に書かれたら軸の取り違えとして報告する)。
 * 返すのは「true と宣言されたか」だけである(宣言が無い・false は同じ扱い)。
 */
function parseInTransaction(item: YamlReader, axis: JobVocabularyAxis, id: string, reporter: SpecReporter): boolean {
  if (!item.has('in_transaction')) return false;
  if (axis !== 'kind') {
    reporter.error(
      item.pointer('in_transaction'),
      `${axis} の語 ${id} に in_transaction が書かれています`,
      'in_transaction は kind の語だけが宣言できる(その種類の効果が書き込みと同じトランザクションで実現されるか)。行を消す',
      { axis, id },
    );
    return false;
  }
  return item.optionalBoolean(
    'in_transaction',
    'in_transaction は true / false で書く(その kind の効果は書き込みと同じトランザクションで実現される)',
  );
}

/**
 * 語の `declares`(この語の行が必ず持つキーの一覧)を読む。
 *
 * `kind` の語だけが宣言できる(`on_failure` の語に書かれたら軸の取り違え)。書けるキーは体系が固定する
 * (`JOB_DECLARABLE_KEYS`。機械が読む軸が「キーの有無」で表されるものだけ)。宣言が無い語は空を返す。
 */
function parseDeclares(
  item: YamlReader,
  axis: JobVocabularyAxis,
  id: string,
  reporter: SpecReporter,
): readonly JobDeclarableKey[] {
  if (!item.has('declares')) return [];
  if (axis !== 'kind') {
    reporter.error(
      item.pointer('declares'),
      `${axis} の語 ${id} に declares が書かれています`,
      'declares は kind の語だけが宣言できる(その語の行が必ず持つキー)。行を消す',
      { axis, id },
    );
    return [];
  }
  const suggestion = `declares は [${JOB_DECLARABLE_KEYS.join(', ')}] のうち、その語の行が必ず持つキーを並べる`;
  const keys = item.requiredStringList('declares', suggestion, false);
  if (keys === null) return [];
  const known: readonly string[] = JOB_DECLARABLE_KEYS;
  const declared: JobDeclarableKey[] = [];
  for (const key of keys) {
    if (!known.includes(key)) {
      reporter.error(item.pointer('declares'), `${axis} の語 ${id} の declares ${key} は宣言できるキーではありません`, suggestion, { id, key });
    } else if (declared.includes(key as JobDeclarableKey)) {
      reporter.error(item.pointer('declares'), `${axis} の語 ${id} の declares ${key} が重複しています`, '重複した要素を削除する', { id, key });
    } else {
      declared.push(key as JobDeclarableKey);
    }
  }
  return declared;
}

/**
 * 語の `means`(その語が「失敗したらどうなるか」の意味)を読む。
 *
 * **`on_failure` の語だけが宣言でき、`on_failure` の語は必ず宣言する**(`kind` の語に書かれたら軸の取り違え)。
 * 値域は体系が固定する(`JOB_FAILURE_MEANINGS`)。語の綴りは体系が比べず、行と語の対は J6 が見る。
 * 読めなければ undefined(報告は済ませてある)。
 */
function parseMeans(
  item: YamlReader,
  axis: JobVocabularyAxis,
  id: string,
  reporter: SpecReporter,
): JobFailureMeaning | undefined {
  const suggestion = `means は [${JOB_FAILURE_MEANINGS.join(' / ')}] から、その語の失敗の意味を 1 つ書く`;
  if (axis !== 'on_failure') {
    if (item.has('means')) {
      reporter.error(
        item.pointer('means'),
        `${axis} の語 ${id} に means が書かれています`,
        'means は on_failure の語だけが宣言できる(その語が失敗したらどうなるか)。行を消す',
        { axis, id },
      );
    }
    return undefined;
  }
  const means = item.requiredString('means', suggestion);
  if (means === null) return undefined;
  const known: readonly string[] = JOB_FAILURE_MEANINGS;
  if (!known.includes(means)) {
    reporter.error(item.pointer('means'), `${axis} の語 ${id} の means ${means} は値域にありません`, suggestion, { id, means });
    return undefined;
  }
  return means as JobFailureMeaning;
}
