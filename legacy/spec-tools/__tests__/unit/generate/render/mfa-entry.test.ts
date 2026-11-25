/**
 * **多要素認証の要求を書き込みの入口へ通す生成物**の規約網羅テスト(auth-spec-writing.md §mfa)。
 *
 * 固定するのは:
 *   - 要求を宣言した製品では、生成された Server Action(単発の操作・保存点)がセッションの状態を `resolveSessionMfa` で解決し、
 *     組み立ての根がそれを実行器へ渡す(執行は実行器。範囲は束の `mfa`)
 *   - 束(`runtime-bindings.ts`)に要求の範囲が載る(全員 / ロールの一覧。ロール ID は仕様の語のまま)
 *   - 期待表(`auth.ts`)に送り先のパスが載る
 *   - 生成テストの場面は、サインインした実行者を済ませたセッションで実行する
 *   - **外す宣言・認証フロー仕様を持たない製品では、どの生成物も 1 字も変わらない**
 */

import { describe, expect, it } from 'vitest';
import { operationAppGenerator } from '../../../../lib/generate/render/code-operation-app.js';
import { operationTestsGenerator } from '../../../../lib/generate/render/code-operation-tests.js';
import { runtimeBindingsGenerator } from '../../../../lib/generate/render/code-runtime-bindings.js';
import { authExpectationsGenerator } from '../../../../lib/generate/render/code-auth.js';
import { usecaseAppGenerator } from '../../../../lib/generate/render/code-usecase-app.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { AuthMfaDecl } from '../../../../lib/model/auth/mfa.js';
import { enforcedMfaScope } from '../../../../lib/model/auth/mfa.js';
import { actionMfaArg, actionMfaLines, authImportNames, compositionMfaParam, compositionRunLine, mfaEnforced, scenarioMfaLines } from '../../../../lib/generate/render/mfa-entry.js';
import { accessSpec, aggregate, entitySpec, event, field, machine, role, specModel, stubContext, writeRule } from '../../../helpers/model-builder-v8plus.js';
import { loc } from '../../../helpers/model-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { jobModel, outboxJob } from '../../../helpers/job-builder.js';
import { authModel } from '../../../helpers/auth-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT, TEST_PLATFORM } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../../helpers/usecase-rpc-fixture.js';

const AUTH_FILE = 'docs/specs/backend/auth.md';

/** 要求の宣言(範囲だけ差し替える)。 */
function requirement(scope: Extract<AuthMfaDecl, { kind: 'require' }>['scope']): AuthMfaDecl {
  return { kind: 'require', scope, to: 'screen-mfa', implementation: 'impl/gate.ts::requireMfa', summary: '求める', location: loc(AUTH_FILE, 'mfa') };
}

const EXEMPT: AuthMfaDecl = { kind: 'exempt', reason: '敷居を上げない', location: loc(AUTH_FILE, 'mfa') };
const ALL = requirement({ kind: 'all' });
const KEEPERS = requirement({ kind: 'roles', roles: ['keeper'] });

/** 遷移 1 本を持つ widget 集約(`keeper` はログインロールを含意する)。 */
const DOMAIN = specModel({
  roles: [role('anonymous'), role('member'), role('keeper', undefined, ['member'], undefined), role('system')],
  aggregates: [
    aggregate({
      name: 'widget',
      entity: entitySpec('widget', [field('state', { kind: 'state', machine: 'widget' }, { required: true }), field('amount', { kind: 'integer' })]),
      stateMachines: [
        {
          ...machine({ machine: 'widget', states: ['draft', 'sent'], initial: 'draft', events: [event({ id: 'send', from: ['draft'], to: 'sent', by: ['member'] })] }),
          effects: [{ on: 'send', do: ['notify'], location: { file: AUTH_FILE } }],
        },
      ],
      access: accessSpec('widget', { writes: [writeRule('system', ['amount'])] }),
    }),
  ],
});

