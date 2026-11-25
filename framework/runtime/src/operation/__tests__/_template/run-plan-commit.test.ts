/**
 * 実行計画の実行器が **DB への口の結果をどう扱うか**のテスト（結果の契約 `CommitOutcome`）。
 *
 * 確かめるのは、外から見た振る舞いが契約を入れる前と同じであること —— 業務の拒否は `ActionError` の
 * 分類へ写り（`ActionError` の種類は増えない）、通信の失敗・想定外の失敗は `ActionResult` に**現れず**
 * `DbInfrastructureError` として投げられ、コミットの状態が欄に残ること。単発（定型 RPC）と
 * 保存点（複合 RPC）のどちらの入口も同じ分類で、1 回の保存でポートの呼び出しは 1 回である。
 *
 * 計画はテスト内にリテラル構築する（製品の生成物に依存しない）。
 */

import { describe, expect, it } from 'vitest';
import type { CreateTable } from '@kaninabe/runtime/engine';
import type { RunPlan, RunStepPlan } from '@kaninabe/runtime/plan';
import type { Clock, CommitOutcome, RpcCaller, RpcReturn, UsecaseCallArgs, UsecaseFactReader, UsecaseRepository } from '@kaninabe/runtime/ports';
import { DbInfrastructureError, receiptOf } from '@kaninabe/runtime/ports';
import type { RuntimeBindings } from '../../../domain/bindings';
import type { RunPlanDeps } from '../../_template/run-plan';
import { runPlanOperation } from '../../_template/run-plan';
import { ProgrammingError } from '../../_template/wire';

const ACTOR = '11111111-1111-4111-8111-111111111111';

/** 既定のログインロールの根拠（セッションのプロフィール）。 */
const SIGNED_IN = { display_name: 'テスト実行者' } as const;

/** 製品の宣言の束の代わり（ロール ID は仮の語。軸だけを使う）。 */
const BINDINGS: RuntimeBindings = {
  roleTables: { anonymous: 'anonymous', authenticated: 'member', system: 'system', implications: {} },
  invariantOfMessage: () => undefined,
};

/** 誰でもログインしていれば作れる規則。 */
const OPEN_RULES: CreateTable = { entity: 'widget', rules: [{ by: 'member' }] };

/** 作成の手順 1 つ（規則は条件なし）。 */
const STEP: RunStepPlan = {
  op: 'widget.create',
  alias: 'widget.create',
  label: 'ウィジェット',
  kind: 'create',
  aggregate: 'widget',
  repeat: false,
  self: false,
  event: null,
  createRules: OPEN_RULES,
  deleteRules: null,
  writeRules: null,
  machine: null,
  stateFrom: null,
  guardFacts: [],
  roleFacts: [],
  claimFacts: [],
  unresolvableRoles: [],
  inputKeys: ['title'],
};

/** 計画（`call` で保存点か単発かだけが変わる）。 */
function plan(call: RunPlan['call']): RunPlan {
  return {
    usecase: 'widget',
    save: 'create',
    rpc: 'create_widget',
    call,
    reads: [],
    expectedKeys: [],
    steps: [STEP],
    invariantHooks: [],
    result: { entity: 'widget', idFrom: { kind: 'idempotency' }, state: null },
  };
}

/** 保存点（複合 RPC）の計画。 */
const COMPOSITE = plan({ kind: 'composite' });

/** 単発（定型 RPC）の計画。`p_effects` に効果を載せる。 */
const NAMED = plan({
  kind: 'named',
  params: [
    { name: 'p_id', source: { kind: 'idempotency_key' } },
    { name: 'p_effects', source: { kind: 'effects', effects: ['widget.created'] } },
  ],
});

/** ポートの呼び出しの記録つきの依存（両方のポートが同じ結果を返す）。 */
function deps(outcome: CommitOutcome<RpcReturn>): { readonly deps: RunPlanDeps; readonly calls: string[] } {
  const calls: string[] = [];
  const facts: UsecaseFactReader = { readFields: () => Promise.resolve(null) };
  const usecases: UsecaseRepository = {
    call: (rpc) => {
      calls.push(`usecases:${rpc}`);
      return Promise.resolve(outcome);
    },
  };
  const rpc: RpcCaller = {
    call: (name) => {
      calls.push(`rpc:${name}`);
      return Promise.resolve(outcome);
    },
  };
  const clock: Clock = { now: () => new Date('2026-04-01T00:00:00.000Z') };
  return { deps: { facts, usecases, rpc, clock, bindings: BINDINGS }, calls };
}

