/**
 * ジョブの章の下段(導出): 走査の実装と登録・積む元・テストの表。
 *
 * すべて折りたたむ。件数は表の行の数(構造テストが一致を見る)。通知を送るジョブは公理に数えず(通知の章が同じ事実を
 * 読む)、積む元の表に原文の説明と失敗したときの語つきで畳む。
 */

import type { SpecModel } from '../../../model/types.js';
import type { JobCatalogSpec, JobDecl } from '../../../model/job/types.js';
import { emittedBy } from '../../../job/emits.js';
import { cell } from '../../../gen-kit/state-machine-table.js';
import { enqueueingEvents } from '../job-body.js';
import type { FoldProps } from './face-html.js';

/** 下段の表 1 つ(共有の行。行は `cell` を通した文字列で、識別子はバッククォートで囲む)。 */
export interface JobLowerTable {
  readonly fold: FoldProps;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** 時刻で起きるジョブの実装と登録の表。 */
export function scheduleTable(jobs: readonly JobDecl[], labels: ReadonlyMap<string, string>): JobLowerTable {
  const rows = jobs.map((decl) => {
    const schedule = decl.schedule;
    return [
      cell(`\`${decl.id}\``),
      cell(schedule === undefined ? '—' : `\`${schedule.scheduler}\``),
      cell(schedule?.cron === undefined ? '—(まだ動いていない)' : `\`${schedule.cron}\``),
      cell(schedule === undefined ? '—' : `\`${schedule.implementation}\``),
      cell(schedule?.fires === undefined ? '—' : `\`${schedule.fires}\``),
      cell((schedule?.emits ?? []).map((emitted) => `\`${emitted}\``).join(', ') || '—'),
      cell(labels.get(`kind:${decl.kind}`) ?? decl.kind),
    ];
  });
  return {
    fold: { kind: 'table', title: '走査の実装と登録(時刻で起きるジョブごと)', count: rows.length, hint: 'cron の登録と双方向に閉じている', element: 'job.implementation' },
    headers: ['ジョブ', '鳴る場所', 'cron 式(UTC)', '実装', '起こすイベント', '積む通知', '種別'],
    rows,
  };
}

/** 積む元の表。 */
export function sourceTable(
  model: SpecModel,
  catalog: JobCatalogSpec,
  jobs: readonly JobDecl[],
  labels: ReadonlyMap<string, string>,
  sending: ReadonlySet<string>,
): JobLowerTable {
  const events = enqueueingEvents(model);
  const scans = emittedBy(catalog);
  const rows = jobs.map((decl) => [
    cell(`\`${decl.id}\``),
    cell(sending.has(decl.id) ? decl.summary : '上段の表で読む'),
    cell(
      [
        ...(events.get(decl.id) ?? []).map((event) => `\`${event}\``),
        ...(scans.get(decl.id) ?? []).map((scan) => `走査 \`${scan}\``),
      ].join(', ') || '—(人が押す)',
    ),
    cell(labels.get(`kind:${decl.kind}`) ?? decl.kind),
    cell(`${labels.get(`on_failure:${decl.onFailure}`) ?? decl.onFailure} \`${decl.onFailure}\``),
  ]);
  return {
    fold: { kind: 'table', title: '積む元(イベントなどで積まれるジョブごと)', count: rows.length, hint: 'どの遷移・走査がこのジョブを積むか。通知を送るジョブは、ここに畳む', element: 'job.source' },
    headers: ['ジョブ', '決まること', '積む元(イベント / 走査)', '種別', '失敗したら'],
    rows,
  };
}

/** テストの表。 */
export function jobTestTable(catalog: JobCatalogSpec): JobLowerTable {
  const rows = catalog.testCases.map((testCase) => [cell(testCase.id), cell(testCase.type), cell(`\`${testCase.implementation.raw}\``)]);
  return {
    fold: { kind: 'table', title: 'テスト(宣言と実装の突合)', count: rows.length, hint: '仕様の test_cases の行数', element: 'job.tests' },
    headers: ['ID', 'type', '実装'],
    rows,
  };
}