/** 生成の文脈(`mfa` だけ差し替える。undefined は認証フロー仕様を持たない製品)。 */
function context(mfa: AuthMfaDecl | undefined): GenerateContext {
  const { guards } = stubContext();
  return {
    guards,
    roots: TEST_ROOTS,
    platform: TEST_PLATFORM,
    layout: TEST_LAYOUT,
    gates: NO_GATES,
    ...(mfa === undefined ? {} : { auth: authModel({ mfa }) }),
    screens: { available: true, screens: [screenSpec({ name: 'mfa', route: '/account/mfa', requiresAuth: true })], chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] },
    actions: { actions: [actionSpec({ handles: 'widget.send', input: ['widget.id'] })], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
    dataTables: dataTableModel([
      dataTable('widgets', {
        entity: 'widget',
        functions: [
          {
            name: 'apply_widget_transition',
            args: ['text', 'text', 'text', 'text', 'text', 'text'],
            params: ['p_widget_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id'],
            kind: 'rpc',
            shape: 'transition',
            alsoWrites: [],
          },
        ],
      }),
    ]),
    jobs: jobModel([outboxJob('notify', { kind: 'notification' })]),
  };
}

/** 生成物の本文(ファイル → 本文)。 */
function contents(sections: readonly { readonly file: string; readonly content: string }[]): ReadonlyMap<string, string> {
  return new Map(sections.map((section) => [section.file, section.content]));
}

/** Server Action(サーバーの関数の印で始まる)。置き場の綴りは配置が決めるので、パスを書き写さず中身で見分ける。 */
function actionOf(files: ReadonlyMap<string, string>): string {
  return [...files.values()].find((content) => content.startsWith("'use server';")) ?? '';
}

/** 組み立ての根(実行器を組む)。 */
function compositionOf(files: ReadonlyMap<string, string>): string {
  return [...files.values()].find((content) => !content.startsWith("'use server';") && content.includes('runPlanOperation(')) ?? '';
}

describe('単発の操作の Server Action と組み立ての根', () => {
  it('要求する製品では、セッションが多要素認証を済ませたかを解決して実行器へ渡す', () => {
    const files = contents(operationAppGenerator.generate(DOMAIN, context(ALL)));
    const action = actionOf(files);
    expect(action).toContain("import { recordActionRefusal, resolveActorId, resolveRequestId, resolveSessionMfa, resolveSessionProfile } from '@/composition/auth';");
    expect(action).toContain('  const actorMfa = await resolveSessionMfa().catch((cause: unknown) => {');
    expect(action).toContain('await createSendWidget()(actorId, actorClaims, parsed.data, actorMfa, intentKeyOf(intent)).catch(');
    const composition = compositionOf(files);
    expect(composition).toContain('  actorMfa: boolean,\n  idempotencyKey?: string,\n) => Promise<ActionResult<OperationResult>> {');
    expect(composition).toContain('  return (actorId, actorClaims, input, actorMfa, idempotencyKey) => run(deps, { actorId, actorClaims, actorMfa, input, idempotencyKey });');
    // 範囲がロールでも配線は同じ(どのロールに掛かるかは実行器が束から読む)。
    expect(contents(operationAppGenerator.generate(DOMAIN, context(KEEPERS)))).toEqual(files);
  });

  it('外す宣言・認証フロー仕様を持たない製品では 1 字も変わらない', () => {
    const exempt = contents(operationAppGenerator.generate(DOMAIN, context(EXEMPT)));
    expect(contents(operationAppGenerator.generate(DOMAIN, context(undefined)))).toEqual(exempt);
    const action = actionOf(exempt);
    expect(action).toContain("import { recordActionRefusal, resolveActorId, resolveRequestId, resolveSessionProfile } from '@/composition/auth';");
    expect(action).not.toContain('actorMfa');
    expect(compositionOf(exempt)).toContain('  return (actorId, actorClaims, input, idempotencyKey) => run(deps, { actorId, actorClaims, input, idempotencyKey });');
  });
});

describe('保存点の Server Action と組み立ての根', () => {
  /** container.create → item.create → item.submit の 1 保存点。 */
  function usecaseContext(mfa: AuthMfaDecl | undefined): GenerateContext {
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')], { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })],
    });
    return {
      ...context(mfa),
      actions: rpcActions(),
      dataTables: rpcDataTables(),
      usecases: { available: true, usecases: [usecase] },
    };
  }

  it('要求する製品では単発の操作と同じ配線になり、外す製品では変わらない', () => {
    const required = [...contents(usecaseAppGenerator.generate(rpcDomain(), usecaseContext(KEEPERS))).values()].join('\n');
    expect(required).toContain('  const actorMfa = await resolveSessionMfa().catch((cause: unknown) => {');
    expect(required).toContain('(actorId, actorClaims, parsed.data, actorMfa, intentKeyOf(intent)).catch(');
    expect(required).toContain('  return (actorId, actorClaims, input, actorMfa, idempotencyKey) => run(deps, { actorId, actorClaims, actorMfa, input, idempotencyKey });');
    const exempt = contents(usecaseAppGenerator.generate(rpcDomain(), usecaseContext(EXEMPT)));
    expect(contents(usecaseAppGenerator.generate(rpcDomain(), usecaseContext(undefined)))).toEqual(exempt);
    expect([...exempt.values()].join('\n')).not.toContain('actorMfa');
  });
});