/** 実行する（実行者は既定のログインロールを持つ）。 */
async function run(target: RunPlan, outcome: CommitOutcome<RpcReturn>): Promise<{ readonly result: unknown; readonly calls: string[] }> {
  const wired = deps(outcome);
  const result = await runPlanOperation(target, {})(wired.deps, {
    actorId: ACTOR,
    actorClaims: SIGNED_IN,
    input: { 'widget.create': { title: 'あ' } },
  });
  return { result, calls: wired.calls };
}

/** 投げられたエラーを返す（投げなかったら失敗）。 */
async function thrownBy(target: RunPlan, outcome: CommitOutcome<RpcReturn>): Promise<{ readonly error: DbInfrastructureError; readonly calls: string[] }> {
  const wired = deps(outcome);
  try {
    await runPlanOperation(target, {})(wired.deps, {
      actorId: ACTOR,
      actorClaims: SIGNED_IN,
      input: { 'widget.create': { title: 'あ' } },
    });
  } catch (error) {
    if (error instanceof DbInfrastructureError) return { error, calls: wired.calls };
    throw error;
  }
  throw new Error('投げられなかった');
}

describe('通信の失敗・想定外の失敗（ActionResult に現れず、コミットの状態を残して投げる）', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-RUNPLAN-005
  it('単発も保存点も、通信の失敗は DbInfrastructureError で投げ、コミットの状態が欄に残る（ポートは 1 回だけ呼ぶ）', async () => {
    const unknown = await thrownBy(NAMED, { kind: 'transport_failed', commit: 'unknown' });
    expect(unknown.error).toMatchObject({ kind: 'transport_failed', commit: 'unknown', sqlstate: null });
    expect(unknown.calls).toEqual(['rpc:create_widget']);

    const notCommitted = await thrownBy(COMPOSITE, { kind: 'transport_failed', commit: 'not_committed' });
    expect(notCommitted.error).toMatchObject({ kind: 'transport_failed', commit: 'not_committed' });
    expect(notCommitted.calls).toEqual(['usecases:create_widget']);
  });

  it('想定外の失敗もコミットの状態（unknown）と SQLSTATE を残して投げる。DB の文言は cause にだけ入る', async () => {
    const cause = { code: '42501', message: 'permission denied for table widgets' };
    const single = await thrownBy(NAMED, { kind: 'unknown_failure', commit: 'unknown', sqlstate: '42501', cause });
    const composite = await thrownBy(COMPOSITE, { kind: 'unknown_failure', commit: 'unknown', sqlstate: null });

    expect(single.error).toMatchObject({ kind: 'unknown_failure', commit: 'unknown', sqlstate: '42501' });
    expect(single.error.cause).toBe(cause);
    expect(single.error.message).not.toContain('permission denied');
    expect(composite.error).toMatchObject({ kind: 'unknown_failure', commit: 'unknown', sqlstate: null });
    expect(single.calls).toEqual(['rpc:create_widget']);
    expect(composite.calls).toEqual(['usecases:create_widget']);
  });
});

