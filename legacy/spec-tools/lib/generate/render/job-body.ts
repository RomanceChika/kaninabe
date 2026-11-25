/**
 * ジョブカタログ(docs/specs/backend/jobs.md)の本文ブロックの生成器。
 *
 * YAML フロントマターが正であり、本文はそのマトリクスにすぎない(生成は情報を足さない)。
 * `source: outbox` の行には**発火元イベントを effects から引いて**添える(宣言の二重化を避ける)。
 * 時刻で起きるジョブは別の表にする — 見たい列(いつ・どこを叩く・何を実行する・「そのとき」の供給元)が
 * 丸ごと違うので、1 つの表に混ぜると半分が空欄になる。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { JobCatalogSpec, JobVocabularyAxis } from '../../model/job/types.js';
import { JOB_VOCABULARY_AXES } from '../../model/job/types.js';
import { collectJobEffects } from '../../semantics/effect-refs.js';
import { emittedBy } from '../../job/emits.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先(リポジトリルート相対)。 */
export function jobsFile(roots: ProductRoots): string {
  return specPath(roots, 'backend/jobs.md');
}

/** 軸の見出し(語彙の表に出す日本語)。 */
const AXIS_TITLE: Readonly<Record<JobVocabularyAxis, string>> = {
  kind: '種別(kind)',
  on_failure: '失敗時(on_failure)',
};

/**
 * ジョブ ID → それを積んでいるドメインイベントの一覧を作る。
 *
 * @param model ドメイン仕様全体
 * @returns ジョブ ID をキーにしたイベント ID の並び(宣言順・重複なし)
 */
export function enqueueingEvents(model: SpecModel): ReadonlyMap<string, readonly string[]> {
  const byId = new Map<string, string[]>();
  for (const ref of collectJobEffects(model)) {
    const events = byId.get(ref.id) ?? [];
    if (!events.includes(ref.event)) events.push(ref.event);
    byId.set(ref.id, events);
  }
  return byId;
}

/**
 * ジョブ ID → それを積む走査のジョブ ID の一覧(`emits`)を、表の「積む元」の列の語にする。
 *
 * 遷移で積まれるもの(イベント)と区別できるよう `走査 \`id\`` と書く。
 */
function scanOrigins(catalog: JobCatalogSpec, id: string): readonly string[] {
  return (emittedBy(catalog).get(id) ?? []).map((scan) => `走査 \`${scan}\``);
}

/** 語彙の表(このアプリが宣言した語のカタログ)。 */
function vocabularySection(catalog: JobCatalogSpec): string {
  const rows = JOB_VOCABULARY_AXES.flatMap((axis) =>
    catalog.vocabulary[axis].map((term) => [
      cell(AXIS_TITLE[axis]),
      cell(`\`${term.id}\``),
      cell(term.label ?? '—'),
      cell(term.inTransaction === true ? 'in_transaction' : '—'),
      cell((term.declares ?? []).map((key) => `\`${key}\``).join(', ') || '—'),
      cell(term.means === undefined ? '—' : `\`${term.means}\``),
    ]),
  );
  return [
    '### 語彙(このカタログが宣言する値域)',
    '',
    markdownTable(['軸', '語', '表示名', '同一トランザクションで実現', '行が必ず持つキー', '失敗の意味(means)'], rows),
  ].join('\n');
}

/** イベントで積まれるジョブの表。 */
function outboxSection(catalog: JobCatalogSpec, events: ReadonlyMap<string, readonly string[]>): string {
  const jobs = catalog.jobs.filter((decl) => decl.source === 'outbox');
  if (jobs.length === 0) return '### イベントで積まれるジョブ(outbox)\n\nまだ宣言がありません。';
  const rows = jobs.map((decl) => [
    cell(`\`${decl.id}\``),
    cell(decl.kind),
    cell(
      [...(events.get(decl.id) ?? []).map((event) => `\`${event}\``), ...scanOrigins(catalog, decl.id)].join(', ') ||
        '—',
    ),
    cell(decl.onFailure),
    cell(decl.summary),
  ]);
  return [
    '### イベントで積まれるジョブ(outbox。effects と双方向に閉じている)',
    '',
    markdownTable(['ジョブ ID', '種別', '積む元(イベント / 走査)', '失敗時', '何をするか'], rows),
  ].join('\n');
}

