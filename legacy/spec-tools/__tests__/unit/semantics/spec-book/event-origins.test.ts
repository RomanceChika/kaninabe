/**
 * ハンドブックの「自動で起きるか」の判定(`semantics/spec-book/event-origins.ts`)のテスト。
 *
 * 設計メモ plan-generator.md §4 の反例を全部並べる: system あり・発火元なし / 別の状態機械の同名のイベント /
 * 同じイベントに 2 本 / 実在しない fires / サインインだけが発火元 / 受信 Webhook だけが発火元 / ジョブを 1 本消す・足す /
 * 入力の順を入れ替えても結果が同じ。語は仕様の ID の代わりに仮の名前を使う。
 */

import { describe, expect, it } from 'vitest';
import {
  collectEventOrigins,
  judgeAutonomy,
  type EventOriginsInput,
} from '../../../../lib/semantics/spec-book/event-origins.js';
import { authBranch, authFlow } from '../../../helpers/auth-builder.js';
import { integration } from '../../../helpers/external-builder.js';
import { notScheduledJob, outboxJob, scheduledJob } from '../../../helpers/job-builder.js';
import { aggregate, event, machine, roleSpec, specModel } from '../../../helpers/model-builder.js';

const flow = machine('flow', {
  states: ['open', 'closed', 'done'],
  initial: 'open',
  final: ['done'],
  events: [
    event('close', { from: ['open'], to: 'closed', by: ['system'] }),
    event('finish', { from: ['closed'], to: 'done', by: ['system', 'host'] }),
    event('drop', { from: ['open'], to: 'done', by: ['system'] }),
  ],
});
// 同じ集約の 2 本目の状態機械に、同名のイベント close がある。
const shown = machine('shown', {
  states: ['hidden', 'visible'],
  initial: 'hidden',
  events: [event('close', { from: ['visible'], to: 'hidden', by: ['host'] })],
});
const model = specModel([aggregate('thing', { stateMachines: [flow, shown] })], roleSpec(['system', 'host', 'member']));

const none: EventOriginsInput = { jobs: [], auth: null, integrations: [], unread: [] };

describe('collectEventOrigins', () => {
  it('時刻起点のジョブ・サインインの行・受信 Webhook の 3 種類を発火元に数え、outbox のジョブは数えない', () => {
    const origins = collectEventOrigins(model, {
      jobs: [scheduledJob('close_due', { fires: 'flow.close' }), outboxJob('notify_host')],
      auth: authFlow({ branches: [authBranch('on_sign_in', { runs: ['flow.finish'] })] }),
      integrations: [integration('payment', { direction: 'inbound', emits: 'flow.drop' })],
      unread: [],
    });
    expect(origins.byEvent.get('flow.close')).toEqual([{ kind: 'job', id: 'close_due', scheduled: true }]);
    expect(origins.byEvent.get('flow.finish')).toEqual([{ kind: 'sign_in', id: 'on_sign_in' }]);
    expect(origins.byEvent.get('flow.drop')).toEqual([{ kind: 'inbound', id: 'payment' }]);
    expect(origins.dangling).toEqual([]);
  });

  it('キーは状態機械の名前で引く(別の状態機械の同名のイベントに発火元が漏れない)', () => {
    const origins = collectEventOrigins(model, { ...none, jobs: [scheduledJob('close_due', { fires: 'flow.close' })] });
    expect(origins.byEvent.has('shown.close')).toBe(false);
  });

  it('同じ遷移に 2 本あれば両方を持つ(後勝ちにしない)・並びは種類の順 → ID の昇順', () => {
    const origins = collectEventOrigins(model, {
      jobs: [scheduledJob('z_job', { fires: 'flow.close' }), scheduledJob('a_job', { fires: 'flow.close' })],
      auth: authFlow({ branches: [authBranch('row', { runs: ['flow.close', 'flow.close'] })] }),
      integrations: [],
      unread: [],
    });
    expect(origins.byEvent.get('flow.close')?.map((origin) => `${origin.kind}:${origin.id}`)).toEqual([
      'job:a_job',
      'job:z_job',
      'sign_in:row',
    ]);
  });

  it('Cron に結線していないジョブも発火元に数え、結線していないことを持つ', () => {
    const base = notScheduledJob('later', 'まだ結線しない');
    const unwired = { ...base, schedule: { notScheduledReason: 'まだ結線しない', implementation: 'x.ts', scheduler: 'host' as const, fires: 'flow.close' } };
    expect(collectEventOrigins(model, { ...none, jobs: [unwired] }).byEvent.get('flow.close')).toEqual([
      { kind: 'job', id: 'later', scheduled: false },
    ]);
  });

  it('実在しない遷移を名指した発火元は dangling に分ける', () => {
    const origins = collectEventOrigins(model, { ...none, jobs: [scheduledJob('ghost', { fires: 'flow.vanish' })] });
    expect(origins.byEvent.size).toBe(0);
    expect(origins.dangling).toEqual([{ key: 'flow.vanish', origin: { kind: 'job', id: 'ghost', scheduled: true } }]);
  });

  it('入力の順を入れ替えても結果が同じ', () => {
    const jobs = [
      scheduledJob('b', { fires: 'flow.close' }),
      scheduledJob('a', { fires: 'flow.close' }),
      scheduledJob('c', { fires: 'flow.finish' }),
      scheduledJob('x', { fires: 'nowhere.e' }),
      scheduledJob('w', { fires: 'nowhere.d' }),
    ];
    const forward = collectEventOrigins(model, { ...none, jobs });
    const backward = collectEventOrigins(model, { ...none, jobs: [...jobs].reverse() });
    expect([...backward.byEvent].sort()).toEqual([...forward.byEvent].sort());
    expect(backward.dangling).toEqual(forward.dangling);
  });
});

