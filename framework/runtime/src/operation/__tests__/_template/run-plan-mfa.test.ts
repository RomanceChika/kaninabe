/**
 * 実行器が **多要素認証の要求を書き込みの入口で執行する**ことのテスト(auth-spec-writing.md §mfa)。
 *
 * 画面の関門は画面の入場しか守らないので、多要素認証を済ませていないセッションでも Server Action は直に呼べる。
 * 生成された Server Action はどれも実行器を通るので、ここで止まることを固定する —— 要求するロールの実行者は、
 * 済ませていなければ判断にも書き込みにも届かずに `forbidden`(印 `mfaRequired: true`)で返り、済ませていれば通る。
 * 要求の対象外のロール・内部実行・要求の無い製品は何も変わらない。
 *
 * 計画と束はテスト内にリテラル構築する(製品の生成物に依存しない)。ロール ID は仮の語である。
 */

import { describe, expect, it } from 'vitest';
import type { CreateTable } from '@kaninabe/runtime/engine';
import type { RunPlan, RunStepPlan } from '@kaninabe/runtime/plan';
import type { Clock, RpcCaller, UsecaseFactReader, UsecaseRepository } from '@kaninabe/runtime/ports';
import { receiptOf } from '@kaninabe/runtime/ports';
import type { MfaRequirement, RuntimeBindings } from '../../../domain/bindings';
import type { RunPlanCommand, RunPlanDeps } from '../../_template/run-plan';
import { runPlanOperation } from '../../_template/run-plan';
import { refuseUnverifiedMfa } from '../../_template/mfa-requirement';

const ACTOR = '11111111-1111-4111-8111-111111111111';

/** 既定のログインロール(`member`)の根拠と、`claim` のロール(`keeper`)の欄。 */
const MEMBER = { display_name: 'テスト実行者', is_keeper: false } as const;
const KEEPER = { display_name: 'テスト実行者', is_keeper: true } as const;

/** 製品の宣言の束の代わり(`keeper` は `member` を含意する)。 */
function bindings(mfa: MfaRequirement | undefined): RuntimeBindings {
  return {
    roleTables: { anonymous: 'anonymous', authenticated: 'member', system: 'system', implications: { keeper: ['member'] } },
    invariantOfMessage: () => undefined,
    ...(mfa === undefined ? {} : { mfa }),
  };
}

/** 作成の手順 1 つ(誰が作れるかは `rules` が決める。`keeper` は実行者自身の欄から立つ)。 */
function step(rules: CreateTable['rules']): RunStepPlan {
  return {
    op: 'widget.create',
    alias: 'widget.create',
    label: 'ウィジェット',
    kind: 'create',
    aggregate: 'widget',
    repeat: false,
    self: false,
    event: null,
    createRules: { entity: 'widget', rules },
    deleteRules: null,
    writeRules: null,
    machine: null,
    stateFrom: null,
    guardFacts: [],
    roleFacts: [],
    claimFacts: rules.some((rule) => rule.by === 'keeper') ? [{ role: 'keeper', field: 'is_keeper' }] : [],
    unresolvableRoles: [],
    inputKeys: ['title'],
  };
}

/** 計画(単発の定型 RPC)。 */
function plan(rules: CreateTable['rules']): RunPlan {
  return {
    usecase: 'widget',
    save: 'create',
    rpc: 'create_widget',
    call: { kind: 'named', params: [{ name: 'p_id', source: { kind: 'idempotency_key' } }] },
    reads: [],
    expectedKeys: [],
    steps: [step(rules)],
    invariantHooks: [],
    result: { entity: 'widget', idFrom: { kind: 'idempotency' }, state: null },
  };
}

/** 管理者だけが作れる操作 / 利用者だけが作れる操作 / どちらでも作れる操作 / 内部実行だけが作れる操作。 */
const KEEPER_ONLY = plan([{ by: 'keeper' }]);
const MEMBER_ONLY = plan([{ by: 'member' }]);
const EITHER = plan([{ by: 'member' }, { by: 'keeper' }]);
const SYSTEM_ONLY = plan([{ by: 'system' }]);
const ANYONE = plan([{ by: 'anonymous' }, { by: 'member' }]);