describe('業務の結果（契約を入れる前と同じ分類）', () => {
  it('書けた結果は { id, state } だけを返し、受領（requestedEffects / outbox）は呼び出し側の戻り値に現れない', async () => {
    const saved: CommitOutcome<RpcReturn> = {
      kind: 'saved',
      receipt: receiptOf({ shape: 'rows', rows: [{}] }, ['widget.created']),
    };
    const single = await run(NAMED, saved);
    const composite = await run(COMPOSITE, saved);

    expect(single.result).toEqual({ ok: true, value: { id: expect.stringMatching(/^[0-9a-f-]{36}$/u) as string, state: null } });
    expect(composite.result).toEqual({ ok: true, value: { id: expect.stringMatching(/^[0-9a-f-]{36}$/u) as string, state: null } });
    expect([single.calls, composite.calls]).toEqual([['rpc:create_widget'], ['usecases:create_widget']]);
  });

  it('DB の拒否は 3 分類（forbidden / guard_unsatisfied / invariant_violated）へ写る。競合は状態の不一致として写る', async () => {
    const forbidden = await run(NAMED, { kind: 'forbidden', op: 'widget.create' });
    const guard = await run(NAMED, { kind: 'guard_unsatisfied', op: '' });
    const conflict = await run(COMPOSITE, { kind: 'conflict', op: 'widget.send' });
    const invariant = await run(NAMED, { kind: 'invariant_violated', invariant: 'INV-WIDGET-001' });

    expect(forbidden.result).toEqual({ ok: false, error: { kind: 'forbidden', event: 'widget.create', role: 'member' } });
    expect(guard.result).toMatchObject({
      ok: false,
      error: { kind: 'guard_unsatisfied', event: 'widget.create', blockedBy: 'guard' },
    });
    expect(conflict.result).toMatchObject({
      ok: false,
      error: { kind: 'guard_unsatisfied', event: 'widget.send', blockedBy: 'state' },
    });
    expect(invariant.result).toEqual({ ok: false, error: { kind: 'invariant_violated', invariant: 'INV-WIDGET-001' } });
    // 相手の端が断ったときの端と件数は、そのまま画面へ運ぶ(行の中身や id は含まない)。
    const edged = await run(NAMED, { kind: 'invariant_violated', invariant: 'INV-WIDGET-001', edge: { trigger: 'check_widget_on_box', count: 2 } });
    expect(edged.result).toEqual({ ok: false, error: { kind: 'invariant_violated', invariant: 'INV-WIDGET-001', edge: { trigger: 'check_widget_on_box', count: 2 } } });
  });

  it('DB が拒否の語を載せたガードの拒否は、語を reason に運ぶ(画面が閉じた表の文言を出す。点検 19 回目 A19-4 の付記)。語が無ければ従来の診断の文字列', async () => {
    const worded = await run(NAMED, { kind: 'guard_unsatisfied', op: 'widget.create', word: 'link_target_erased' });
    const plain = await run(NAMED, { kind: 'guard_unsatisfied', op: 'widget.create' });

    expect(worded.result).toEqual({ ok: false, error: { kind: 'guard_unsatisfied', event: 'widget.create', blockedBy: 'guard', reason: 'link_target_erased' } });
    expect(plain.result).toEqual({ ok: false, error: { kind: 'guard_unsatisfied', event: 'widget.create', blockedBy: 'guard', reason: 'guard: not satisfied at write time' } });
  });

  it('競合が同じ鍵の押し直しの語(resend_already_saved)を載せたら reason に運ぶ。語の無い本当の競合は従来の診断の文字列', async () => {
    const again = await run(NAMED, { kind: 'conflict', op: 'widget.create', word: 'resend_already_saved' });
    const genuine = await run(NAMED, { kind: 'conflict', op: 'widget.create' });

    expect(again.result).toEqual({ ok: false, error: { kind: 'guard_unsatisfied', event: 'widget.create', blockedBy: 'state', reason: 'resend_already_saved' } });
    expect(genuine.result).toEqual({ ok: false, error: { kind: 'guard_unsatisfied', event: 'widget.create', blockedBy: 'state', reason: 'conflict: state changed after the decision' } });
  });
});

describe('保存点（複合 RPC）の入力は入口の正規化を通って運ばれる', () => {
  /** 保存点の口が受け取った引数を記録する依存。 */
  function recordingDeps(): { readonly deps: RunPlanDeps; readonly received: UsecaseCallArgs[] } {
    const wired = deps({ kind: 'saved', receipt: receiptOf({ shape: 'document', document: {} }, null) });
    const received: UsecaseCallArgs[] = [];
    const usecases: UsecaseRepository = {
      call: (_rpc, args) => {
        received.push(args);
        return Promise.resolve({ kind: 'saved', receipt: receiptOf({ shape: 'document', document: {} }, null) });
      },
    };
    return { deps: { ...wired.deps, usecases }, received };
  }

  // @spec framework-guarantee-catalog @tc TC-FW-RUNPLAN-006
  it('正当な値では、運ぶ JSON が正規化を入れる前と同じ（Date は ISO 8601・欄の undefined は鍵ごと運ばない）', async () => {
    const { deps: wired, received } = recordingDeps();
    const input = { 'widget.create': { title: 'あ', note: undefined, count: 0, flag: false, tags: ['a', null], at: new Date(0) } };

    await runPlanOperation(COMPOSITE, {})(wired, { actorId: ACTOR, actorClaims: SIGNED_IN, input });

    expect(received).toHaveLength(1);
    expect(JSON.stringify(received[0]?.input)).toBe(JSON.stringify(input));
    expect(received[0]?.input).toEqual({
      'widget.create': { title: 'あ', count: 0, flag: false, tags: ['a', null], at: '1970-01-01T00:00:00.000Z' },
    });
    expect(received[0]?.expected).toEqual({});
  });

  it('運べない値（NaN・配列の中の undefined）は ProgrammingError で止め、保存点の口は呼ばない', async () => {
    for (const bad of [{ title: Number.NaN }, { title: [1, undefined] }]) {
      const { deps: wired, received } = recordingDeps();
      const run = runPlanOperation(COMPOSITE, {})(wired, { actorId: ACTOR, actorClaims: SIGNED_IN, input: { 'widget.create': bad } });

      await expect(run).rejects.toBeInstanceOf(ProgrammingError);
      expect(received).toHaveLength(0);
    }
  });
});
