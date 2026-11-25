/**
 * 変異器 `drop_abuse_ceiling` / `widen_create_to_anonymous` / `drop_public_reason`(`operators-abuse.ts`)の単体テスト。
 *
 * 見るのは 3 つ: 1 か所しか壊さない・壊した場所を宣言する・壊せる場所が無ければ空。
 * さらに「壊したモデルを R5 に通すと必ず指摘が出る」(= 検出器 `risk` が捕れる形になっている)を固定する。
 */

import { describe, expect, it } from 'vitest';
import type { AbuseDecl, CreateRule, SpecModel } from '../../../lib/model/types.js';
import { ALL_MUTATION_OPERATORS } from '../../../lib/mutation/operators.js';
import { ALL_MUTATION_DETECTORS } from '../../../lib/mutation/detectors.js';
import { verifyAbuse } from '../../../lib/risk/verifiers/r5-abuse.js';
import { accessSpec, aggregate, create, del, entitySpec, event, field, machine, role, roleSpec, specModel, write } from '../../helpers/model-builder.js';

const ABUSE: AbuseDecl = { globalCeiling: { max: 30, per: '1 hour' }, location: { file: 'docs/specs/domain/inquiry/access.md' } };

/** 変異器 1 つを ID で引く。 */
function operator(id: string) {
  const found = ALL_MUTATION_OPERATORS.find((candidate) => candidate.id === id);
  expect(found, `変異器 ${id} が目録に無い`).toBeDefined();
  return found!;
}

/** 未ログインの作成(天井つき)・未ログインの更新 / 削除 / 遷移(理由つき)を持つ集約と、何も開いていない集約の 2 つ。 */
function open(): SpecModel {
  const anonymousCreate: CreateRule = { ...create('anonymous'), abuse: ABUSE };
  return specModel([
    aggregate('inquiry', {
      entity: entitySpec('inquiry', { fields: [field('created_at', { kind: 'datetime' }, { auto: true }), field('note', { kind: 'string' })] }),
      stateMachines: [
        machine('inquiry', {
          states: ['new', 'closed'],
          initial: 'new',
          events: [
            { ...event('withdraw', { from: ['new'], to: 'closed', by: ['anonymous'] }), public: '送り主の取り下げ' },
            event('close', { from: ['new'], to: 'closed', by: ['member'] }),
          ],
        }),
      ],
      access: accessSpec('inquiry', {
        creates: [anonymousCreate, create('member')],
        writes: [{ ...write('anonymous', ['note']), public: '直後の直し' }, write('member', ['note'])],
        deletes: [{ ...del('anonymous'), public: '取り下げ' }, del('member')],
      }),
    }),
    aggregate('closed_book', {
      entity: entitySpec('closed_book', { fields: [field('created_at', { kind: 'datetime' }, { auto: true })] }),
      access: accessSpec('closed_book', { creates: [create('member')] }),
    }),
  ]);
}

/** モデルを R5 に通した指摘の数。 */
const findingsOf = (model: SpecModel): number => verifyAbuse(model).length;

describe('drop_abuse_ceiling', () => {
  it('未ログインの作成の abuse を 1 本だけ消す(ほかの規則・宣言は道連れにならない)', () => {
    const mutants = operator('drop_abuse_ceiling').mutate(open());

    expect(mutants).toHaveLength(1);
    expect(mutants[0]?.at).toBe('inquiry の creates[0](by: anonymous) の abuse を消した');
    expect(mutants[0]?.site).toEqual({ entity: 'inquiry', shape: 'create', by: 'anonymous' });
    const access = mutants[0]!.model.aggregates.get('inquiry')!.access!;
    expect(access.creates.map((rule) => `${rule.by}:${rule.abuse === undefined ? 'none' : 'abuse'}`)).toEqual(['anonymous:none', 'member:none']);
    expect(access.writes[0]?.public).toBe('直後の直し');
  });

  it('壊したモデルは R5 が止める(元のモデルは 0 件)', () => {
    expect(findingsOf(open())).toBe(0);
    expect(findingsOf(operator('drop_abuse_ceiling').mutate(open())[0]!.model)).toBe(1);
  });

  it('abuse を持つ未ログインの作成が無ければ空を返す', () => {
    const none = specModel([aggregate('a', { access: accessSpec('a', { creates: [create('anonymous'), create('member')] }) })]);

    expect(operator('drop_abuse_ceiling').mutate(none)).toEqual([]);
  });

  it('未ログインのロールが無い仕様では空を返す', () => {
    const roles = roleSpec([role('member'), role('system')]);
    const rule: CreateRule = { ...create('member'), abuse: ABUSE };

    expect(operator('drop_abuse_ceiling').mutate(specModel([aggregate('a', { access: accessSpec('a', { creates: [rule] }) })], roles))).toEqual([]);
  });
});

