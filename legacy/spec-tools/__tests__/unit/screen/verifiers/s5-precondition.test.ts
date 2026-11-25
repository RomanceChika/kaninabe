/**
 * S5(入場条件)のテスト。
 *
 * screen-spec-writing.md の S5 が要求する 4 つ(subject の実在・ガード式として妥当・
 * **パスが subject に接地する**・on_fail の行き先が実在し閉路を作らない)にケースを置く。
 * ガードサービスは実物を注入している(文法の正は 1 つ)。
 */

import { describe, expect, it } from 'vitest';
import { preconditionVerifier } from '../../../../lib/screen/verifiers/s5-precondition.js';
import {
  aggregate,
  entitySpec,
  field,
  specModel,
} from '../../../helpers/model-builder.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

/** workshop(state / entry_deadline)と、そこから context で辿れる member を持つドメイン。 */
function domain() {
  return specModel([
    aggregate('workshop', {
      entity: entitySpec('workshop', {
        // 段を辿るには「context の参照パスが ref(相手) の欄である」ことが要る(束 ⑲-2a)。
        context: { member: 'workshop.organizer_id' },
        fields: [
          field('state', { kind: 'state', machine: 'workshop' }),
          field('entry_deadline', { kind: 'datetime' }),
          field('organizer_id', { kind: 'ref', entity: 'member' }),
        ],
      }),
    }),
    aggregate('member', {
      entity: entitySpec('member', { fields: [field('display_name', { kind: 'string' })] }),
    }),
  ]);
}

/** S5 を実行して Finding を返す。 */
function run(init: Parameters<typeof screenInput>[0]) {
  return preconditionVerifier.verify(screenInput({ domain: domain(), ...init }), SCREEN_CTX);
}

describe('S5 入場条件', () => {
  it('subject に接地したガード式で行き先が実在すれば通る', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'guarded',
          subject: 'workshop',
          precondition: 'state == closed and now < entry_deadline',
          onFail: 'screen-login',
        }),
        screenSpec({ name: 'login' }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('context で辿れるエンティティのフィールドも参照できる', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'guarded',
          subject: 'workshop',
          precondition: 'member.display_name != none',
          onFail: 'screen-login',
        }),
        screenSpec({ name: 'login' }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('入場条件が無い画面は何も見ない', () => {
    expect(run({ screens: [screenSpec({ name: 'a' })] })).toEqual([]);
  });

  it('subject が entity_spec に無ければ失敗する', () => {
    const findings = run({ screens: [screenSpec({ name: 'a', subject: 'ghost' })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('subject の ghost');
  });

  it('ガード式として解析できない式を検出する', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'guarded',
          subject: 'workshop',
          precondition: '(state == draft)',
          onFail: 'screen-login',
        }),
        screenSpec({ name: 'login' }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('precondition の式を解析できません');
  });

  it('ドメインに無いパスを検出する(接地)', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'guarded',
          subject: 'workshop',
          precondition: 'actor.role != anonymous',
          onFail: 'screen-login',
        }),
        screenSpec({ name: 'login' }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('actor.role');
    expect(findings[0]?.suggestion).toContain('requires_auth: true');
  });

  it('subject から context で辿れないエンティティを検出する', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'guarded',
          subject: 'workshop',
          precondition: 'entry.state == draft',
          onFail: 'screen-login',
        }),
        screenSpec({ name: 'login' }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('context に entry がありません');
  });

  it('actor.id は書ける(対象との関係を表す比較)', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'guarded',
          subject: 'workshop',
          precondition: 'workshop.organizer_id == actor.id',
          onFail: 'screen-login',
        }),
        screenSpec({ name: 'login' }),
      ],
    });

    // organizer_id は entity_spec に無いのでそちらは失敗するが、actor.id 自体は咎めない。
    expect(findings.every((finding) => !finding.message.includes('actor'))).toBe(true);
  });

  it('予約語 now / actor 単体は接地の対象にしない', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'guarded',
          subject: 'workshop',
          precondition: 'now < entry_deadline',
          onFail: 'screen-login',
        }),
        screenSpec({ name: 'login' }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('now.{任意名} を検出する(now は単独でしか書けない)', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'guarded',
          subject: 'workshop',
          precondition: 'now.date < entry_deadline',
          onFail: 'screen-login',
        }),
        screenSpec({ name: 'login' }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('予約語 now に date はありません');
  });

  it('実在しない行き先を検出する', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'guarded',
          subject: 'workshop',
          precondition: 'state == draft',
          onFail: 'screen-ghost',
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('screen-ghost');
  });

  it('自分自身へ送り返す on_fail を検出する', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'guarded',
          subject: 'workshop',
          precondition: 'state == draft',
          onFail: 'screen-guarded',
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('自分自身');
  });

  it('2 画面が互いに送り返す閉路を検出する', () => {
    const findings = run({
      screens: [
        screenSpec({ name: 'a', subject: 'workshop', precondition: 'state == draft', onFail: 'screen-b' }),
        screenSpec({ name: 'b', subject: 'workshop', precondition: 'state == closed', onFail: 'screen-a' }),
      ],
    });

    // 閉路は 1 回だけ報告する(同じ事故を経路上の画面ごとに繰り返さない)。
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('閉路');
    expect(findings[0]?.counterexample?.['route']).toBe('screen-a → screen-b → screen-a');
  });

  it('閉路でない連鎖は通す', () => {
    const findings = run({
      screens: [
        screenSpec({ name: 'a', subject: 'workshop', precondition: 'state == draft', onFail: 'screen-b' }),
        screenSpec({ name: 'b', subject: 'workshop', precondition: 'state == closed', onFail: 'screen-c' }),
        screenSpec({ name: 'c' }),
      ],
    });

    expect(findings).toEqual([]);
  });
});
