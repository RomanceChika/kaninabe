/**
 * job_spec(ジョブカタログ)のパーサー(J0 = スキーマ適合 + 語彙の閉世界)。
 *
 * スキーマの正: job-spec-writing.md。
 * ここで見るのは 1 ファイルの中で閉じる形だけである — 行の `kind` / `on_failure` が
 * **同じファイルが宣言した語彙**に載っていること(語彙の一覧を体系側に持たないための形)、
 * `source` がフレームワーク固定の値域にあること、そして**軸ごとに書けるキーが違う**こと
 * (時刻の宣言を outbox の行に書かせない)。`effects` / Cron / 実装との突合は J1・J2 が行う。
 */

import type { SpecReporter } from '../parse-common.js';
import { checkDocType, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { parseTestCases } from '../parse-test-case.js';
import type { JobCatalogSpec, JobDecl, JobSource, JobTermDecl, JobVocabularyAxis } from './types.js';
import { DECLARABLE_KEY_SOURCE, JOB_SOURCES, JOB_VOCABULARY_AXES } from './types.js';
import { parseSchedule, RENAME_HINT, SCHEDULE_ONLY_KEYS } from './parse-schedule.js';
import { parseRealizedBy } from './parse-realized-by.js';
import { parseAnonymizeCall, parseAnonymizeJob, parseEndsSessions } from './parse-ends-sessions.js';
import { parseVocabulary, SNAKE } from './parse-vocabulary.js';

/** `source: outbox` の行だけが書けるキー(匿名化の対象の集約。他の軸の行に現れたら軸の取り違え)。 */
const OUTBOX_ONLY_KEYS = ['anonymizes'] as const;

/** カタログの文書 ID(1 プロジェクト 1 カタログなので導出元が無く固定)。 */
export const JOB_CATALOG_ID = 'job-catalog';

/**
 * ジョブカタログ 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @returns 構築したカタログと J0 違反
 */
export function parseJobCatalog(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ParseResult<JobCatalogSpec> {
  checkDocType(data, 'job_spec', reporter);
  const root = new YamlReader(data, '', reporter);

  const id = root.requiredString('id', `id を ${JOB_CATALOG_ID} と書く(1 プロジェクト 1 カタログ)`);
  if (id !== null && id !== JOB_CATALOG_ID) {
    reporter.error('id', `id ${id} はカタログの id ではありません`, `id: ${JOB_CATALOG_ID} に直す`, {
      id,
      expected: JOB_CATALOG_ID,
    });
  }
  const vocabulary = parseVocabulary(root, reporter);
  const jobs = parseJobs(root, vocabulary, reporter);
  const testCases = parseTestCases(root, reporter) ?? [];

  return {
    value: { id: JOB_CATALOG_ID, vocabulary, jobs, testCases, location: reporter.location() },
    findings: reporter.findings(),
  };
}

/** jobs を読む。行の語彙は宣言された vocabulary に閉じていなければならない。 */
function parseJobs(
  root: YamlReader,
  vocabulary: Readonly<Record<JobVocabularyAxis, readonly JobTermDecl[]>>,
  reporter: SpecReporter,
): readonly JobDecl[] {
  const items = root.optionalList(
    'jobs',
    'jobs は "- id / source / kind / on_failure / summary" のリストで書く',
  );
  const jobs: JobDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'jobs', reporter, 'id と source と kind と on_failure と summary を持つ要素として書く', (item, index) => {
    const id = item.requiredString('id', 'id にジョブ ID(スネークケース)を書く');
    if (id === null) return;
    if (!SNAKE.test(id)) {
      reporter.error(item.pointer('id'), `ジョブ ID ${id} がスネークケースではありません`, 'スネークケースに直す', { id });
      return;
    }
    if (seen.has(id)) {
      reporter.error(`jobs[${index}].id`, `ジョブ ID ${id} が重複しています`, '重複した行を削除する', { id });
      duplicates += 1;
      return;
    }
    seen.add(id);
    const decl = buildDecl(item, id, vocabulary, reporter);
    if (decl !== null) jobs.push(decl);
  });
  reporter.settleRows(items.length, jobs.length, duplicates);
  return jobs;
}

/** 1 行分を読む。1 つでも読めなければ行ごと落とす。 */
function buildDecl(
  item: YamlReader,
  id: string,
  vocabulary: Readonly<Record<JobVocabularyAxis, readonly JobTermDecl[]>>,
  reporter: SpecReporter,
): JobDecl | null {
  const source = parseSource(item, reporter);
  if (source === null) return null;
  const axes = parseAxes(item, vocabulary, reporter);
  if (axes === null) return null;
  const summary = item.requiredString('summary', 'summary に「何をするか」を 1 行で書く');
  if (summary === null) return null;

  // 匿名化の対象を持てるのは `outbox` の行だけである(他の軸の行に書かれたら軸の取り違え)。
  const anonymizes = parseOutboxOnly(item, id, source, reporter);
  if (anonymizes === null) return null;
  const anonymizesPart = anonymizes === undefined ? {} : { anonymizes };
  // セッションを終える対象(R11)も outbox の行だけが書ける。2 つのキー(対象の集約・認証基盤の呼び出しを持つ RPC)は対で要る。
  const endsSessions = parseEndsSessions(item, id, source, reporter);
  if (endsSessions === null) return null;
  const endsSessionsPart = endsSessions === undefined ? {} : endsSessions;
  // 匿名化の行の認証基盤の呼び出し(点検 14 回目 A14-5)。`anonymizes` と対で書ける。
  const anonymizeCall = anonymizes === undefined || endsSessions !== undefined ? undefined : parseAnonymizeCall(item, id, reporter);
  if (anonymizeCall === null) return null;
  const anonymizeJob = anonymizes === undefined ? undefined : parseAnonymizeJob(item, id, reporter);
  if (anonymizeJob === null) return null;
  const anonymizeCallPart = {
    ...(anonymizeCall === undefined ? {} : { platformCall: anonymizeCall }),
    ...(anonymizeJob === undefined ? {} : { platformJob: anonymizeJob }),
  };

  // `kind` の語が `in_transaction` を宣言していれば、その行は書き込みと同じトランザクションで実現される。
  // 実現を起こすのはドメインイベントの `effects`(outbox)だけなので、他の軸の行には使えない。
  const inTransaction = vocabulary.kind.find((term) => term.id === axes.kind)?.inTransaction === true;
  if (inTransaction && source !== 'outbox') {
    reporter.error(
      item.pointer('kind'),
      `${source} のジョブ ${id} の kind ${axes.kind} は書き込みと同じトランザクションで実現される語(in_transaction)です`,
      '同一トランザクションで実現される効果は outbox(ドメインイベントの effects)の行だけである。source: outbox に直すか、別の kind を選ぶ',
      { job: id, kind: axes.kind },
    );
    return null;
  }
  const realizedBy = parseRealizedBy(item, id, inTransaction, reporter);
  if (realizedBy === null) return null;
  const inTransactionPart = {
    ...(inTransaction ? { inTransaction } : {}),
    ...(realizedBy === undefined ? {} : { realizedBy }),
  };

  // `declares` を持つ語(その語の行が必ず持つキー)の行も同じ。キーごとに持てる軸が決まっており
  // (匿名化の対象は outbox・積む通知の一覧は schedule)、他の軸の行がその語を選ぶと宣言が満たせない
  // (キーを書けば軸の取り違えになる)。
  const declared = vocabulary.kind.find((term) => term.id === axes.kind)?.declares ?? [];
  const unplaceable = declared.filter((key) => DECLARABLE_KEY_SOURCE[key] !== source);
  if (unplaceable.length > 0) {
    reporter.error(
      item.pointer('kind'),
      `${source} のジョブ ${id} の kind ${axes.kind} は行が必ず持つキー(declares: ${unplaceable.join(' / ')})を宣言する語です`,
      `その宣言のキーを持てるのは ${unplaceable.map((key) => DECLARABLE_KEY_SOURCE[key]).join(' / ')} の行だけである。` +
        `source を直すか、別の kind を選ぶ`,
      { job: id, kind: axes.kind },
    );
    return null;
  }

  // 時刻の宣言を持てるのは `schedule` だけである(発火元が時刻でないものに cron 式を書かせない)。
  if (source !== 'schedule') {
    // 旧いキー `runner`(鳴る場所の旧い綴り)も、schedule の行と同じく黙って通さない(見るのはこの 1 キーだけ)。
    if (item.has('runner')) {
      reporter.error(
        item.pointer('runner'),
        `${source} のジョブ ${id} に廃止されたキー runner が書かれています`,
        `${RENAME_HINT}。ただし ${source} は発火元が時刻ではないので鳴る場所を持たない(schedule 以外の行には書かない。キーを消す)`,
        { job: id },
      );
      return null;
    }
    const misplaced = SCHEDULE_ONLY_KEYS.filter((key) => item.has(key));
    if (misplaced.length > 0) {
      reporter.error(
        item.pointer(misplaced[0] ?? 'schedule'),
        `${source} のジョブ ${id} に時刻の宣言(${misplaced.join(' / ')})が書かれています`,
        `${source} は発火元が時刻ではないので時刻の宣言を持たない(source: schedule に直すか、キーを消す)`,
        { job: id, keys: misplaced.join(',') },
      );
      return null;
    }
    return { id, source, kind: axes.kind, onFailure: axes.on_failure, summary, ...anonymizesPart, ...anonymizeCallPart, ...endsSessionsPart, ...inTransactionPart, location: reporter.location(`jobs.${id}`) };
  }

  const schedule = parseSchedule(item, id, reporter);
  if (schedule === null) return null;
  return {
    id,
    source,
    kind: axes.kind,
    onFailure: axes.on_failure,
    summary,
    ...anonymizesPart,
    ...anonymizeCallPart,
    ...endsSessionsPart,
    ...inTransactionPart,
    schedule,
    location: reporter.location(`jobs.${id}`),
  };
}

/**
 * `source: outbox` の行だけが書けるキー(`anonymizes`)を読む。
 *
 * `manual`(人が押して積む)の行に書かれたら軸の取り違えとして落とす(`null`)。キーが無ければ `undefined`。
 */
function parseOutboxOnly(
  item: YamlReader,
  id: string,
  source: JobSource,
  reporter: SpecReporter,
): string | undefined | null {
  const present = OUTBOX_ONLY_KEYS.filter((key) => item.has(key));
  if (present.length === 0) return undefined;
  if (source !== 'outbox') {
    misplacedOutboxKeys(item, id, source, present, reporter);
    return null;
  }
  const target = item.requiredString('anonymizes', 'anonymizes に匿名化する集約の id(スネークケース)を書く');
  if (target === null) return null;
  if (!SNAKE.test(target)) {
    reporter.error(item.pointer('anonymizes'), `ジョブ ${id} の anonymizes ${target} がスネークケースではありません`, 'スネークケースの集約 id に直す', {
      job: id,
      anonymizes: target,
    });
    return null;
  }
  return target;
}

/** outbox 専用のキーが別の軸の行に書かれたことを報告する(行ごと落とすので `null` を返す)。 */
function misplacedOutboxKeys(
  item: YamlReader,
  id: string,
  source: JobSource,
  keys: readonly string[],
  reporter: SpecReporter,
): null {
  reporter.error(
    item.pointer(keys[0] ?? 'anonymizes'),
    `${source} のジョブ ${id} に outbox 専用の宣言(${keys.join(' / ')})が書かれています`,
    '匿名化する効果は書き込みと同一トランザクションで実現される outbox の効果である(source: outbox に直すか、キーを消す)',
    { job: id, keys: keys.join(',') },
  );
  return null;
}

/** `source` を値域から読む。 */
function parseSource(item: YamlReader, reporter: SpecReporter): JobSource | null {
  const source = item.requiredString('source', `source を ${JOB_SOURCES.join(' / ')} から書く`);
  if (source === null) return null;
  if (!(JOB_SOURCES as readonly string[]).includes(source)) {
    reporter.error(
      item.pointer('source'),
      `source ${source} は値域(${JOB_SOURCES.join(' / ')})にありません`,
      'outbox(effects から積まれる)/ schedule(時刻で起きる)/ manual(人が押して積まれる)のどれかに直す',
      { source },
    );
    return null;
  }
  return source as JobSource;
}

/** カタログが宣言した語彙に閉じている軸(`kind` / `on_failure`)を読む。 */
function parseAxes(
  item: YamlReader,
  vocabulary: Readonly<Record<JobVocabularyAxis, readonly JobTermDecl[]>>,
  reporter: SpecReporter,
): Record<JobVocabularyAxis, string> | null {
  const values = {} as Record<JobVocabularyAxis, string>;
  for (const axis of JOB_VOCABULARY_AXES) {
    const value = item.requiredString(axis, `${axis} を vocabulary.${axis} に宣言した語から選ぶ`);
    if (value === null) return null;
    const known = vocabulary[axis].map((term) => term.id);
    if (!known.includes(value)) {
      reporter.error(
        item.pointer(axis),
        `${axis} ${value} は vocabulary.${axis} に宣言されていません`,
        `vocabulary.${axis} の語(${known.join(' / ') || '未宣言'})から選ぶか、語彙の側に足す`,
        { [axis]: value },
      );
      return null;
    }
    values[axis] = value;
  }
  return values;
}