/** 事実の読み取りと RPC の呼び出しを記録する依存(RPC は常に書けた結果を返す)。 */
function deps(mfa: MfaRequirement | undefined): { readonly deps: RunPlanDeps; readonly calls: string[] } {
  const calls: string[] = [];
  const facts: UsecaseFactReader = {
    readFields: () => {
      calls.push('facts');
      return Promise.resolve(null);
    },
  };
  const usecases: UsecaseRepository = { call: () => Promise.reject(new Error('保存点は呼ばない')) };
  const rpc: RpcCaller = {
    call: (name) => {
      calls.push(`rpc:${name}`);
      return Promise.resolve({ kind: 'saved', receipt: receiptOf({ shape: 'rows', rows: [{}] }, null) });
    },
  };
  const clock: Clock = { now: () => new Date('2026-04-01T00:00:00.000Z') };
  return { deps: { facts, usecases, rpc, clock, bindings: bindings(mfa) }, calls };
}

/** 実行する(入力は固定。実行者・セッション・内部実行かは呼び手が渡す)。 */
async function run(
  target: RunPlan,
  mfa: MfaRequirement | undefined,
  command: Omit<RunPlanCommand<Readonly<Record<string, unknown>>>, 'input'>,
): Promise<{ readonly result: unknown; readonly calls: string[] }> {
  const wired = deps(mfa);
  const result = await runPlanOperation(target, {})(wired.deps, { ...command, input: { 'widget.create': { title: 'あ' } } });
  return { result, calls: wired.calls };
}

/** 範囲がロール(`keeper` だけに要求する)。 */
const KEEPERS: MfaRequirement = { scope: 'roles', roles: ['keeper'] };
/** 範囲が全員。 */
const EVERYONE: MfaRequirement = { scope: 'all' };

/** 多要素認証の要求に掛かった拒否の形。 */
const mfaForbidden = (role: string): unknown => ({
  ok: false,
  error: { kind: 'forbidden', event: 'widget.create', role, mfaRequired: true },
});

