/**
 * **生成された Server Action が拒否を記録する行**の規約網羅テスト(logging.md §セキュリティの事象 / ASVS V16.3.2・V16.3.3)。
 *
 * 固定するのは:
 *   - 単発の操作・保存点のどちらの入口も、**実行者の解決がパースより先**にある(拒否された入力の記録に「誰が」を載せるため)
 *   - パースの失敗は `recordActionRefusal` で記録して**返す値は変えない**(`invalid_input`)
 *   - 実行器の結果は記録してから**そのまま**返す(記録が結果を変えない)
 *   - 記録の接続点(`recordActionRefusal` / `resolveRequestId`)は認証の組み立ての根から import する
 *   - 要求の有無(多要素認証)・配置が変わっても同じ形である
 *   - 行の部品(`refusal-log-entry.ts`)の出力の字面
 */

import { describe, expect, it } from 'vitest';
import { operationAppGenerator } from '../../../../lib/generate/render/code-operation-app.js';
import { usecaseAppGenerator } from '../../../../lib/generate/render/code-usecase-app.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { AuthMfaDecl } from '../../../../lib/model/auth/mfa.js';
import { actionHeadLines, guardedLines, parseFailureLines, resultLines } from '../../../../lib/generate/render/refusal-log-entry.js';
import { operationNameOf } from '../../../../lib/generate/render/operation-app-names.js';
import { REFUSAL_LOG_EXPORTS } from '../../../../lib/model/auth/refusal-log.js';
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

const OPERATION_ACTION = (): string => actionOf(contents(operationAppGenerator.generate(DOMAIN, context(undefined))));

/** 保存点の文脈。 */
function usecaseContext(mfa: AuthMfaDecl | undefined): GenerateContext {
  const usecase = usecaseSpec({
    name: 'demo',
    saves: [usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')], { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' })],
  });
  return { ...context(mfa), actions: rpcActions(), dataTables: rpcDataTables(), usecases: { available: true, usecases: [usecase] } };
}

const USECASE_ACTION = (mfa?: AuthMfaDecl): string => actionOf(contents(usecaseAppGenerator.generate(rpcDomain(), usecaseContext(mfa))));

/** 入口の本文のなかで、文字列の出る位置(無ければ例外 — 位置の比較が黙って通らないように)。 */
function at(text: string, needle: string): number {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`${needle} が本文にありません`);
  return index;
}

const ENTRIES: readonly { readonly name: string; readonly action: () => string }[] = [
  { name: '単発の操作', action: OPERATION_ACTION },
  { name: '単発の操作(多要素認証を要求する製品)', action: () => actionOf(contents(operationAppGenerator.generate(DOMAIN, context(ALL)))) },
  { name: '保存点', action: () => USECASE_ACTION() },
  { name: '保存点(多要素認証を要求する製品)', action: () => USECASE_ACTION(KEEPERS) },
];

