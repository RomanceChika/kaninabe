/**
 * 画面の到達の判定(関係の層 `lib/relations/screen-reachability/` の入口)のテスト。
 *
 * 見るのは 4 つ。
 *   1. **開始点の違いは引数**: 同じ探索を `entry-points`(S13 / L2)と `screen`(Y3 / S16 / 導出)で問い、結果が
 *      ロール・起点を添えた型つきの値で返る(`.success` の辺は辿らない・入れない画面の先へは行かない)
 *   2. **入れるか**: `for`(ロール階層)・`requires_auth`・`role_gate` の 3 つの関門
 *   3. **状態 × ロールの到達**: 画面が遷移を発火する・入れる・precondition が状態を弾かない・入口から届く
 *   4. **入力の状態**: 画面が未選択・阻害のとき、探索は 0 枚として行い、理由を `gaps` で返す(0 件の読込済みは阻害ではない)。
 *      認証フローの関門は、未選択なら「関門は無い」事実(gaps に載せない)・阻害なら載せる(関門を空として探索する)
 */

import { describe, expect, it } from 'vitest';
import { catalogInput, availableLoad } from '../../../../lib/kernel/input-state.js';
import {
  deriveScreenReachability,
  gatesBlocked,
  gatesUnverifiedNote,
  loadedGates,
  roleCanEnter,
  screenReachabilityOfModels,
} from '../../../../lib/relations/screen-reachability/index.js';
import type { AuthGateDecl } from '../../../../lib/model/auth/types.js';
import type { ScreenSpec } from '../../../../lib/model/screen/types.js';
import { listHumanEvents } from '../../../../lib/trace/human-operations.js';
import { authGate } from '../../../helpers/auth-builder.js';
import { aggregate, entitySpec, event, field, machine, role, specModel } from '../../../helpers/model-builder-v8plus.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** 関門が 0 本の読込済み(認証フロー仕様の関門が空)。 */
const NO_GATES = loadedInput<readonly AuthGateDecl[]>([]);

/** entry(draft → submitted, by: performer)を持つ最小ドメイン。performer implies member。 */
function domain() {
  return specModel({
    roles: [role('anonymous'), role('member'), role('performer', undefined, ['member']), role('system')],
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [field('state', { kind: 'state', machine: 'entry' })]),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['performer'] })],
          }),
        ],
      }),
    ],
  });
}

const home = screenSpec({ name: 'home', for: ['member'], entryPoint: true, navigations: [{ on: 'open_list', to: 'screen-list' }] });
const list = screenSpec({
  name: 'list',
  for: ['member'],
  navigations: [
    { on: 'open_detail', to: 'screen-detail' },
    { on: 'entry.submit.success', to: 'screen-done' },
  ],
});
const detail = screenSpec({ name: 'detail', for: ['member'] });
const done = screenSpec({ name: 'done', for: ['member'] });
const lonely = screenSpec({ name: 'lonely', for: ['member'] });

/** 画面だけから作った到達の判定(関門なし)。 */
function reachabilityOf(screens: readonly ScreenSpec[], gates: readonly AuthGateDecl[] = []) {
  const model = domain();
  return screenReachabilityOfModels(model, screenInput({ domain: model, screens }).screens, loadedGates(gates));
}

