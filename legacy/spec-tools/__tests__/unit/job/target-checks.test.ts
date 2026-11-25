import { describe, expect, it } from 'vitest';
import { JOB_CHECK_SLOTS, NO_JOB_TARGETS, resolveJobChecks, SCHEDULER_OWNER } from '../../../lib/job/target-checks.js';
import type { JobTargetRegistry, JobTargetVerifier, RegisteredJobCheck, SelectedTarget } from '../../../lib/job/target-checks.js';
import { JOB_SCHEDULERS } from '../../../lib/model/job/types.js';
import { TARGET_ROLES, TARGET_ROLE_WORDS } from '../../../lib/kernel/target-role.js';

/**
 * ジョブ仕様の検査(J 群)のうち**後段が受け持つもの**の口の表と、登録された検査を口に当てる関数。
 * コアは後段の名前を知らず、ルール ID と**役割**だけで口を決める。当たらない口は「埋まっていない口」として返り、実行ログが未実施と名指す。
 */

/** 何もしない検査(ID だけ指定)。 */
function check(id: string): JobTargetVerifier {
  return { group: 'job', id, verify: () => [] };
}

/** 後段の登録(役割 + 検査)。 */
function registered(role: RegisteredJobCheck['role'], id: string): RegisteredJobCheck {
  return { role, check: check(id) };
}

/** 検査の登録だけを持つ登録(後段の選択は役割ごとの名前 `<role>-target` で 1 つずつ、登録した役割の分だけ選んだことにする)。 */
function registry(checks: readonly RegisteredJobCheck[]): JobTargetRegistry {
  const roles = [...new Set(checks.map((entry) => entry.role))];
  return { checks, targets: roles.map((role) => ({ id: `${role}-target`, role, notApplicable: {} })) };
}

/** 選んだ後段 1 つ。 */
function selected(id: string, role: SelectedTarget['role'], notApplicable: SelectedTarget['notApplicable'] = {}): SelectedTarget {
  return { id, role, notApplicable };
}

describe('JOB_CHECK_SLOTS: 口の表', () => {
  it('J2 / J3 / J4 の 3 つ。J2 と J4 はホスト・J3 はプラットフォームが受け持つ(後段の名前は書かない)', () => {
    expect(JOB_CHECK_SLOTS.map((slot) => [slot.id, slot.role])).toEqual([
      ['J2', 'host'],
      ['J3', 'platform'],
      ['J4', 'host'],
    ]);
  });

  it('口の役割は閉じた一覧の中にあり、ID は重ならず、見ていないことの文がある。役割の言い方は役割ごとにある', () => {
    for (const slot of JOB_CHECK_SLOTS) {
      expect(TARGET_ROLES, slot.id).toContain(slot.role);
      expect(slot.unseen.length, slot.id).toBeGreaterThan(0);
    }
    expect(new Set(JOB_CHECK_SLOTS.map((slot) => slot.id)).size).toBe(JOB_CHECK_SLOTS.length);
    expect(Object.keys(TARGET_ROLE_WORDS).sort()).toEqual([...TARGET_ROLES].sort());
  });

  it('後段の名前(具体のスタックの名前)を持たない', () => {
    const text = JSON.stringify([JOB_CHECK_SLOTS, TARGET_ROLE_WORDS]);
    expect(text).not.toMatch(/vercel|supabase/i);
  });
});

describe('resolveJobChecks: 登録された検査を口に当てる', () => {
  it('ID と役割がそろえば当たる。口の表の並びで返る', () => {
    const resolved = resolveJobChecks(registry([registered('host', 'J4'), registered('platform', 'J3'), registered('host', 'J2')]));
    expect([...resolved.byId.keys()]).toEqual(['J2', 'J3', 'J4']);
    expect(resolved.missing).toEqual([]);
    expect(resolved.notApplicable).toEqual([]);
  });

  it('後段を 1 つも選んでいなければ、全部の口が埋まっていない(口の表の並び)。理由は「後段が無い」(選ばれている後段の名前が無い)', () => {
    const resolved = resolveJobChecks(NO_JOB_TARGETS);
    expect(resolved.byId.size).toBe(0);
    expect(resolved.missing).toEqual(JOB_CHECK_SLOTS);
    expect(resolved.missing.every((slot) => slot.selectedTarget === undefined)).toBe(true);
  });

  it('一部だけ登録すれば、残りの口が埋まっていない', () => {
    expect(resolveJobChecks(registry([registered('host', 'J2'), registered('host', 'J4')])).missing.map((slot) => slot.id)).toEqual(['J3']);
    expect(resolveJobChecks(registry([registered('platform', 'J3')])).missing.map((slot) => slot.id)).toEqual(['J2', 'J4']);
  });

  it('ID が同じでも役割が違う後段の登録は当てない', () => {
    const resolved = resolveJobChecks(registry([registered('platform', 'J2'), registered('host', 'J3')]));
    expect(resolved.byId.size).toBe(0);
    expect(resolved.missing.map((slot) => slot.id)).toEqual(['J2', 'J3', 'J4']);
  });

  it('口の表に無い ID の登録は無視する(契約の検査 selectTargetSet が理由つきで止める側)', () => {
    expect(resolveJobChecks(registry([registered('host', 'J99')])).byId.size).toBe(0);
  });
});