describe('実行時の束と期待表', () => {
  /** 束の本文。 */
  function bindings(mfa: AuthMfaDecl | undefined): string {
    return runtimeBindingsGenerator.generate(DOMAIN, context(mfa))[0]?.content ?? '';
  }

  it('束に要求の範囲が載る(全員 / ロールの一覧)。出どころに認証フロー仕様が加わる', () => {
    expect(bindings(ALL)).toContain("  invariantOfMessage,\n  mfa: { scope: 'all' },\n});");
    expect(bindings(KEEPERS)).toContain("  mfa: { scope: 'roles', roles: ['keeper'] },\n});");
    expect(bindings(KEEPERS)).toContain(`  - ${AUTH_FILE}`);
  });

  it('外す宣言・認証フロー仕様を持たない製品の束には欄が無く、本文も変わらない', () => {
    expect(bindings(EXEMPT)).not.toContain('mfa');
    expect(bindings(undefined)).toBe(bindings(EXEMPT));
  });

  it('期待表に送り先のパス(画面仕様の route)が載る。外す宣言なら載らない', () => {
    const table = (mfa: AuthMfaDecl): string => authExpectationsGenerator.generate(DOMAIN, context(mfa))[0]?.content ?? '';
    expect(table(KEEPERS)).toContain("export const AUTH_MFA_PATH = '/account/mfa';");
    expect(table(EXEMPT)).not.toContain('AUTH_MFA_PATH');
  });
});

describe('生成テストの場面', () => {
  /** 生成テストの本文。 */
  function tests(mfa: AuthMfaDecl | undefined): string {
    return operationTestsGenerator.generate(DOMAIN, context(mfa))[0]?.content ?? '';
  }

  it('要求する製品では、サインインした実行者の場面を済ませたセッションで実行する(未ログインの場面には付けない)', () => {
    const content = tests(ALL);
    expect(content).toContain('      actorMfa: true,');
    const anonymousRuns = content.split('const result = await run(deps, {').filter((block) => block.includes('actorId: null,'));
    for (const block of anonymousRuns) expect(block.split('});')[0]).not.toContain('actorMfa');
  });

  it('外す宣言・認証フロー仕様を持たない製品の生成テストは変わらない', () => {
    expect(tests(EXEMPT)).not.toContain('actorMfa');
    expect(tests(undefined)).toBe(tests(EXEMPT));
  });
});

describe('行の部品(mfa-entry.ts)', () => {
  it('要求の範囲が無ければどの部品も空・既定の形を返す', () => {
    expect(enforcedMfaScope(undefined)).toBeNull();
    expect(enforcedMfaScope(EXEMPT)).toBeNull();
    expect(enforcedMfaScope(KEEPERS)).toEqual({ kind: 'roles', roles: ['keeper'] });
    expect(mfaEnforced(EXEMPT)).toBe(false);
    expect(mfaEnforced(ALL)).toBe(true);
    expect(authImportNames(null)).toBe('recordActionRefusal, resolveActorId, resolveRequestId, resolveSessionProfile');
    expect(authImportNames(enforcedMfaScope(ALL))).toBe('recordActionRefusal, resolveActorId, resolveRequestId, resolveSessionMfa, resolveSessionProfile');
    expect(actionMfaLines(null)).toEqual([]);
    expect(actionMfaArg(null)).toBe('');
    // 送信の意図の冪等キー(点検 20 回目 B20-1)は要求の有無によらず最後の任意の引数。
    expect(compositionMfaParam(null)).toEqual(['  idempotencyKey?: string,']);
    expect(compositionMfaParam(enforcedMfaScope(ALL))).toEqual(['  actorMfa: boolean,', '  idempotencyKey?: string,']);
    expect(compositionRunLine(null)).not.toContain('actorMfa');
    expect(scenarioMfaLines(true, null)).toEqual([]);
    expect(scenarioMfaLines(false, 'a1')).toEqual([]);
    expect(scenarioMfaLines(true, 'a1')).toEqual(['      actorMfa: true,']);
  });
});
