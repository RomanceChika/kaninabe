/**
 * 仕組みの表の追記専用トリガの宣言(`lib/world/framework-triggers.ts`)と、その本体をつなぐ SQL の側
 * (`lib/sql/framework-guards.ts`)のユニットテスト。
 *
 * 見るのは 3 つ —— (1) 宣言は仕組みの表(`domain_events`)にだけ出る (2) 宣言の写し(トリガ・関数)は
 * 名前・関数名・発火が同じ 1 本から出る (3) SQL の側の計画は宣言と同じ名前・関数名・発火を持ち、本体だけを足す。
 */

import { describe, expect, it } from 'vitest';
import { frameworkFunctionDecls, frameworkTriggerDecls, frameworkTriggerSpecsOf } from '../../../lib/world/framework-triggers.js';
import { frameworkGuardWords, frameworkTriggersOf } from '../../../lib/sql/framework-guards.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 監査ログの表(追記専用の執行点を持つ)。 */
const events = dataTable('domain_events', { internal: true, framework: 'domain_events' });

/** outbox の表(執行点を持たない仕組みの表)。 */
const jobs = dataTable('jobs', { internal: true, framework: 'jobs' });

/** アプリの表(仕組みの表ではない)。 */
const plain = dataTable('rows');

describe('仕組みの表の追記専用トリガの宣言', () => {
  it('宣言があるのは監査ログの表だけで、outbox とアプリの表には出ない', () => {
    expect(frameworkTriggerSpecsOf(events)).toEqual([
      { name: 'domain_events_append_only', functionName: 'reject_domain_events_mutation', fires: 'before update or delete' },
    ]);
    expect(frameworkTriggerSpecsOf(jobs)).toEqual([]);
    expect(frameworkTriggerSpecsOf(plain)).toEqual([]);
  });

  it('data_table の宣言の形への写しは、名前・関数名・発火を同じ宣言から出す(コミット時評価ではない)', () => {
    expect(frameworkTriggerDecls(events)).toEqual([
      {
        name: 'domain_events_append_only',
        functionName: 'reject_domain_events_mutation',
        fires: 'before update or delete',
        deferred: false,
        supplies: [],
        params: {},
      },
    ]);
    expect(frameworkFunctionDecls(events)).toEqual([
      { name: 'reject_domain_events_mutation', args: [], params: [], kind: 'trigger', alsoWrites: [] },
    ]);
    expect(frameworkTriggerDecls(jobs)).toEqual([]);
    expect(frameworkFunctionDecls(plain)).toEqual([]);
  });
});

describe('SQL の側の計画(宣言に本体をつなぐ)', () => {
  it('宣言と同じ名前・関数名・発火を持ち、本体と説明を足す', () => {
    const [declared] = frameworkTriggerSpecsOf(events);
    const [planned] = frameworkTriggersOf(events);
    expect(planned?.name).toBe(declared?.name);
    expect(planned?.fires).toBe(declared?.fires);
    expect(planned?.function.name).toBe(declared?.functionName);
    expect(planned?.function.body.join('\n')).toContain('raise exception');
    expect(planned?.function.comment.length).toBeGreaterThan(0);
  });

  it('執行点を持たない表には計画も出ない', () => {
    expect(frameworkTriggersOf(jobs)).toEqual([]);
    expect(frameworkTriggersOf(plain)).toEqual([]);
  });

  it('出力側の目に見える文言は、関数の説明と拒否の文面の 2 つである', () => {
    expect(frameworkGuardWords()).toHaveLength(2);
  });
});