describe('多要素認証の要求(範囲がロール)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-MFA-001
  it('要求するロールの実行者は、多要素認証を済ませていなければ判断にも書き込みにも届かずに拒否される', async () => {
    const unverified = await run(KEEPER_ONLY, KEEPERS, { actorId: ACTOR, actorClaims: KEEPER, actorMfa: false });
    expect(unverified.result).toEqual(mfaForbidden('member'));
    expect(unverified.calls).toEqual([]);
    // 済ませたかどうかを渡さない呼び出しは、済ませていないとして扱う(安全側)。
    const omitted = await run(KEEPER_ONLY, KEEPERS, { actorId: ACTOR, actorClaims: KEEPER });
    expect(omitted.result).toEqual(mfaForbidden('member'));
    expect(omitted.calls).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-MFA-002
  it('多要素認証を済ませたセッションなら、要求するロールの実行者も書ける', async () => {
    const verified = await run(KEEPER_ONLY, KEEPERS, { actorId: ACTOR, actorClaims: KEEPER, actorMfa: true });
    expect(verified.result).toMatchObject({ ok: true });
    expect(verified.calls).toEqual(['rpc:create_widget']);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-MFA-003
  it('要求の対象外のロールの操作は、済ませていなくても通る(要求するロールを持つ人でも、その操作の判断に関わらなければ掛からない)', async () => {
    const member = await run(MEMBER_ONLY, KEEPERS, { actorId: ACTOR, actorClaims: MEMBER, actorMfa: false });
    expect(member.result).toMatchObject({ ok: true });
    const keeperAsMember = await run(MEMBER_ONLY, KEEPERS, { actorId: ACTOR, actorClaims: KEEPER, actorMfa: false });
    expect(keeperAsMember.result).toMatchObject({ ok: true });
    expect(keeperAsMember.calls).toEqual(['rpc:create_widget']);
  });

  it('要求するロールが判断に立つ操作は、ほかのロールでも許される操作でも止める(要求するロールの権限で書けてしまうため)', async () => {
    const keeper = await run(EITHER, KEEPERS, { actorId: ACTOR, actorClaims: KEEPER, actorMfa: false });
    expect(keeper.result).toEqual(mfaForbidden('member'));
    expect(keeper.calls).toEqual([]);
    // そのロールが立たない実行者(欄が偽)は掛からない。
    const member = await run(EITHER, KEEPERS, { actorId: ACTOR, actorClaims: MEMBER, actorMfa: false });
    expect(member.result).toMatchObject({ ok: true });
  });

  it('要求するロールが含意で立つ場合も掛かる(含意で閉じたロールで見る)', async () => {
    const memberRequired = await run(KEEPER_ONLY, { scope: 'roles', roles: ['member'] }, { actorId: ACTOR, actorClaims: KEEPER, actorMfa: false });
    expect(memberRequired.result).toEqual(mfaForbidden('member'));
  });
});

describe('多要素認証の要求(範囲が全員)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-MFA-004
  it('サインインした実行者は、済ませていなければ対象を読む前に拒否される(対象の有無を明かさない)', async () => {
    const unverified = await run(MEMBER_ONLY, EVERYONE, { actorId: ACTOR, actorClaims: MEMBER, actorMfa: false });
    expect(unverified.result).toEqual(mfaForbidden('member'));
    expect(unverified.calls).toEqual([]);
    const verified = await run(MEMBER_ONLY, EVERYONE, { actorId: ACTOR, actorClaims: MEMBER, actorMfa: true });
    expect(verified.result).toMatchObject({ ok: true });
  });

  it('未ログインの実行者には要求する要素が無いので掛からない(公開の操作は未ログインの規則が裁く)', async () => {
    const anonymous = await run(ANYONE, EVERYONE, { actorId: null, actorClaims: null });
    expect(anonymous.result).toMatchObject({ ok: true });
  });
});

describe('多要素認証の要求が及ばない入口と製品', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-MFA-005
  it('内部実行(system の入口)は要求の影響を受けない', async () => {
    for (const requirement of [EVERYONE, { scope: 'roles', roles: ['system'] } as const]) {
      const system = await run(SYSTEM_ONLY, requirement, { actorId: null, actorClaims: null, system: true });
      expect(system.result).toMatchObject({ ok: true });
      expect(system.calls).toEqual(['rpc:create_widget']);
    }
  });

  // @spec framework-guarantee-catalog @tc TC-FW-MFA-006
  it('要求を宣言しない製品(外す宣言・認証フロー仕様を持たない)では、済ませていなくても何も変わらない', async () => {
    const keeper = await run(KEEPER_ONLY, undefined, { actorId: ACTOR, actorClaims: KEEPER, actorMfa: false });
    expect(keeper.result).toMatchObject({ ok: true });
    const member = await run(MEMBER_ONLY, undefined, { actorId: ACTOR, actorClaims: MEMBER });
    expect(member.result).toMatchObject({ ok: true });
  });

  it('要求に掛からない拒否には印が付かない(権限の拒否そのものは従来どおり)', async () => {
    const denied = await run(KEEPER_ONLY, KEEPERS, { actorId: ACTOR, actorClaims: MEMBER, actorMfa: false });
    expect(denied.result).toEqual({ ok: false, error: { kind: 'forbidden', event: 'widget.create', role: 'member' } });
  });
});

describe('手書きの入口の口(refuseUnverifiedMfa。runner: manual の Server Action が判断と書き込みの前に呼ぶ)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-MFA-007
  it('実行器と同じ判定を、呼び手が解いたロールで引く(要求するロールが立ち済ませていなければ拒否・済ませれば通る・要求の無い製品では何もしない)', () => {
    const refused = refuseUnverifiedMfa(bindings(KEEPERS), { actorId: ACTOR, actorMfa: false }, ['member', 'keeper'], 'widget.create');
    expect(refused).toEqual({ kind: 'forbidden', event: 'widget.create', role: 'member', mfaRequired: true });
    expect(refuseUnverifiedMfa(bindings(KEEPERS), { actorId: ACTOR, actorMfa: true }, ['member', 'keeper'], 'widget.create')).toBeNull();
    expect(refuseUnverifiedMfa(bindings(KEEPERS), { actorId: ACTOR, actorMfa: false }, ['member'], 'widget.create')).toBeNull();
    expect(refuseUnverifiedMfa(bindings(EVERYONE), { actorId: ACTOR, actorMfa: false }, ['member'], 'widget.create')).toEqual(refused);
    expect(refuseUnverifiedMfa(bindings(EVERYONE), { actorId: null, actorMfa: false }, ['anonymous'], 'widget.create')).toBeNull();
    expect(refuseUnverifiedMfa(bindings(undefined), { actorId: ACTOR, actorMfa: false }, ['member', 'keeper'], 'widget.create')).toBeNull();
  });
});