describe('judgeAutonomy', () => {
  const job = { kind: 'job', id: 'j', scheduled: true } as const;

  it('by に system が無く発火元も無い遷移は manual', () => {
    expect(judgeAutonomy(model, ['host'], [])).toBe('manual');
  });

  it('by に system が無いのに発火元がある遷移は矛盾として名指す', () => {
    expect(judgeAutonomy(model, ['host'], [job])).toBe('origin-without-permission');
  });

  it('system だけが起こせて発火元がある遷移は auto-only・人の役もいれば auto-or-manual', () => {
    expect(judgeAutonomy(model, ['system'], [job])).toBe('auto-only');
    expect(judgeAutonomy(model, ['system', 'host'], [job])).toBe('auto-or-manual');
  });

  it('by に system があっても発火元が無ければ「自動」と言わない(ジョブを 1 本消すと判定が変わる)', () => {
    expect(judgeAutonomy(model, ['system'], [])).toBe('system-unwired');
  });

  it('Cron に結線していないジョブだけでは「自動」と言わない(結線済みの発火元が 1 つでもあれば自動)', () => {
    const unwired = { kind: 'job', id: 'later', scheduled: false } as const;
    expect(judgeAutonomy(model, ['system'], [unwired])).toBe('system-unwired');
    expect(judgeAutonomy(model, ['system'], [unwired, job])).toBe('auto-only');
    expect(judgeAutonomy(model, ['system'], [unwired, { kind: 'sign_in', id: 'row' }])).toBe('auto-only');
    expect(judgeAutonomy(model, ['system', 'host'], [unwired, { kind: 'inbound', id: 'pay' }])).toBe('auto-or-manual');
  });

  it('by に system が無いときの矛盾は、結線していないジョブも含めて見る', () => {
    expect(judgeAutonomy(model, ['host'], [{ kind: 'job', id: 'later', scheduled: false }])).toBe('origin-without-permission');
  });

  it('発火元の宣言を読めなかった種類があれば、発火元が無くても「未結線」と言わず未検査にする', () => {
    expect(judgeAutonomy(model, ['system'], [], ['auth'])).toBe('unverified');
    expect(judgeAutonomy(model, ['system'], [{ kind: 'job', id: 'later', scheduled: false }], ['jobs'])).toBe('unverified');
    expect(judgeAutonomy(model, ['system'], [job], ['auth'])).toBe('auto-only');
    expect(judgeAutonomy(model, ['host'], [], ['auth'])).toBe('manual');
  });

  it('読めなかった種類は集計の結果に重複なく昇順で残る', () => {
    expect(collectEventOrigins(model, { ...none, unread: ['external', 'auth', 'external'] }).unread).toEqual(['auth', 'external']);
  });

  it('system の役を宣言していない製品では、by の綴りが system でも system と見なさない', () => {
    const plain = specModel([aggregate('thing', { stateMachines: [flow] })], roleSpec(['host']));
    expect(judgeAutonomy(plain, ['system'], [job])).toBe('origin-without-permission');
  });
});