describe('widen_create_to_anonymous', () => {
  it('未ログインの作成が無い集約にだけ、abuse の無い未ログインの作成を足す', () => {
    const mutants = operator('widen_create_to_anonymous').mutate(open());

    expect(mutants).toHaveLength(1);
    expect(mutants[0]?.at).toBe('closed_book の creates に by: anonymous(abuse なし)を足した');
    const access = mutants[0]!.model.aggregates.get('closed_book')!.access!;
    expect(access.creates.map((rule) => rule.by)).toEqual(['member', 'anonymous']);
    expect(access.creates[1]?.abuse).toBeUndefined();
    expect(mutants[0]!.model.aggregates.get('inquiry')!.access!.creates).toHaveLength(2);
  });

  it('壊したモデルは R5 が止める', () => {
    expect(findingsOf(operator('widen_create_to_anonymous').mutate(open())[0]!.model)).toBe(1);
  });

  it('access を持たない集約・既に未ログインの作成がある集約は壊さない', () => {
    const model = specModel([aggregate('bare'), aggregate('a', { access: accessSpec('a', { creates: [create('anonymous')] }) })]);

    expect(operator('widen_create_to_anonymous').mutate(model)).toEqual([]);
  });

  it('未ログインのロールが無い仕様では空を返す', () => {
    const roles = roleSpec([role('member'), role('system')]);

    expect(operator('widen_create_to_anonymous').mutate(specModel([aggregate('a', { access: accessSpec('a') })], roles))).toEqual([]);
  });
});

describe('drop_public_reason', () => {
  it('未ログインに開いた更新・削除・遷移の public をそれぞれ 1 本ずつ消す', () => {
    const mutants = operator('drop_public_reason').mutate(open());

    expect(mutants.map((mutant) => mutant.at)).toEqual([
      'inquiry の writes[0](by: anonymous) の public を消した',
      'inquiry の deletes[0](by: anonymous) の public を消した',
      'inquiry の withdraw(by: anonymous) の public を消した',
    ]);
  });

  it('1 件は 1 か所だけを壊す(消すのは対象の public だけで、ほかの public は残る)', () => {
    const [writes, deletes, events] = operator('drop_public_reason').mutate(open());
    const access = (mutant: typeof writes) => mutant!.model.aggregates.get('inquiry')!.access!;

    expect([access(writes).writes[0]?.public, access(writes).deletes[0]?.public]).toEqual([undefined, '取り下げ']);
    expect([access(deletes).writes[0]?.public, access(deletes).deletes[0]?.public]).toEqual(['直後の直し', undefined]);
    const machineOf = events!.model.aggregates.get('inquiry')!.stateMachines[0]!;
    expect(machineOf.events.map((current) => current.public)).toEqual([undefined, undefined]);
    expect(access(events).writes[0]?.public).toBe('直後の直し');
  });

  it('壊したモデルは 3 件とも R5 が止める', () => {
    for (const mutant of operator('drop_public_reason').mutate(open())) {
      expect(findingsOf(mutant.model), mutant.at).toBe(1);
    }
  });

  it('public を持つ未ログインの規則が無ければ空を返す', () => {
    const model = specModel([aggregate('a', { access: accessSpec('a', { writes: [write('member', ['x'])], deletes: [del('member')] }) })]);

    expect(operator('drop_public_reason').mutate(model)).toEqual([]);
  });

  it('未ログインのロールが無い仕様では空を返す', () => {
    const roles = roleSpec([role('member'), role('system')]);
    const rule = { ...del('member'), public: '腐った受け入れ' };

    expect(operator('drop_public_reason').mutate(specModel([aggregate('a', { access: accessSpec('a', { deletes: [rule] }) })], roles))).toEqual([]);
  });
});

describe('検出器 risk', () => {
  it('3 つの変異器の変異は、検出器 risk の指紋が変異の前後で変わる', () => {
    const risk = ALL_MUTATION_DETECTORS.find((detector) => detector.id === 'risk')!;
    const subject = { jobs: undefined, actions: undefined, dataTables: undefined } as unknown as Parameters<typeof risk.fingerprint>[1];
    const base = open();

    for (const id of ['drop_abuse_ceiling', 'widen_create_to_anonymous', 'drop_public_reason']) {
      for (const mutant of operator(id).mutate(base)) {
        expect(risk.fingerprint(mutant.model, subject), mutant.at).not.toBe(risk.fingerprint(base, subject));
      }
    }
  });
});
