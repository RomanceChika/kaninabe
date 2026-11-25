/**
 * S4(ロール整合)のテスト。
 *
 * screen-spec-writing.md の S4 が要求する 3 つ(for が実在するグローバルロールであること・
 * 読むクエリの for に含まれること・発火する操作の by と交差すること)にケースを置く。
 * 最後の 1 つだけが警告であることも検査する。
 */

import { describe, expect, it } from 'vitest';
import { roleConsistencyVerifier } from '../../../../lib/screen/verifiers/s4-role-consistency.js';
import {
  accessSpec,
  aggregate,
  create,
  event,
  machine,
  role,
  roleSpec,
  specModel,
} from '../../../helpers/model-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

/** member / anonymous と、member を含意する performer を持つドメイン。 */
function domain() {
  return specModel(
    [
      aggregate('entry', {
        stateMachines: [
          machine('entry', {
            states: ['draft', 'submitted'],
            initial: 'draft',
            events: [event('submit', { from: ['draft'], to: 'submitted', by: ['performer'] })],
          }),
        ],
        access: accessSpec('entry', { creates: [create('member')] }),
      }),
    ],
    roleSpec(['member', 'anonymous', role('performer', 'entry.performer_id == actor.id', ['member'])]),
  );
}

/** S4 を実行して Finding を返す。 */
function run(init: Parameters<typeof screenInput>[0]) {
  return roleConsistencyVerifier.verify(screenInput({ domain: domain(), ...init }), SCREEN_CTX);
}

describe('S4 ロール整合', () => {
  it('予約 ID を集約名で書いてもロールを引ける（S10 の正規化はこの挙動が前提）', () => {
    const model = specModel([
      aggregate('program', { access: accessSpec('program_item', { creates: [create('organizer')] }) }),
    ], roleSpec(['member', 'anonymous', 'organizer']));

    const findings = roleConsistencyVerifier.verify(
      screenInput({
        domain: model,
        screens: [screenSpec({ name: 'a', for: ['organizer'], actions: ['program.create'] })],
      }),
      SCREEN_CTX,
    );

    expect(findings).toEqual([]);
  });

  it('for がクエリの for に含まれ、操作の by と交差すれば通る', () => {
    const findings = run({
      queries: [querySpec({ name: 'own_list', source: 'entry', for: ['member'], scopeUsed: 'own' })],
      screens: [
        screenSpec({
          name: 'a',
          for: ['member'],
          reads: ['query-own-list'],
          actions: ['entry.create', 'entry.submit'],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('roles.md に無いロールを検出する', () => {
    const findings = run({ screens: [screenSpec({ name: 'a', for: ['guest'] })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('roles.md にありません');
  });

  it('for に文脈依存ロールを書いたら失敗する', () => {
    const findings = run({ screens: [screenSpec({ name: 'a', for: ['performer'] })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('文脈依存ロール');
  });

  it('クエリを実行できないロールを検出する', () => {
    const findings = run({
      queries: [querySpec({ name: 'own_list', source: 'entry', for: ['member'], scopeUsed: 'own' })],
      screens: [screenSpec({ name: 'a', for: ['anonymous'], reads: ['query-own-list'] })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('own_list を実行できません');
  });

  it('操作の by と交差しないときは警告に留める', () => {
    const findings = run({
      screens: [screenSpec({ name: 'a', for: ['anonymous'], actions: ['entry.submit'] })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('entry.submit');
  });

  it('by が implies で for を含意していれば交差とみなす', () => {
    // entry.submit の by は performer だが、performer は member を含意する。
    const findings = run({
      screens: [screenSpec({ name: 'a', for: ['member'], actions: ['entry.submit'] })],
    });

    expect(findings).toEqual([]);
  });

  it('重ね表示に置いた操作の by も数える(V9)', () => {
    // 重ね表示に隠せば「誰も実行できない操作」の警告を免れる、という抜け道を塞ぐ。
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          for: ['anonymous'],
          actions: [],
          slots: [{ slot: 'body.center', components: ['submit_bar'] }],
          overlays: [{ id: 'confirm', openedBy: 'submit_bar', actions: ['entry.submit'] }],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('entry.submit');
  });

  it('実在しない参照は S2 に任せて重ねてエラーにしない', () => {
    const findings = run({
      queries: [],
      screens: [screenSpec({ name: 'a', reads: ['query-missing'], actions: ['entry.ghost'] })],
    });

    expect(findings).toEqual([]);
  });
});

describe('S4: 読み取りクエリ(query_spec)が阻害のとき(入力の状態の保留)', () => {
  const mismatched = () =>
    screenInput({
      queries: [querySpec({ name: 'own_list', source: 'entry', for: ['organizer'], scopeUsed: 'own' })],
      screens: [screenSpec({ name: 'a', for: ['member'], reads: ['query-own-list'] })],
    });

  it('読めていれば、読み取りクエリの for に居ないロールを言う(保留が効いている対)', () => {
    expect(roleConsistencyVerifier.verify(mismatched(), SCREEN_CTX).map((finding) => finding.message)).toEqual([
      expect.stringContaining('画面のロール member は own_list を実行できません'),
    ]);
  });

  it('阻害なら reads とのロール整合は言わない', () => {
    expect(roleConsistencyVerifier.verify(mismatched(), { ...SCREEN_CTX, blockedInputs: ['queries'] })).toEqual([]);
  });
});