describe('resolveJobChecks: 埋まらない理由(後段が選ばれていない / 選ばれているが登録していない)', () => {
  it('同じ役割の後段が選ばれているのに口を登録していなければ、その後段の名前が付く。選ばれていない役割の口には付かない', () => {
    const resolved = resolveJobChecks({ checks: [], targets: [selected('plat', 'platform')] });
    expect(resolved.missing.map((slot) => [slot.id, slot.selectedTarget])).toEqual([
      ['J2', undefined],
      ['J3', 'plat'],
      ['J4', undefined],
    ]);
  });

  it('ホストの後段が選ばれていて J2 だけ登録していれば、J4 は「ホストの後段 <名前> が登録していない」側になる', () => {
    const resolved = resolveJobChecks({ checks: [registered('host', 'J2')], targets: [selected('plat', 'platform'), selected('h', 'host')] });
    expect(resolved.missing.map((slot) => [slot.id, slot.selectedTarget])).toEqual([
      ['J3', 'plat'],
      ['J4', 'h'],
    ]);
  });
});

describe('resolveJobChecks: 対象外の宣言', () => {
  it('同じ役割の後段が口を理由つきで対象外と宣言していれば、未実施ではなく対象外に分ける(口の表の並び)', () => {
    const resolved = resolveJobChecks({
      checks: [registered('host', 'J2')],
      targets: [selected('plat', 'platform', { J3: '拡張を使わない' }), selected('h', 'host', { J4: '頻度の制約が無い' })],
    });
    expect(resolved.missing).toEqual([]);
    expect(resolved.notApplicable.map((slot) => [slot.id, slot.target, slot.reason])).toEqual([
      ['J3', 'plat', '拡張を使わない'],
      ['J4', 'h', '頻度の制約が無い'],
    ]);
  });

  it('別の役割の後段の宣言は、その口には効かない(host の J3 の宣言は platform の口を対象外にしない)', () => {
    const resolved = resolveJobChecks({ checks: [], targets: [selected('plat', 'platform'), selected('h', 'host', { J3: '関係が無い' })] });
    expect(resolved.notApplicable).toEqual([]);
    expect(resolved.missing.map((slot) => slot.id)).toEqual(['J2', 'J3', 'J4']);
  });

  it('宣言と検査の両方がある口は検査が当たる(両方の登録は契約が止める。ここでは実行を優先する)', () => {
    const resolved = resolveJobChecks({ checks: [registered('host', 'J4')], targets: [selected('h', 'host', { J4: '理由' })] });
    expect([...resolved.byId.keys()]).toEqual(['J4']);
    expect(resolved.notApplicable).toEqual([]);
  });
});

describe('SCHEDULER_OWNER: 鳴る場所 → 検査の持ち主の役割', () => {
  it('鳴る場所の全値に持ち主がある(全域)。host はホスト・database はプラットフォーム(別の軸の対応を表で宣言する)', () => {
    expect(Object.keys(SCHEDULER_OWNER).sort()).toEqual([...JOB_SCHEDULERS].sort());
    expect(SCHEDULER_OWNER).toEqual({ host: 'host', database: 'platform' });
  });

  it('口の表と整合する: J2 / J4 の口は host の持ち主・J3 の口は database の持ち主', () => {
    const roleOf = (id: string) => JOB_CHECK_SLOTS.find((slot) => slot.id === id)?.role;
    expect(roleOf('J2')).toBe(SCHEDULER_OWNER.host);
    expect(roleOf('J4')).toBe(SCHEDULER_OWNER.host);
    expect(roleOf('J3')).toBe(SCHEDULER_OWNER.database);
  });
});