describe('開始点の違いは引数(同じ探索)', () => {
  const screens = [home, list, detail, done, lonely];

  it('entry-points: entry_point の画面から辿れる画面だけ(`.success` の辺は押した結果なので辿らない・孤立した画面は含まない)', () => {
    const result = reachabilityOf(screens).reach('member', { kind: 'entry-points' });
    expect([...result.screenIds].sort()).toEqual(['screen-detail', 'screen-home', 'screen-list']);
    expect(result.role).toBe('member');
    expect(result.start).toEqual({ kind: 'entry-points' });
  });

  it('screen: 指定した画面から。entry_point でなくてもよく、起点自身を含む', () => {
    const reachability = reachabilityOf(screens);
    expect([...reachability.reach('member', { kind: 'screen', id: 'screen-list' }).screenIds].sort()).toEqual(['screen-detail', 'screen-list']);
    expect([...reachability.reach('member', { kind: 'screen', id: 'screen-lonely' }).screenIds]).toEqual(['screen-lonely']);
    expect(reachability.reach('member', { kind: 'screen', id: 'screen-home' }).start).toEqual({ kind: 'screen', id: 'screen-home' });
  });

  it('起点が実在しない・ロールが入れないなら空(起点に届かない = 何にも届かない)', () => {
    const reachability = reachabilityOf([...screens, screenSpec({ name: 'backstage', for: ['performer'], navigations: [{ on: 'back', to: 'screen-home' }] })]);
    expect(reachability.reach('member', { kind: 'screen', id: 'screen-nowhere' }).screenIds.size).toBe(0);
    expect(reachability.reach('member', { kind: 'screen', id: 'screen-backstage' }).screenIds.size).toBe(0);
    expect(reachability.reach('performer', { kind: 'screen', id: 'screen-backstage' }).screenIds.has('screen-home')).toBe(true);
  });

  it('入れない画面の先は経路に数えない(途中の画面にもロールが入れることを求める)', () => {
    const gate = screenSpec({ name: 'gate', for: ['performer'], navigations: [{ on: 'go', to: 'screen-beyond' }] });
    const beyond = screenSpec({ name: 'beyond', for: ['member'] });
    const start = screenSpec({ name: 'start', for: ['member'], entryPoint: true, navigations: [{ on: 'go', to: 'screen-gate' }] });
    const reachability = reachabilityOf([start, gate, beyond]);
    expect([...reachability.reach('member', { kind: 'entry-points' }).screenIds]).toEqual(['screen-start']);
    expect([...reachability.reach('performer', { kind: 'entry-points' }).screenIds].sort()).toEqual(['screen-beyond', 'screen-gate', 'screen-start']);
  });

  it('実在しない遷移先は無視する(S2 が指摘済み)', () => {
    const stray = screenSpec({ name: 'stray', for: ['member'], entryPoint: true, navigations: [{ on: 'go', to: 'screen-missing' }] });
    expect([...reachabilityOf([stray]).reach('member', { kind: 'entry-points' }).screenIds]).toEqual(['screen-stray']);
  });
});

describe('入れるか(3 つの関門)', () => {
  const model = domain();

  it('for はロール階層まで見て交差する(performer implies member)', () => {
    const screen = screenSpec({ name: 'm', for: ['member'] });
    expect(roleCanEnter(model, [], screen, 'performer', undefined)).toBe(true);
    expect(roleCanEnter(model, [], screen, 'anonymous', undefined)).toBe(false);
  });

  it('requires_auth の画面には匿名ロールが入れない', () => {
    const screen = screenSpec({ name: 'm', for: ['member', 'anonymous'], requiresAuth: true });
    expect(roleCanEnter(model, [], screen, 'anonymous', 'anonymous')).toBe(false);
    expect(roleCanEnter(model, [], screen, 'member', 'anonymous')).toBe(true);
  });

  it('role_gate は gates の宣言する 1 ロールだけを入れる', () => {
    const screen = screenSpec({ name: 'm', for: ['member', 'performer'] });
    const gates = [authGate('performer_only', { guards: 'role_gate', role: 'performer', onFail: 'not_found' })];
    expect(roleCanEnter(model, gates, screen, 'performer', undefined)).toBe(true);
    expect(roleCanEnter(model, gates, screen, 'member', undefined)).toBe(false);
    expect(roleCanEnter(model, [], screen, 'member', undefined)).toBe(true);
  });

  it('値の入口と、到達の判定の canEnter は同じ答えを返す(判定を 2 つ持たない)', () => {
    const screen = screenSpec({ name: 'm', for: ['member'], requiresAuth: true });
    const reachability = reachabilityOf([screen]);
    for (const roleId of ['anonymous', 'member', 'performer', 'system']) {
      expect(reachability.canEnter(screen, roleId), roleId).toBe(roleCanEnter(model, [], screen, roleId, 'anonymous'));
    }
  });
});

describe('操作を出す画面(exposedBy)', () => {
  it('画面と重ね表示の操作を、正規化した ID で引く(同じ操作を出す画面は宣言順)', () => {
    const a = screenSpec({ name: 'a', actions: ['entry.submit'] });
    const b = screenSpec({ name: 'b', overlays: [{ id: 'confirm', actions: ['entry.submit'] }] });
    const reachability = reachabilityOf([a, b]);
    expect((reachability.exposedBy.get('entry.submit') ?? []).map((screen) => screen.name)).toEqual(['a', 'b']);
    expect(reachability.exposedBy.get('entry.other')).toBeUndefined();
  });
});

