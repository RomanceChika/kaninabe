/**
 * H7(拒否の記録の接地)のユニットテスト。
 *
 * 規約網羅(logging.md §セキュリティの事象):
 *   - 認証の組み立ての根が `recordActionRefusal` / `resolveRequestId` を値として export していること(字面ではなく構文木)
 *   - `runner: manual` の操作の手書きの Server Action が、`recordActionRefusal`(認証の組み立ての根から import した束縛)を呼ぶこと
 *   - 実行者の解決(`resolveActorId`)が、入力のパース(`.safeParse(`)より先にあること
 *   - 見ないもの: Server Action のファイルが無い操作・実装の木が無い構成・action_spec を採っていない / 読めないとき
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { entryLogState, verifyRefusalLog } from '../../../../lib/auth/verifiers/h7-refusal-log.js';
import { exportedFunctions, parseModule } from '../../../../lib/semantics/guard-ast.js';
import { layoutModule, layoutPath } from '../../../../lib/model/product/layout.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

const OP = 'widget.settle';
const ACTION_FILE = layoutPath(TEST_LAYOUT, TEST_ROOTS.app, 'operation-entry', OP) ?? '';
const AUTH_FILE = layoutPath(TEST_LAYOUT, TEST_ROOTS.app, 'auth-composition') ?? '';
const AUTH_MODULE = layoutModule(TEST_LAYOUT, 'auth-composition') ?? '';
const COMPOSITION = layoutModule(TEST_LAYOUT, 'operation-composition', OP) ?? '';

/** 接続点を export した認証の組み立ての根。 */
const AUTH_OK = [
  'export async function resolveActorId(): Promise<string | null> { return null; }',
  'export async function resolveRequestId(): Promise<string | null> { return null; }',
  'export function recordActionRefusal(): void {}',
  '',
].join('\n');

