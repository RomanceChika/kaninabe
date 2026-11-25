/**
 * 別の集約の列との等式を見る制約トリガの本文(`ddl-cross-check-body.ts` / `ddl-check-triggers.ts`)の字面のテスト。
 *
 * 固定するのは 5 つである:
 *   - 行の側は**相手の行を `for share` で押さえてから**結合して読み直す(同時実行の約束。外すと書き込みの歪みが通る)
 *   - 相手の側は、その行を指す行を結合して読み直す(ロックは取らない)
 *   - 式は `COALESCE(…, false)` で閉じ、結合の別名 `t`(行)/ `r`(相手)が欄ごとに付く(NULL は拒否として扱われる)
 *   - 拒否の文面は `using message` で渡し、トリガ名 + 不変条件 ID + statement が載る(`%` が入っても書式として解釈されない)
 *   - 制約トリガ(`after`・遅延)・定義者の権限・`fires` の列の名指しが残る。生成できなければ理由を返す
 */

import { describe, expect, it } from 'vitest';
import { CROSS_CHECK_WORDS } from '../../../lib/messages/messages-ddl.js';
import { checkTriggerOf, checkTriggersIn } from '../../../lib/sql/ddl-check-triggers.js';
import {
  CROSS_INVARIANT,
  agentTable,
  crossDomain,
  hostTrigger,
  referencedTrigger,
  ticketTable,
} from '../../helpers/cross-equality-fixture.js';

const TABLES = [ticketTable(), agentTable()];

/** 隔離の水準の拒否の文面(そのまま。トリガ名も不変条件 ID も載せない)。 */
const ISOLATION_TEXT = CROSS_CHECK_WORDS.isolationRefusal;

