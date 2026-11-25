/**
 * 別の集約の列との等式の制約トリガ(`cross-check-plan.ts`)の判定の網羅テスト。
 *
 * 固定するのは 4 つである:
 *   - 両端(行を持つ側 `host` / 参照される側 `referenced`)の宣言が計画になる(結合する表・参照の欄・見る列)
 *   - 生成しない形は**理由つき**で断る(3 つ以上の集約・context に無い・空にできる参照の欄・両端のどちらでもない表・
 *     遅延でない・`fires` が見るべき更新を漏らす)—— 断り方が緩むと片側が素通りする
 *   - 別のトリガが列を書き換える場合(`supplies`)は、そのトリガの発火列も見る列に入る(`update of` は
 *     SET の列でしか発火せず BEFORE トリガの書き換えを数えない)
 *   - 別の集約の等式でない不変条件は `none`(従来の経路に任せる)
 */

import { describe, expect, it } from 'vitest';
import { crossCheckOf } from '../../../lib/sql/cross-check-plan.js';
import { watchedColumnsOf } from '../../../lib/model/data/cross-check-shape.js';
import type { CrossJudgement } from '../../../lib/sql/cross-check-plan.js';
import type { DataTriggerDecl } from '../../../lib/model/data/types.js';
import { dataTable } from '../../helpers/data-builder.js';
import {
  agentTable,
  crossDomain,
  hostTrigger,
  referencedTrigger,
  ticketTable,
} from '../../helpers/cross-equality-fixture.js';

/** 両端の表。 */
const TABLES = [ticketTable(), agentTable()];

/** 判定の理由(refused 以外なら空)。 */
function reasonOf(judged: CrossJudgement): string {
  return judged.kind === 'refused' ? judged.reason : '';
}

describe('別の集約の列との等式の計画', () => {
  it('行を持つ側の宣言は、参照の欄と式の列を見る計画になる', () => {
    const judged = crossCheckOf(hostTrigger(), ticketTable(), crossDomain(), TABLES);

    expect(judged.kind).toBe('ok');
    if (judged.kind !== 'ok') return;
    expect(judged.plan.side).toBe('host');
    expect(judged.plan.host.table).toBe('tickets');
    expect(judged.plan.other.table).toBe('agents');
    expect(judged.plan.refColumn).toBe('agent_id');
    expect(judged.plan.hostColumns).toEqual(['org_id']);
    expect(judged.plan.otherColumns).toEqual(['org_id']);
    expect([...judged.plan.watched].sort()).toEqual(['agent_id', 'org_id']);
  });

  it('参照される側の宣言は、相手の列の更新だけを見る計画になる', () => {
    const judged = crossCheckOf(referencedTrigger(), agentTable(), crossDomain(), TABLES);

    expect(judged.kind).toBe('ok');
    if (judged.kind !== 'ok') return;
    expect(judged.plan.side).toBe('referenced');
    expect(judged.plan.watched).toEqual(['org_id']);
  });

  it('不変条件を宣言しないトリガ・自集約の欄だけの式は none(従来の経路)', () => {
    const { invariant: _omitted, ...undeclared } = hostTrigger();
    expect(crossCheckOf(undeclared, ticketTable(), crossDomain(), TABLES).kind).toBe('none');
    const own = crossDomain({ expr: 'ticket.org_id == ticket.org_id' });
    expect(crossCheckOf(hostTrigger(), ticketTable(), own, TABLES).kind).toBe('none');
    expect(crossCheckOf(hostTrigger({ invariant: 'INV-NOPE' }), ticketTable(), crossDomain(), TABLES).kind).toBe('none');
  });

  it.each([
    [
      '3 つ以上の集約を読む式',
      { expr: 'ticket.org_id == agent.org_id and ticket.org_id == team.org_id', withTeam: true },
      '3 つ以上の集約',
    ],
    ['context に相手が無い', { withContext: false }, '1 段の参照の欄で届かない'],
    ['参照の欄が空にできる', { required: false }, '空にできる参照の欄'],
  ])('生成しない: %s', (_label, opts, fragment) => {
    const judged = crossCheckOf(hostTrigger(), ticketTable(), crossDomain(opts), TABLES);
    expect(judged.kind).toBe('refused');
    expect(reasonOf(judged)).toContain(fragment);
  });

  it('空にできる参照の欄でも、式が最上段の or で「参照の欄 is null」を言い切れば形になる(空なら条件を課さない = 本文の内部結合の読み方。fix25s)', () => {
    const guarded = crossDomain({ required: false, expr: 'ticket.agent_id is null or ticket.org_id == agent.org_id' });
    const judged = crossCheckOf(hostTrigger(), ticketTable(), guarded, TABLES);
    expect(judged.kind).toBe('ok');
    // 別の欄の is null・and の中の is null は言い切りではない(空の参照の欄のときの扱いが読めない)。
    for (const expr of ['ticket.org_id is null or ticket.org_id == agent.org_id', 'ticket.agent_id is null and ticket.org_id == agent.org_id']) {
      expect(reasonOf(crossCheckOf(hostTrigger(), ticketTable(), crossDomain({ required: false, expr }), TABLES))).toContain('空にできる参照の欄');
    }
  });

  it('両端のどちらの表でもない表の宣言は断る', () => {
    const other = dataTable('teams', { entity: 'team' });
    const judged = crossCheckOf(hostTrigger(), other, crossDomain(), [...TABLES, other]);
    expect(reasonOf(judged)).toContain('両端');
  });

  it('相手の data_table が無ければ断る(結合する表の名前を引けない)', () => {
    const judged = crossCheckOf(hostTrigger(), ticketTable(), crossDomain(), [ticketTable()]);
    expect(reasonOf(judged)).toContain('data_table が無い');
  });

  it('遅延でない宣言は断る(途中状態を通る操作を弾く)', () => {
    const judged = crossCheckOf(hostTrigger({ deferred: false }), ticketTable(), crossDomain(), TABLES);
    expect(reasonOf(judged)).toContain('deferred: true');
  });

  it.each([
    ['行の側が挿入で発火しない', hostTrigger({ fires: 'after update of org_id, agent_id' }), 'insert'],
    ['行の側が参照の欄の更新を見ない', hostTrigger({ fires: 'after insert or update of org_id' }), 'agent_id'],
    ['行の側が式の列の更新を見ない', hostTrigger({ fires: 'after insert or update of agent_id' }), 'org_id'],
    ['発火の宣言が読めない', hostTrigger({ fires: 'sometimes' }), '読めない'],
  ])('fires が漏らす更新は断る: %s', (_label, trigger, fragment) => {
    const judged = crossCheckOf(trigger, ticketTable([trigger]), crossDomain(), TABLES);
    expect(judged.kind).toBe('refused');
    expect(reasonOf(judged)).toContain(fragment);
  });

  it('参照される側が式の列の更新を見ていなければ断る', () => {
    const trigger = referencedTrigger({ fires: 'after update of id' });
    const judged = crossCheckOf(trigger, agentTable([trigger]), crossDomain(), TABLES);
    expect(reasonOf(judged)).toContain('org_id');
  });

  it('列を絞らない update は全部の更新を見るので通る', () => {
    const trigger = hostTrigger({ fires: 'after insert or update' });
    expect(crossCheckOf(trigger, ticketTable([trigger]), crossDomain(), TABLES).kind).toBe('ok');
  });
});