describe('状態 × ロールの到達', () => {
  const model = domain();
  const entry = listHumanEvents(model)[0];
  if (entry === undefined) throw new Error('テスト用ドメインに人間のイベントが無い');
  const reachOf = (screens: readonly ScreenSpec[]) => reachabilityOf(screens).stateRoleReach(SCREEN_CTX.guards, entry);

  it('入れて・弾かず・入口から届く画面があれば、その画面を代表として返す', () => {
    const screen = screenSpec({ name: 'detail', for: ['member'], entryPoint: true, actions: ['entry.submit'], subject: 'entry' });
    expect(reachOf([screen]).map(({ role: r, state, screen: s }) => [r, state, s?.name])).toEqual([['performer', 'draft', 'detail']]);
  });

  it('precondition が状態を弾く・入口から届かない画面しか無ければ、画面は undefined', () => {
    const rejecting = screenSpec({
      name: 'detail',
      for: ['member'],
      entryPoint: true,
      actions: ['entry.submit'],
      subject: 'entry',
      precondition: 'state == submitted',
      onFail: 'detail',
    });
    expect(reachOf([rejecting]).map((r) => r.screen)).toEqual([undefined]);
    const detached = screenSpec({ name: 'detail', for: ['member'], actions: ['entry.submit'], subject: 'entry' });
    expect(reachOf([detached]).map((r) => r.screen)).toEqual([undefined]);
  });

  it('内部実行ロール(system)は対象にせず、人間ロールだけを組にする(from の各状態 × by の人間ロール)', () => {
    const mixed = specModel({
      roles: [role('anonymous'), role('member'), role('performer', undefined, ['member']), role('system')],
      aggregates: [
        aggregate({
          name: 'entry',
          entity: entitySpec('entry', [field('state', { kind: 'state', machine: 'entry' })]),
          stateMachines: [
            machine({
              machine: 'entry',
              states: ['draft', 'pending', 'submitted'],
              events: [event({ id: 'submit', from: ['draft', 'pending'], to: 'submitted', by: ['performer', 'system'] })],
            }),
          ],
        }),
      ],
    });
    const mixedEntry = listHumanEvents(mixed)[0];
    if (mixedEntry === undefined) throw new Error('テスト用ドメインに人間のイベントが無い');
    const screen = screenSpec({ name: 'detail', for: ['member'], entryPoint: true, actions: ['entry.submit'], subject: 'entry' });
    const reachability = screenReachabilityOfModels(mixed, screenInput({ domain: mixed, screens: [screen] }).screens, NO_GATES);
    expect(reachability.stateRoleReach(SCREEN_CTX.guards, mixedEntry).map((r) => `${r.role}/${r.state}`)).toEqual(['performer/draft', 'performer/pending']);
  });

  it('状態フィールドを引けない遷移は空(構造上ありえない機械)', () => {
    const noField = specModel({
      roles: [role('anonymous'), role('member'), role('performer', undefined, ['member']), role('system')],
      aggregates: [
        aggregate({
          name: 'entry',
          entity: entitySpec('entry', [field('title', { kind: 'string' })]),
          stateMachines: [machine({ machine: 'entry', states: ['draft', 'submitted'], events: [event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['performer'] })] })],
        }),
      ],
    });
    const noFieldEntry = listHumanEvents(noField)[0];
    if (noFieldEntry === undefined) throw new Error('テスト用ドメインに人間のイベントが無い');
    const reachability = screenReachabilityOfModels(noField, screenInput({ domain: noField, screens: [] }).screens, NO_GATES);
    expect(reachability.stateRoleReach(SCREEN_CTX.guards, noFieldEntry)).toEqual([]);
  });
});

describe('入力の状態(gaps)', () => {
  const model = domain();
  const loadedModel = screenInput({ domain: model, screens: [home, list] }).screens;

  it('読込済みなら gaps は空', () => {
    const reachability = deriveScreenReachability({ domain: model, screens: catalogInput('selected', availableLoad(loadedModel)), gates: NO_GATES });
    expect(reachability.gaps).toEqual([]);
    expect(reachability.reach('member', { kind: 'entry-points' }).screenIds.size).toBe(2);
  });

  it('0 件の読込済みは阻害ではない(gaps が空で、届く画面は 0 枚)', () => {
    const empty = screenInput({ domain: model, screens: [] }).screens;
    const reachability = screenReachabilityOfModels(model, empty, NO_GATES);
    expect(reachability.gaps).toEqual([]);
    expect(reachability.reach('member', { kind: 'entry-points' }).screenIds.size).toBe(0);
  });

  it('未選択は理由つきで返し、画面は 0 枚として探索する', () => {
    const reachability = deriveScreenReachability({ domain: model, screens: catalogInput('unselected'), gates: NO_GATES });
    expect(reachability.gaps).toEqual([{ input: 'screens', state: 'unselected' }]);
    expect(reachability.reach('member', { kind: 'entry-points' }).screenIds.size).toBe(0);
    expect(reachability.exposedBy.size).toBe(0);
  });

  it('阻害は理由を返す(渡されない = not-loaded・置き場に仕様が無い = missing)', () => {
    expect(screenReachabilityOfModels(model, undefined, NO_GATES).gaps).toEqual([{ input: 'screens', state: 'blocked', reason: 'not-loaded' }]);
    const unavailable = screenInput({ domain: model, screensUnavailable: true }).screens;
    expect(screenReachabilityOfModels(model, unavailable, NO_GATES).gaps).toEqual([{ input: 'screens', state: 'blocked', reason: 'missing' }]);
  });

  it('読めずに捨てた仕様がある入力も阻害(invalid)', () => {
    const finding = { verifier: 'S0', severity: 'error', message: 'x', location: { file: 'f' }, suggestion: 's' } as const;
    const input = catalogInput('selected', { model: { available: true, catalog: loadedModel }, findings: [finding], dropped: 1 });
    expect(deriveScreenReachability({ domain: model, screens: input, gates: NO_GATES }).gaps).toEqual([{ input: 'screens', state: 'blocked', reason: 'invalid' }]);
  });
});

