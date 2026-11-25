/**
 * S14(状態の可視性)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md「状態機械の各状態 s について、s の実体を返しうる
 * 読み取り経路(query_spec の filters が s を除外しない)を reads に持ち、人間ロールが
 * 入れる画面が存在する。無ければ warning」。V6(デッドエンド)の画面版。
 */

import { describe, expect, it } from 'vitest';
import { stateVisibilityVerifier } from '../../../../lib/screen/verifiers/s14-state-visibility.js';
import { aggregate, entitySpec, event, field, machine, specModel } from '../../../helpers/model-builder-v8plus.js';
import { screenInput, screenSpec, SCREEN_CTX } from '../../../helpers/screen-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';

/** workshop(draft → published)を持つ最小ドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'workshop',
        entity: entitySpec('workshop', [field('state', { kind: 'state', machine: 'workshop' })]),
        stateMachines: [
          machine({
            machine: 'workshop',
            states: ['draft', 'published'],
            events: [event({ id: 'publish', from: ['draft'], to: 'published', by: ['organizer'] })],
          }),
        ],
      }),
    ],
  });
}

describe('S14 状態の可視性', () => {
  it('絞り込みで残る状態を見せる画面があれば通る', () => {
    const query = querySpec({
      name: 'workshop_list',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      filters: ['state == published'],
    });
    const screen = screenSpec({ name: 'workshop_list', for: ['member'], reads: ['query-workshop-list'] });

    const findings = stateVisibilityVerifier.verify(
      screenInput({ domain: domain(), queries: [query], screens: [screen] }),
      SCREEN_CTX,
    );
    // published は見える。draft は絞り込みに除外されており、見せる経路が無いので警告 1 件。
    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ state: 'workshop.draft' });
  });

  it('見せる読み取り経路が無ければ警告する', () => {
    const query = querySpec({
      name: 'workshop_list',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      filters: ['state == published'],
    });
    const screen = screenSpec({ name: 'workshop_list', for: ['member'], reads: ['query-workshop-list'] });

    const findings = stateVisibilityVerifier.verify(
      screenInput({ domain: domain(), queries: [query], screens: [screen] }),
      SCREEN_CTX,
    );

    const draftFinding = findings.find((f) => f.counterexample?.['state'] === 'workshop.draft');
    expect(draftFinding).toBeDefined();
    expect(draftFinding?.verifier).toBe('S14');
    expect(draftFinding?.severity).toBe('warning');
    expect(draftFinding?.message).toContain('workshop.draft');
  });

  it('理由を宣言すれば免除される', () => {
    const query = querySpec({
      name: 'workshop_list',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      filters: ['state == published'],
    });
    const screen = screenSpec({ name: 'workshop_list', for: ['member'], reads: ['query-workshop-list'] });

    const findings = stateVisibilityVerifier.verify(
      screenInput({
        domain: domain(),
        queries: [query],
        screens: [screen],
        unseenStates: [{ state: 'workshop.draft', reason: '下書きは一瞬の内部状態' }],
      }),
      SCREEN_CTX,
    );
    expect(findings).toEqual([]);
  });

  it('絞り込みの無いクエリなら全状態が見える(警告 0)', () => {
    const query = querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all' });
    const screen = screenSpec({ name: 'workshop_list', for: ['member'], reads: ['query-workshop-list'] });

    const findings = stateVisibilityVerifier.verify(
      screenInput({ domain: domain(), queries: [query], screens: [screen] }),
      SCREEN_CTX,
    );
    expect(findings).toEqual([]);
  });

  it('画面をまだ仕様化していないリポジトリでは何も見ない', () => {
    const findings = stateVisibilityVerifier.verify(
      screenInput({ domain: domain(), screensUnavailable: true }),
      SCREEN_CTX,
    );
    expect(findings).toEqual([]);
  });

  it('関門(auth)が阻害なら判定を出さない(関門が分からないまま、見える画面を決めない)。画面の欠けだけでは出し続ける', () => {
    const query = querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all', filters: ['state == published'] });
    const screen = screenSpec({ name: 'workshop_list', for: ['member'], reads: ['query-workshop-list'] });
    const input = screenInput({ domain: domain(), queries: [query], screens: [screen] });

    expect(stateVisibilityVerifier.verify(input, { ...SCREEN_CTX, reachabilityGaps: [{ input: 'auth', state: 'blocked', reason: 'invalid' }] })).toEqual([]);
    expect(stateVisibilityVerifier.verify(input, { ...SCREEN_CTX, reachabilityGaps: [{ input: 'screens', state: 'blocked', reason: 'invalid' }] })).toHaveLength(1);
  });
});

describe('S14: 読み取りクエリ(query_spec)が阻害のとき(入力の状態の保留)', () => {
  it('読めていれば見せる経路の無い状態を言い、阻害なら言わない(欠けた query で「見える経路が無い」と言わない)', () => {
    const query = querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all', filters: ['state == published'] });
    const screen = screenSpec({ name: 'workshop_list', for: ['member'], reads: ['query-workshop-list'] });
    const input = screenInput({ domain: domain(), queries: [query], screens: [screen] });

    expect(stateVisibilityVerifier.verify(input, SCREEN_CTX)).toHaveLength(1);
    expect(stateVisibilityVerifier.verify(input, { ...SCREEN_CTX, blockedInputs: ['queries'] })).toEqual([]);
  });

  it('ユースケース仕様の阻害は S14 に関わらない(読み取りクエリの阻害だけに依る)', () => {
    const query = querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all', filters: ['state == published'] });
    const screen = screenSpec({ name: 'workshop_list', for: ['member'], reads: ['query-workshop-list'] });
    const input = screenInput({ domain: domain(), queries: [query], screens: [screen] });

    expect(stateVisibilityVerifier.verify(input, { ...SCREEN_CTX, blockedInputs: ['usecases'] })).toHaveLength(1);
  });
});

describe('S14: 阻害のとき出せる判定は出す(止めるのは見える経路が無いという判定だけ)', () => {
  const query = () => querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all' });
  const screen = () => screenSpec({ name: 'workshop_list', for: ['member'], reads: ['query-workshop-list'] });

  it('読み取りクエリが阻害でも、実在しない状態の宣言(unseen_states の綴り違い)は言う', () => {
    const input = screenInput({ domain: domain(), queries: [query()], screens: [screen()], unseenStates: [{ state: 'workshop.nowhere', reason: '綴り違い' }] });

    const findings = stateVisibilityVerifier.verify(input, { ...SCREEN_CTX, blockedInputs: ['queries'] });

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('workshop.nowhere は状態機械の状態として存在しません')]);
  });

  it('読み取りクエリが阻害でも、読めた経路で見える状態に残った免除宣言(消し忘れ)は言う。見えない状態を「経路が無い」とは言わない', () => {
    const input = screenInput({ domain: domain(), queries: [query()], screens: [screen()], unseenStates: [{ state: 'workshop.draft', reason: '下書きは内部状態' }] });

    expect(stateVisibilityVerifier.verify(input, SCREEN_CTX).map((finding) => finding.message)).toEqual([expect.stringContaining('workshop.draft は見える経路ができたのに')]);
    expect(stateVisibilityVerifier.verify(input, { ...SCREEN_CTX, blockedInputs: ['queries'] }).map((finding) => finding.message)).toEqual([
      expect.stringContaining('workshop.draft は見える経路ができたのに'),
    ]);
    // 宣言の無い状態で、読めた経路に見えない状態は「経路が無い」と言わない(落とした読みが見せているかもしれない)
    const filtered = screenInput({
      domain: domain(),
      queries: [querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all', filters: ['state == published'] })],
      screens: [screen()],
    });
    expect(stateVisibilityVerifier.verify(filtered, SCREEN_CTX)).toHaveLength(1);
    expect(stateVisibilityVerifier.verify(filtered, { ...SCREEN_CTX, blockedInputs: ['queries'] })).toEqual([]);
  });

  it('関門が阻害なら、実在しない状態の宣言は言うが、消し忘れは言わない(関門が欠けた見積もりで「見える」と言わない)', () => {
    const gateGap = [{ input: 'auth', state: 'blocked', reason: 'invalid' }] as const;
    const input = screenInput({
      domain: domain(),
      queries: [query()],
      screens: [screen()],
      unseenStates: [{ state: 'workshop.draft', reason: '下書きは内部状態' }, { state: 'workshop.nowhere', reason: '綴り違い' }],
    });

    const findings = stateVisibilityVerifier.verify(input, { ...SCREEN_CTX, reachabilityGaps: gateGap });

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('workshop.nowhere は状態機械の状態として存在しません')]);
  });
});