/** 実装の木(認証の組み立ての根と、追加のファイル)。 */
function tree(auth: string, extra: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'h7-log-'));
  mkdirSync(path.join(root, TEST_ROOTS.app ?? ''), { recursive: true });
  mkdirSync(path.dirname(path.join(root, AUTH_FILE)), { recursive: true });
  writeFileSync(path.join(root, AUTH_FILE), auth);
  for (const [file, content] of Object.entries(extra)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

/** action_spec(手書きの操作 1 本と、生成に乗る操作 1 本)。 */
const ACTIONS: ActionSpecModel = {
  actions: [actionSpec({ handles: OP, runner: { reason: '専用の RPC を呼ぶため' } }), actionSpec({ handles: 'widget.send' })],
  unhandled: [],
  scans: [],
  unscanned: [],
  testTagBaseline: [],
};

/** 手書きの Server Action(本体の行だけ差し替える)。 */
function actionSource(body: readonly string[], imports: readonly string[] = [`import { recordActionRefusal, resolveActorId, resolveRequestId } from '${AUTH_MODULE}';`]): string {
  return [
    "'use server';",
    ...imports,
    `import { createSettleWidget } from '${COMPOSITION}';`,
    '',
    'export async function settleWidgetAction(input: unknown) {',
    ...body.map((line) => `  ${line}`),
    '}',
    '',
  ].join('\n');
}

const GOOD_BODY = [
  'const actorId = await resolveActorId();',
  "const entry = { operation: 'settleWidget', actorId, requestId: await resolveRequestId() };",
  'const parsed = schema.safeParse(input);',
  'if (!parsed.success) { recordActionRefusal(entry, rejected); return rejected; }',
  'const result = await createSettleWidget()(actorId, parsed.data);',
  'recordActionRefusal(entry, result);',
  'return result;',
];

/** 検査を回す。 */
function run(repoRoot: string, actions = loadedInput(ACTIONS)): ReturnType<typeof verifyRefusalLog> {
  return verifyRefusalLog({ actions, repoRoot, roots: TEST_ROOTS, layout: TEST_LAYOUT });
}

describe('H7: 認証の組み立ての根の接続点', () => {
  it('2 つの接続点を値として export していれば何も言わない', () => {
    expect(run(tree(AUTH_OK))).toEqual([]);
  });

  const MISSING: readonly { readonly name: string; readonly auth: string; readonly missing: string }[] = [
    { name: 'recordActionRefusal が無い', auth: AUTH_OK.replace('export function recordActionRefusal(): void {}', ''), missing: 'recordActionRefusal' },
    { name: 'resolveRequestId が無い', auth: AUTH_OK.replace('export async function resolveRequestId(): Promise<string | null> { return null; }', ''), missing: 'resolveRequestId' },
    { name: 'export していない内部関数だけ', auth: 'function recordActionRefusal(): void {}\nfunction resolveRequestId() { return null; }\n', missing: 'recordActionRefusal,resolveRequestId' },
    { name: 'コメントに名前があるだけ', auth: '// recordActionRefusal と resolveRequestId を export する\n', missing: 'recordActionRefusal,resolveRequestId' },
  ];
  for (const { name, auth, missing } of MISSING) {
    it(`${name}なら赤`, () => {
      const findings = run(tree(auth));
      expect(findings).toEqual([expect.objectContaining({ verifier: 'H7', severity: 'error', grounding: 'implementation', counterexample: { file: AUTH_FILE, missing } })]);
    });
  }

  it('実装の木が無い構成・認証の組み立ての根のファイルが無いときは何も言わない', () => {
    expect(run(mkdtempSync(path.join(tmpdir(), 'h7-empty-')))).toEqual([]);
    const noAuth = mkdtempSync(path.join(tmpdir(), 'h7-noauth-'));
    mkdirSync(path.join(noAuth, TEST_ROOTS.app ?? ''), { recursive: true });
    expect(run(noAuth)).toEqual([]);
  });
});

describe('H7: runner: manual の操作の手書きの Server Action', () => {
  it('実行者を先に解き、拒否を記録していれば緑', () => {
    expect(run(tree(AUTH_OK, { [ACTION_FILE]: actionSource(GOOD_BODY) }))).toEqual([]);
  });

  it('パースが無い入口は、記録を呼んでいれば緑', () => {
    const body = ['const actorId = await resolveActorId();', 'const result = await createSettleWidget()(actorId, input);', "recordActionRefusal({ operation: 'settleWidget', actorId, requestId: null }, result);", 'return result;'];
    expect(run(tree(AUTH_OK, { [ACTION_FILE]: actionSource(body) }))).toEqual([]);
  });

  it('別名の import でも本物として数える', () => {
    const body = ['const actorId = await who();', 'const parsed = schema.safeParse(input);', 'record({ actorId }, parsed);', 'return parsed;'];
    const imports = [`import { resolveActorId as who, recordActionRefusal as record } from '${AUTH_MODULE}';`];
    expect(run(tree(AUTH_OK, { [ACTION_FILE]: actionSource(body, imports) }))).toEqual([]);
  });

  const BAD: readonly { readonly name: string; readonly source: string; readonly state: string }[] = [
    { name: '記録を呼ばない', source: actionSource(['const actorId = await resolveActorId();', 'return createSettleWidget()(actorId, input);']), state: 'unlogged' },
    { name: '記録をコメントに書いただけ', source: actionSource(['// recordActionRefusal を呼ぶ', 'const actorId = await resolveActorId();', 'return createSettleWidget()(actorId, input);']), state: 'unlogged' },
    {
      name: '別のモジュールの recordActionRefusal を呼ぶ',
      source: actionSource(['const actorId = await resolveActorId();', 'recordActionRefusal({}, {});', 'return createSettleWidget()(actorId, input);'], [`import { resolveActorId } from '${AUTH_MODULE}';`, "import { recordActionRefusal } from './elsewhere';"]),
      state: 'unlogged',
    },
    {
      name: '入力のパースが実行者の解決より先',
      source: actionSource(['const parsed = schema.safeParse(input);', 'const actorId = await resolveActorId();', 'recordActionRefusal({ operation: "x", actorId, requestId: null }, rejected);', 'return createSettleWidget()(actorId, parsed.data);']),
      state: 'parse_before_actor',
    },
    {
      name: '実行者を解決していないままパースする',
      source: actionSource(['const parsed = schema.safeParse(input);', 'recordActionRefusal({ operation: "x", actorId: null, requestId: null }, rejected);', 'return createSettleWidget()(null, parsed.data);']),
      state: 'parse_before_actor',
    },
    {
      name: '別のモジュールの resolveActorId を先に呼んだことにする',
      source: actionSource(
        ['const actorId = await resolveActorId();', 'const parsed = schema.safeParse(input);', 'recordActionRefusal({ operation: "x", actorId, requestId: null }, rejected);', 'return createSettleWidget()(actorId, parsed.data);'],
        [`import { recordActionRefusal } from '${AUTH_MODULE}';`, "import { resolveActorId } from './elsewhere';"],
      ),
      state: 'parse_before_actor',
    },
    {
      name: '局所の偽の resolveActorId / recordActionRefusal(外部レビュー の反例)',
      source: actionSource(
        ['const resolveActorId = async () => null;', 'const recordActionRefusal = (..._args: unknown[]) => {};', 'const actorId = await resolveActorId();', 'const parsed = schema.safeParse(input);', 'recordActionRefusal({ actorId }, parsed);', 'return parsed;'],
        [`import { recordActionRefusal, resolveActorId } from '${AUTH_MODULE}';`],
      ),
      state: 'unlogged',
    },
    {
      name: '引数が本物の recordActionRefusal を隠す',
      source: [
        "'use server';",
        `import { recordActionRefusal } from '${AUTH_MODULE}';`,
        'export async function settleWidgetAction(input: unknown, recordActionRefusal: (...a: unknown[]) => void) {',
        '  recordActionRefusal({}, input);',
        '}',
        '',
      ].join('\n'),
      state: 'unlogged',
    },
    {
      name: '入れ子ブロックの var が本物の recordActionRefusal を隠す(関数スコープ)',
      source: [
        "'use server';",
        `import { recordActionRefusal } from '${AUTH_MODULE}';`,
        'export async function settleWidgetAction(input: unknown) {',
        '  if (input) { var recordActionRefusal = (..._a: unknown[]) => {}; }',
        '  recordActionRefusal({}, input);',
        '}',
        '',
      ].join('\n'),
      state: 'unlogged',
    },
    {
      name: '本物の呼び出しが呼ばれない入れ子の関数の中だけ(記録)',
      source: actionSource(['const later = () => { recordActionRefusal({}, {}); };', 'void later;', 'return createSettleWidget()(null, input);']),
      state: 'unlogged',
    },
    {
      name: '本物の実行者の解決が呼ばれない入れ子の関数の中だけ(パースが先扱い)',
      source: actionSource(['const later = async () => { await resolveActorId(); };', 'void later;', 'const parsed = schema.safeParse(input);', 'recordActionRefusal({}, parsed);', 'return parsed;']),
      state: 'parse_before_actor',
    },
  ];
  for (const { name, source, state } of BAD) {
    it(`${name}なら赤(${state})`, () => {
      const findings = run(tree(AUTH_OK, { [ACTION_FILE]: source }));
      expect(findings).toEqual([
        expect.objectContaining({ verifier: 'H7', severity: 'error', grounding: 'implementation', counterexample: { operation: OP, file: ACTION_FILE, export: 'settleWidgetAction', state } }),
      ]);
      expect(findings[0]?.message).toContain(`runner: manual の操作 ${OP} の手書きの Server Action`);
    });
  }

  it('Server Action のファイルが無い操作・action_spec を採っていない・読めない(阻害)ときは見ない', () => {
    expect(run(tree(AUTH_OK))).toEqual([]);
    const unlogged = tree(AUTH_OK, { [ACTION_FILE]: actionSource(['return createSettleWidget()(null, input);']) });
    expect(run(unlogged, UNSELECTED)).toEqual([]);
    expect(run(unlogged, blockedInput('missing'))).toEqual([]);
  });

  it('生成に乗る操作(runner が無い)の入口は見ない(生成器が記録を書く)', () => {
    const file = layoutPath(TEST_LAYOUT, TEST_ROOTS.app, 'operation-entry', 'widget.send') ?? '';
    expect(run(tree(AUTH_OK, { [file]: actionSource(['return null;']) }))).toEqual([]);
  });
});

describe('entryLogState(関数 1 つの判定)', () => {
  it('名前空間の import(ns.recordActionRefusal)は数えない(関門と同じ: 名前つきの import だけ)', () => {
    const source = parseModule('x.ts', [`import * as auth from '${AUTH_MODULE}';`, 'export async function f(input: unknown) { await auth.resolveActorId(); auth.recordActionRefusal({}, {}); }'].join('\n'));
    const [, fn] = exportedFunctions(source)[0] ?? ['', undefined];
    expect(fn).toBeDefined();
    if (fn !== undefined) expect(entryLogState(fn, AUTH_MODULE)).toBe('unlogged');
  });
});