describe('認証フローの関門の入力の状態(gaps の auth)', () => {
  const model = domain();
  const screens = catalogInput('selected', availableLoad(screenInput({ domain: model, screens: [home, list] }).screens));
  const gated = screenSpec({ name: 'gated', for: ['member'], entryPoint: true, requiresAuth: true });
  const gatedScreens = catalogInput('selected', availableLoad(screenInput({ domain: model, screens: [gated] }).screens));
  const gates = [authGate('requires_auth', { guards: 'requires_auth' })];
  const reachOf = (input: ReturnType<typeof deriveScreenReachability>) => input.reach('anonymous', { kind: 'entry-points' }).screenIds.size;

  it('読込済み(0 本含む)は gaps に載らない', () => {
    expect(deriveScreenReachability({ domain: model, screens, gates: NO_GATES }).gaps).toEqual([]);
    expect(deriveScreenReachability({ domain: model, screens: gatedScreens, gates: loadedInput(gates) }).gaps).toEqual([]);
  });

  it('未選択は「関門は無い」事実: gaps に載せず、関門 0 本として探索する', () => {
    const reachability = deriveScreenReachability({ domain: model, screens: gatedScreens, gates: UNSELECTED });

    expect(reachability.gaps).toEqual([]);
    expect(reachOf(reachability)).toBe(0); // anonymous は for: member の画面に入れない(関門に依らない)
  });

  it('阻害は gaps に理由つきで載り(画面が読込済みでも)、関門を空として探索する', () => {
    const reachability = deriveScreenReachability({ domain: model, screens, gates: blockedInput<readonly AuthGateDecl[]>('invalid') });

    expect(reachability.gaps).toEqual([{ input: 'auth', state: 'blocked', reason: 'invalid' }]);
    expect(reachability.reach('member', { kind: 'entry-points' }).screenIds.size).toBe(2);
  });

  it('画面も関門も使えないときは、両方を載せる(画面、関門の順)', () => {
    const reachability = deriveScreenReachability({ domain: model, screens: catalogInput('unselected'), gates: blockedInput<readonly AuthGateDecl[]>('missing') });

    expect(reachability.gaps).toEqual([
      { input: 'screens', state: 'unselected' },
      { input: 'auth', state: 'blocked', reason: 'missing' },
    ]);
  });
});

describe('生成側が読む関門の口(loadedGates / gatesBlocked / gatesUnverifiedNote)', () => {
  const model = domain();
  const screens = screenInput({ domain: model, screens: [home, list] }).screens;

  it('screenReachabilityOfModels は関門の入力の状態をそのまま受け、阻害なら gaps に載せる(空の関門で「到達 0」と断定しない手がかり)', () => {
    const blocked = screenReachabilityOfModels(model, screens, blockedInput<readonly AuthGateDecl[]>('invalid'));

    expect(blocked.gaps).toEqual([{ input: 'auth', state: 'blocked', reason: 'invalid' }]);
    expect(screenReachabilityOfModels(model, screens, loadedGates([])).gaps).toEqual([]);
    expect(screenReachabilityOfModels(model, screens, UNSELECTED).gaps).toEqual([]);
  });

  it('loadedGates は読込済み。gatesBlocked は阻害だけを true にする(未選択は関門が無い事実)', () => {
    expect(loadedGates([])).toEqual({ state: 'loaded', value: [], findings: [] });
    expect(gatesBlocked(loadedGates([]))).toBe(false);
    expect(gatesBlocked(UNSELECTED)).toBe(false);
    expect(gatesBlocked(blockedInput<readonly AuthGateDecl[]>('missing'))).toBe(true);
  });

  it('生成物に書く言葉は「<欄>は auth が阻害のため確かめていない」の 1 つの形', () => {
    expect(gatesUnverifiedNote('到達')).toBe('到達は auth が阻害のため確かめていない');
    expect(gatesUnverifiedNote('可視性')).toBe('可視性は auth が阻害のため確かめていない');
  });
});