describe('別の集約の列との等式の本文', () => {
  it('行の側: 相手の行を for share で押さえてから、結合して条件を破る行を探す', () => {
    const built = checkTriggerOf(hostTrigger(), ticketTable(), crossDomain(), TABLES);

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.trigger.function.body).toEqual([
      "if current_setting('transaction_isolation') <> 'read committed' then",
      '    raise exception using',
      `        message = '${ISOLATION_TEXT}',`,
      "        errcode = 'invalid_transaction_state';",
      'end if;',
      'perform 1',
      '    from public.tickets t',
      '    join public.agents r on r.id = t.agent_id',
      '    where t.id = new.id',
      '    for share of r;',
      'if exists (',
      '    select 1',
      '    from public.tickets t',
      '    join public.agents r on r.id = t.agent_id',
      '    where t.id = new.id and not (COALESCE((t.org_id = r.org_id), false))',
      ') then',
      '    raise exception using',
      "        message = 'check_ticket_agent_org: INV-TICKET-001: 担当者はチケットと同じ組織の人でなければならない(100% 他組織を担当させない)',",
      "        errcode = 'check_violation',",
      "        constraint = 'check_ticket_agent_org';",
      'end if;',
      'return null;',
    ]);
    expect(built.trigger.deferred).toBe(true);
    expect(built.trigger.function.securityDefiner).toBe(true);
    expect(built.trigger.fires).toBe('after insert or update of org_id, agent_id');
  });

  it('相手の側: その行を指す行を結合して探す(ロックは取らない)', () => {
    const built = checkTriggerOf(referencedTrigger(), agentTable(), crossDomain(), TABLES);

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.trigger.function.body.slice(0, 10)).toEqual([
      "if current_setting('transaction_isolation') <> 'read committed' then",
      '    raise exception using',
      `        message = '${ISOLATION_TEXT}',`,
      "        errcode = 'invalid_transaction_state';",
      'end if;',
      'if exists (',
      '    select 1',
      '    from public.tickets t',
      '    join public.agents r on r.id = t.agent_id',
      '    where r.id = new.id and not (COALESCE((t.org_id = r.org_id), false))',
    ]);
    expect(built.trigger.function.body.join('\n')).not.toContain('for share');
    expect(built.trigger.fires).toBe('after update of org_id');
    expect(built.trigger.function.securityDefiner).toBe(true);
  });

  it('両端の本文は同じ拒否の文面(トリガ名だけが違う)で、制約名が不変条件に写る', () => {
    const host = checkTriggerOf(hostTrigger(), ticketTable(), crossDomain(), TABLES);
    const referenced = checkTriggerOf(referencedTrigger(), agentTable(), crossDomain(), TABLES);

    expect(host.ok && referenced.ok).toBe(true);
    if (!host.ok || !referenced.ok) return;
    for (const [built, name] of [
      [host, 'check_ticket_agent_org'],
      [referenced, 'check_ticket_agent_org_on_agent'],
    ] as const) {
      const text = built.trigger.function.body.join('\n');
      expect(text).toContain(`message = '${name}: ${CROSS_INVARIANT}: `);
      expect(text).toContain(`constraint = '${name}'`);
    }
  });

  it('両端とも repeatable read は検査(for share・結合)の前に拒否し、名前も不変条件 ID も載せない(25000)', () => {
    for (const [trigger, table, name] of [
      [hostTrigger(), ticketTable(), 'check_ticket_agent_org'],
      [referencedTrigger(), agentTable(), 'check_ticket_agent_org_on_agent'],
    ] as const) {
      const built = checkTriggerOf(trigger, table, crossDomain(), TABLES);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const text = built.trigger.function.body.join('\n');
      const guard = text.slice(0, text.indexOf('end if;'));
      expect(guard).toContain("current_setting('transaction_isolation') <> 'read committed'");
      expect(guard).toContain("errcode = 'invalid_transaction_state'");
      expect(guard).not.toContain(name);
      expect(guard).not.toContain(CROSS_INVARIANT);
      expect(guard).not.toContain('constraint =');
      // 検査より前(外すと、古い snapshot の検査が先に走る)。
      expect(text.indexOf('transaction_isolation')).toBeLessThan(text.indexOf('if exists ('));
      expect(text.indexOf('transaction_isolation')).toBeLessThan(text.indexOf('join public.'));
      // 隔離の拒否のほかに「不変条件の拒否」が 1 本だけ残る(制約名を載せるのはそちらだけ)。
      expect(text.match(/constraint = /g)).toHaveLength(1);
    }
  });

  it('statement に % が入っても using message で渡す(書式文字列にならない)', () => {
    const built = checkTriggerOf(hostTrigger(), ticketTable(), crossDomain(), TABLES);
    expect(built.ok && built.trigger.function.body.join('\n')).toContain('100% 他組織を');
    expect(built.ok && built.trigger.function.body.join('\n')).not.toMatch(/raise exception '/);
  });

  it('式が複数の節でも欄ごとに別名が付く(行の側 t・相手の側 r)', () => {
    const domain = crossDomain({ expr: 'ticket.org_id == agent.org_id and agent.org_id != ticket.queue_id' });
    const trigger = hostTrigger({ fires: 'after insert or update of org_id, agent_id, queue_id' });
    const built = checkTriggerOf(trigger, ticketTable([trigger]), domain, TABLES);

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.trigger.function.body.join('\n')).toContain(
      'COALESCE(((t.org_id = r.org_id) AND (r.org_id <> t.queue_id)), false)',
    );
  });

  it('生成できない宣言は理由を返す(片側の発火が漏れる・相手の表が無い)', () => {
    const lacking = hostTrigger({ fires: 'after insert or update of org_id' });
    const built = checkTriggerOf(lacking, ticketTable([lacking]), crossDomain(), TABLES);
    expect(built.ok).toBe(false);
    expect(!built.ok && built.reason).toContain('agent_id');
    const alone = checkTriggerOf(hostTrigger(), ticketTable(), crossDomain(), [ticketTable()]);
    expect(!alone.ok && alone.reason).toContain('data_table が無い');
  });

  it('表の計画(checkTriggersIn)に載るのは、相手の表を渡したときだけ', () => {
    expect(checkTriggersIn(ticketTable(), crossDomain(), TABLES).map((trigger) => trigger.name)).toEqual([
      'check_ticket_agent_org',
    ]);
    expect(checkTriggersIn(ticketTable(), crossDomain())).toEqual([]);
    expect(checkTriggersIn(agentTable(), crossDomain(), TABLES).map((trigger) => trigger.name)).toEqual([
      'check_ticket_agent_org_on_agent',
    ]);
  });
});
