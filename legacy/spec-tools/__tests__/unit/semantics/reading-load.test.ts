/**
 * 受け入れの導出(`semantics/reading-load.ts`)のテスト。
 *
 * 5 種(手書き・定型外・確認の上書きとリント・タスクの受け入れと画面の UX 原則の受け入れ)を、宣言から種類ごとに拾い、
 * 宣言のある仕様ファイルを持たせる(手引きがブロックごとに配るため)。
 */

import { describe, expect, it } from 'vitest';
import { acceptCounts, acceptItems, acceptTotal, fileLoad } from '../../../lib/semantics/reading-load.js';
import { configVariable } from '../../helpers/config-builder.js';
import { dataTable } from '../../helpers/data-builder.js';
import { notScheduledJob, outboxJob, scheduledJob } from '../../helpers/job-builder.js';
import { screenSpec } from '../../helpers/screen-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { usecaseAccept, usecaseAcceptInvariant, usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';

describe('acceptCounts', () => {
  const table = dataTable('workshops', {
    entity: 'workshop',
    checks: [{ name: 'c1', handwritten: '適用済みの migration が作った' }, { name: 'c2' }],
    functions: [],
  });
  const manual = actionSpec({ handles: 'workshop.cancel', runner: { reason: '定型に乗らない' } });
  const overridden = actionSpec({ handles: 'workshop.publish', ux: { confirm: 'required', reason: '取り消せない' } });
  const noReason = actionSpec({ handles: 'workshop.close', ux: { confirm: 'none' } });
  const usecase = usecaseSpec({
    name: 'u',
    saves: [usecaseSave('s', [usecaseStep('workshop.publish')])],
    accept: [usecaseAccept('inputs', '予算を超える理由'), usecaseAcceptInvariant('INV-1', '壊れない理由')],
  });

  it('5 種を、宣言のある仕様ファイルつきで拾う', () => {
    const counts = acceptCounts([manual, overridden, noReason], [table], [usecase], []);

    expect(counts.handwritten.map((item) => item.what)).toEqual(['workshops の CHECK c1']);
    expect(counts.handwritten[0]?.file).toBe('docs/specs/backend/data/tables/workshops.md');
    expect(counts.manual).toEqual([
      expect.objectContaining({ what: 'workshop.cancel', reason: '定型に乗らない', element: 'runner.reason' }),
    ]);
    expect(counts.overrides.map((item) => item.element)).toEqual(['ux.override.reason']);
    expect(counts.accepted.map((item) => item.what)).toEqual(['u の予算 inputs', 'u の INV-1']);
    expect(counts.accepted.every((item) => item.element === 'accept.reason')).toBe(true);
  });

  it('画面の ux: の受け入れは、タスクの受け入れと同じ「受け入れ」の分類(宣言のある画面の仕様ファイルつき)', () => {
    const screens = [
      screenSpec({ name: 'a_screen', ux: [{ principle: 'U4', subject: 'thing.open', reason: '別々のカードに並ぶ' }, { principle: 'U3', reason: '完了画面だから' }] }),
      screenSpec({ name: 'b_screen' }),
    ];
    const counts = acceptCounts([], [], [], screens);

    expect(counts.accepted.map((item) => item.what)).toEqual(['a_screen の U4 thing.open', 'a_screen の U3']);
    expect(counts.accepted).toEqual([
      expect.objectContaining({ reason: '別々のカードに並ぶ', element: 'accept.reason', file: screens[0]?.location.file }),
      expect.objectContaining({ reason: '完了画面だから', element: 'accept.reason' }),
    ]);
    expect(acceptTotal(counts)).toBe(2);
  });

  it('時刻の登録をまだしていないジョブの理由は、同じ「受け入れ」の分類(カタログの仕様ファイルつき)。登録済みのジョブは数えない', () => {
    const jobs = [scheduledJob('wired'), notScheduledJob('not_wired', '鍵が入るまで動かさない'), outboxJob('queued')];
    const counts = acceptCounts([], [], [], [], jobs);

    // 読み手は開発者(cron を結線する運用の判断)なので、業務の `accept.reason` ではなく専用の種類に載る。
    expect(counts.accepted).toEqual([
      expect.objectContaining({ what: 'not_wired の時刻の登録', reason: '鍵が入るまで動かさない', element: 'job.not_scheduled_reason', file: 'docs/specs/backend/jobs.md' }),
    ]);
    // 引数を渡さなければ数えない(集約の章・タスクの章は、ジョブを範囲に持たない)。
    expect(acceptCounts([], [], [], []).accepted).toEqual([]);
  });

  it('雛形に載せない設定の理由は、同じ「受け入れ」の分類(カタログの仕様ファイルつき)。読み手は開発者。載る設定は数えない', () => {
    const variables = [configVariable('IN_TEMPLATE'), configVariable('NOT_IN_TEMPLATE', { notInTemplateReason: 'コマンドラインで渡すつまみ' })];
    const counts = acceptCounts([], [], [], [], [], variables);

    expect(counts.accepted).toEqual([
      expect.objectContaining({ what: 'NOT_IN_TEMPLATE の雛形', reason: 'コマンドラインで渡すつまみ', element: 'config.not_in_template_reason', file: 'docs/specs/backend/config.md' }),
    ]);
    expect(acceptCounts([], [], [], []).accepted).toEqual([]);
  });

  it('理由の無い確認の上書きは、理由つきの受け入れに数えない(V14 がエラーにする側)', () => {
    expect(acceptCounts([noReason], [], [], []).overrides).toEqual([]);
  });

  it('合計と平らな一覧は、種類の並び(手書き → 定型外 → 受け入れ → 上書き)で一致する', () => {
    const counts = acceptCounts([manual, overridden], [table], [usecase], []);

    expect(acceptTotal(counts)).toBe(5);
    expect(acceptItems(counts)).toHaveLength(5);
    expect(acceptItems(counts).map((item) => item.element)).toEqual([
      'handwritten.reason',
      'runner.reason',
      'accept.reason',
      'accept.reason',
      'ux.override.reason',
    ]);
  });

  it('宣言が無ければ 0 件(黙って落とさず、空の一覧)', () => {
    const counts = acceptCounts([], [], [], []);

    expect(acceptTotal(counts)).toBe(0);
    expect(acceptItems(counts)).toEqual([]);
  });
});

describe('fileLoad', () => {
  it('仕様ファイル 1 枚の公理の本数と、理由つきの受け入れの件数', () => {
    const items = acceptItems(acceptCounts([actionSpec({ handles: 'workshop.cancel', runner: { reason: 'r' } })], [], [], []));

    expect(fileLoad('docs/specs/backend/actions/workshop/cancel.md', new Map(), items)).toEqual({ axioms: 0, reasoned: 1 });
    expect(fileLoad('docs/specs/domain/workshop/invariants.md', new Map([['docs/specs/domain/workshop/invariants.md', 3]]), items)).toEqual({ axioms: 3, reasoned: 0 });
  });
});