describe('更新で見るべき列(別のトリガが列を書き換える場合)', () => {
  /** org_id を queue_id の更新で写すトリガを持つ表。 */
  function withCopy(fires: string) {
    const copy: DataTriggerDecl = {
      name: 'sync_ticket_org',
      functionName: 'sync_ticket_org',
      fires,
      deferred: false,
      supplies: ['org_id'],
      params: {},
    };
    return dataTable('tickets', { entity: 'ticket', triggers: [copy] });
  }

  it('列を供給するトリガの発火列が、見る列に加わる', () => {
    const table = withCopy('before insert or update of queue_id');
    expect([...watchedColumnsOf(table, ['org_id'])].sort()).toEqual(['org_id', 'queue_id']);
  });

  it('供給するトリガが全部の更新で発火するなら、列を絞れない', () => {
    expect(watchedColumnsOf(withCopy('before insert or update'), ['org_id'])).toBe('all');
  });

  it('挿入だけで発火する供給は更新に影響しない', () => {
    expect(watchedColumnsOf(withCopy('before insert'), ['org_id'])).toEqual(['org_id']);
  });

  it('供給のトリガ経由の書き換えを見ない fires は断る(写しの列の変更が素通りしない)', () => {
    const copy: DataTriggerDecl = {
      name: 'sync_ticket_org',
      functionName: 'sync_ticket_org',
      fires: 'before insert or update of queue_id',
      deferred: false,
      supplies: ['org_id'],
      params: {},
    };
    const table = dataTable('tickets', { entity: 'ticket', triggers: [copy, hostTrigger()] });
    const judged = crossCheckOf(hostTrigger(), table, crossDomain(), [table, agentTable()]);
    expect(reasonOf(judged)).toContain('queue_id');
    const covering = hostTrigger({ fires: 'after insert or update of org_id, agent_id, queue_id' });
    const ok = dataTable('tickets', { entity: 'ticket', triggers: [copy, covering] });
    expect(crossCheckOf(covering, ok, crossDomain(), [ok, agentTable()]).kind).toBe('ok');
  });
});