describe('生成された Server Action の拒否の記録', () => {
  for (const { name, action } of ENTRIES) {
    describe(name, () => {
      it('実行者と要求の識別子の解決が、入力のパースより先にある(logging.md「実行者はパースより先に解決する」)', () => {
        const text = action();
        expect(at(text, 'await resolveActorId()')).toBeLessThan(at(text, '.safeParse('));
        expect(at(text, 'await resolveRequestId()')).toBeLessThan(at(text, '.safeParse('));
      });

      it('パースの失敗は invalid_input として記録してから、その値をそのまま返す', () => {
        const text = action();
        expect(text).toContain("const rejected: ActionResult<never> = err({ kind: 'invalid_input', issues: toFieldIssues(parsed.error) });");
        expect(at(text, 'recordActionRefusal(entry, rejected);')).toBeLessThan(at(text, 'return rejected;'));
        // 失敗の分岐の中で記録が呼ばれている(分岐の外ではない)。
        expect(at(text, 'if (!parsed.success) {')).toBeLessThan(at(text, 'recordActionRefusal(entry, rejected);'));
      });

      it('実行器の結果は記録してから、そのまま返す(記録は結果を変えない)', () => {
        const text = action();
        expect(text).toMatch(/const result = await create\w+\(\)\(actorId, actorClaims, parsed\.data(, actorMfa)?, intentKeyOf\(intent\)\)\.catch\(\(cause: unknown\) => \{/);
        expect(at(text, 'recordActionRefusal(entry, result);')).toBeLessThan(at(text, 'return result;'));
        expect(text).not.toMatch(/return create\w+\(\)/);
      });

      it('DB の失敗は書けたかどうかつきの値で返し(下で 1 行記録される)、意図の冪等キーを形を確かめて渡す(点検 20 回目 B20-1)', () => {
        const whole = action();
        // 実行器の呼び出しの包み(先頭の解決の包みより後ろ)だけを見る。
        const text = whole.slice(at(whole, '  const result = await '));
        expect(whole).toContain("import { intentKeyOf, temporaryFailureOf } from '@kaninabe/runtime/intent';");
        expect(whole).toMatch(/export async function \w+\(input: unknown, intent\?: unknown\): Promise<ActionResult</);
        expect(whole).toContain('@param intent 送信の意図');
        const valued = at(text, '    if (failed !== null) return err(failed);');
        expect(at(text, '    const failed = temporaryFailureOf(cause);')).toBeLessThan(valued);
        // 値で返す分岐は、記録して投げ直す行より前(DB の失敗は投げ直さない)。
        expect(valued).toBeLessThan(at(text, '    throw cause;'));
        expect(valued).toBeGreaterThan(at(text, '.catch((cause: unknown) => {'));
      });

      it('実行器が例外で終わったら、一時的な失敗として 1 行記録してから投げ直す(点検 19 回目 O19-2。握りつぶさない)', () => {
        const whole = action();
        const text = whole.slice(at(whole, '  const result = await '));
        const recorded = at(text, "    recordActionRefusal(entry, err({ kind: 'temporarily_unavailable' }));");
        expect(recorded).toBeGreaterThan(at(text, '.catch((cause: unknown) => {'));
        expect(recorded).toBeLessThan(at(text, '    throw cause;'));
        expect(at(text, '    throw cause;')).toBeLessThan(at(text, 'recordActionRefusal(entry, result);'));
        // 例外の文言(cause)は記録に渡さない。
        expect(text).not.toMatch(/recordActionRefusal\([^)]*cause/);
      });

      it('実行者・プロフィールの解決が投げても、一時的な失敗として 1 行記録してから投げ直す(点検 20 回目 B20-3。実行者が解けていなければ空)', () => {
        const text = action();
        // 実行者の解決は記録の包みの中にあり、包みは実行者の空の文脈で記録する。
        const head = at(text, '  const actorId = await resolveActorId().catch((cause: unknown) => {');
        const unknownActor = at(text, "    recordActionRefusal({ operation: '");
        expect(head).toBeLessThan(unknownActor);
        expect(text.slice(unknownActor).split('\n')[0]).toMatch(/^    recordActionRefusal\(\{ operation: '\w+', actorId: null, requestId \}, err\(\{ kind: 'temporarily_unavailable' \}\)\);$/);
        expect(at(text, '  const requestId = await resolveRequestId();')).toBeLessThan(head);
        // セッションのプロフィールの解決も包む(実行者が解けた後なので entry で記録する)。
        expect(text).toContain("  const actorClaims = await resolveSessionProfile().catch((cause: unknown) => {\n    recordActionRefusal(entry, err({ kind: 'temporarily_unavailable' }));\n    throw cause;\n  });");
        // 包まれない解決の呼び出しは無い(認証の組み立ての根の解決は全部 .catch を持つ)。
        expect(text).not.toMatch(/await resolve(?:ActorId|SessionProfile|SessionMfa)\(\);/);
      });

      it('記録の接続点は認証の組み立ての根から import する(名前順。ほかの出どころは無い)', () => {
        const text = action();
        const imports = text.split('\n').filter((line) => line.includes("from '@/composition/auth'"));
        expect(imports).toHaveLength(1);
        for (const exported of REFUSAL_LOG_EXPORTS) expect(imports[0]).toContain(exported);
        expect(text).not.toContain('console.');
      });

      it('記録に渡すのは操作の関数名・実行者・要求の識別子だけである(入力値を渡さない)', () => {
        const text = action();
        const entry = text.split('\n').find((line) => line.startsWith('  const entry = ')) ?? '';
        expect(entry).toMatch(/^  const entry = \{ operation: '\w+', actorId, requestId \};$/);
        expect(entry).not.toContain('input');
        expect(entry).not.toContain('parsed');
      });
    });
  }

  it('操作の関数名は Server Action の export 名から Action を除いたもの(操作 ID の 2 語だけから決まる)', () => {
    expect(operationNameOf('widget.settle')).toBe('settleWidget');
    expect(operationNameOf('widget.send')).toBe('sendWidget');
    expect(OPERATION_ACTION()).toContain("operation: 'sendWidget'");
    expect(OPERATION_ACTION()).toContain('export async function sendWidgetAction(');
  });

  it('保存点の記録の操作名は保存点の名前(デモの保存点)である', () => {
    expect(USECASE_ACTION()).toMatch(/operation: 'demoRegister'/);
  });
});

describe('行の部品(refusal-log-entry.ts)', () => {
  it('先頭の行は、要求の識別子 → 実行者(投げたら実行者の空の行を記録して投げ直す)→ entry の順で、操作名を載せる', () => {
    expect(actionHeadLines('sendWidget')).toEqual([
      '  const requestId = await resolveRequestId();',
      '  const actorId = await resolveActorId().catch((cause: unknown) => {',
      "    recordActionRefusal({ operation: 'sendWidget', actorId: null, requestId }, err({ kind: 'temporarily_unavailable' }));",
      '    throw cause;',
      '  });',
      "  const entry = { operation: 'sendWidget', actorId, requestId };",
    ]);
  });

  it('包みの行(既定の文脈は entry)', () => {
    expect(guardedLines('actorClaims', 'resolveSessionProfile()')).toEqual([
      '  const actorClaims = await resolveSessionProfile().catch((cause: unknown) => {',
      "    recordActionRefusal(entry, err({ kind: 'temporarily_unavailable' }));",
      '    throw cause;',
      '  });',
    ]);
  });

  it('パースの失敗の行と、結果の行', () => {
    expect(parseFailureLines()).toEqual([
      '  if (!parsed.success) {',
      "    const rejected: ActionResult<never> = err({ kind: 'invalid_input', issues: toFieldIssues(parsed.error) });",
      '    recordActionRefusal(entry, rejected);',
      '    return rejected;',
      '  }',
    ]);
    expect(resultLines('createX()(a)')).toEqual([
      '  const result = await createX()(a).catch((cause: unknown) => {',
      '    const failed = temporaryFailureOf(cause);',
      '    if (failed !== null) return err(failed);',
      "    recordActionRefusal(entry, err({ kind: 'temporarily_unavailable' }));",
      '    throw cause;',
      '  });',
      '  recordActionRefusal(entry, result);',
      '  return result;',
    ]);
  });

  it('認証の組み立ての根が export すべき接続点は 2 つ(名前順)', () => {
    expect([...REFUSAL_LOG_EXPORTS]).toEqual(['recordActionRefusal', 'resolveRequestId']);
  });
});