/** 時刻で起きるジョブの表。 */
function scheduleSection(catalog: JobCatalogSpec): string {
  const jobs = catalog.jobs.filter((decl) => decl.schedule !== undefined);
  if (jobs.length === 0) return '### 時刻で起きるジョブ(schedule)\n\nまだ宣言がありません。';
  const rows = jobs.map((decl) => {
    const schedule = decl.schedule;
    return [
      cell(`\`${decl.id}\``),
      cell(decl.kind),
      cell(schedule?.scheduler === undefined ? '—' : `\`${schedule.scheduler}\``),
      cell(schedule?.cron === undefined ? `—(未登録: ${schedule?.notScheduledReason ?? ''})` : `\`${schedule.cron}\``),
      cell(schedule?.endpoint === undefined ? '—' : `\`${schedule.endpoint}\``),
      cell(schedule?.fires === undefined ? '—' : `\`${schedule.fires}\``),
      cell(schedule?.dueFrom === undefined ? '—' : `\`${schedule.dueFrom}\``),
      cell((schedule?.emits ?? []).map((emitted) => `\`${emitted}\``).join(', ') || '—'),
      cell(decl.onFailure),
      cell(decl.summary),
    ];
  });
  return [
    '### 時刻で起きるジョブ(schedule。Cron の登録と双方向に閉じている)',
    '',
    markdownTable(
      [
        'ジョブ ID',
        '種別',
        '鳴る場所(scheduler)',
        'いつ',
        '叩かれる口',
        '起こすイベント',
        '発火時刻の供給元',
        '積む通知(emits)',
        '失敗時',
        '何をするか',
      ],
      rows,
    ),
  ].join('\n');
}

/** 実装の一覧(時刻で起きるジョブだけが持つ)。 */
function implementationSection(catalog: JobCatalogSpec): string {
  const rows = catalog.jobs
    .filter((decl) => decl.schedule !== undefined)
    .map((decl) => [cell(`\`${decl.id}\``), cell(`\`${decl.schedule?.implementation ?? ''}\``)]);
  if (rows.length === 0) return '';
  return ['### 実装(実在も検査される)', '', markdownTable(['ジョブ ID', 'モジュール'], rows)].join('\n');
}

/** テストケースの表(notification-body と同じ形)。 */
function testCaseSection(catalog: JobCatalogSpec): string {
  const rows = catalog.testCases.map((testCase) => [
    cell(testCase.id),
    cell(testCase.type),
    cell((testCase.covers ?? []).join(', ')),
    cell(testCase.specIds.join(', ')),
    cell(`\`${testCase.implementation.raw}\``),
  ]);
  return ['### テストケース', '', markdownTable(['ID', 'type', 'covers', 'spec_ids', 'implementation'], rows)].join('\n');
}

/**
 * ジョブカタログの本文ブロックを生成するジェネレーター。
 * 出力は jobs.md の `job-body` マーカー 1 か所。
 */
export const jobBodyGenerator: DocGenerator = {
  id: 'job-body',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.jobs?.catalog;
    if (catalog === undefined || catalog === null) return [];
    const events = enqueueingEvents(model);
    return [
      {
        file: jobsFile(ctx.roots),
        marker: 'job-body',
        content: [
          vocabularySection(catalog),
          outboxSection(catalog, events),
          scheduleSection(catalog),
          implementationSection(catalog),
          testCaseSection(catalog),
        ]
          .filter((block) => block !== '')
          .join('\n\n'),
      },
    ];
  },
};
