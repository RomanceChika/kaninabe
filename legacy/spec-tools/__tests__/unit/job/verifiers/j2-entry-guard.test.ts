/**
 * J2(続き)**出口の関所の配線**(`j2-entry-guard.ts` / `semantics/route-guard-shape.ts`。点検 10 回目 B10-1)のテスト。
 *
 * 表で見る —— 正例(関所で包んだ `const`・別名の import・名前空間の import・関数式・型の注記・`start` の口の外の行き先の表)/
 * 負例(関数の宣言・素の値・関所でない包み・同名の別モジュールの `guardRoute`・名前の付け替えの export・再輸出・`let`・本体を読めない包み・
 * 許していない口の外の行き先の表・閉じていない第 2 引数)/ 境界(メソッドでない export は見ない・型だけの再輸出は見ない)。
 * 加えて J2 本体で、認証の `start` の口だけが外の行き先の表を持てることと、指摘が直し方を名指すことを見る。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyEntryClosedWorld } from '../../../../lib/job/verifiers/j2-entry-closed.js';
import { routeGuardProblems } from '../../../../lib/semantics/route-guard-shape.js';
import { exportedFunctions, parseModule } from '../../../../lib/semantics/guard-ast.js';
import { authEntry, authModel } from '../../../helpers/auth-builder.js';
import { jobModel, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { putFrameConfig } from '../../../helpers/frame-config.js';
import { UNSELECTED } from '../../../helpers/verify-inputs.js';

/** 関所の import。 */
const G = "import { guardRoute } from '@kaninabe/runtime/http/route-guard';\n";

/** 外の行き先の表を返す関数の import。 */
const O = "import { signInRedirectOrigins } from '@/composition/session-endpoints';\n";

describe('routeGuardProblems(包みの形の閉じた表)', () => {
  it.each([
    ['矢印関数を包んだ const', `${G}export const GET = guardRoute(async (request: Request) => new Response());`],
    ['関数式を包んだ const', `${G}export const POST = guardRoute(async function post(request: Request) { return new Response(); });`],
    ['別名の import', "import { guardRoute as guard } from '@kaninabe/runtime/http/route-guard';\nexport const GET = guard(async () => new Response());"],
    ['名前空間の import', "import * as rg from '@kaninabe/runtime/http/route-guard';\nexport const GET = rg.guardRoute(async () => new Response());"],
    ['複数のメソッド', `${G}export const GET = guardRoute(async () => new Response());\nexport const HEAD = guardRoute(async () => new Response());`],
    ['メソッドでない export は見ない', `${G}export const dynamic = 'force-dynamic';\nexport function helper() {}\nexport const GET = guardRoute(async () => new Response());`],
    ['型だけの再輸出は見ない', `${G}export type { GET } from './types';\nexport const POST = guardRoute(async () => new Response());`],
  ])('包まれている: %s', (_name, source) => {
    expect(routeGuardProblems('route.ts', source, false)).toEqual([]);
  });

  it.each([
    ['関数の宣言(これまでの形)', 'export async function GET() { return new Response(); }', 'unguarded'],
    ['素の矢印関数', 'export const GET = async () => new Response();', 'unguarded'],
    ['識別子', 'const handler = async () => new Response();\nexport const GET = handler;', 'unguarded'],
    ['関所でない包み', "import { wrap } from './wrap';\nexport const GET = wrap(async () => new Response());", 'unguarded'],
    ['同名の別モジュールの guardRoute', "import { guardRoute } from './my-guard';\nexport const GET = guardRoute(async () => new Response());", 'unguarded'],
    ['局所の guardRoute', 'const guardRoute = (f: unknown) => f;\nexport const GET = guardRoute(async () => new Response());', 'unguarded'],
    ['名前の付け替えの export', `${G}const handler = guardRoute(async () => new Response());\nexport { handler as GET };`, 'unguarded'],
    ['再輸出', "export { GET } from './impl';", 'unguarded'],
    ['let(後から差し替えられる)', `${G}export let GET = guardRoute(async () => new Response());`, 'unguarded'],
    ['クラス', 'export class GET {}', 'unguarded'],
    ['本体を読めない包み(識別子を包む)', `${G}const handler = async () => new Response();\nexport const GET = guardRoute(handler);`, 'handler-unreadable'],
    ['引数の無い包み', `${G}export const GET = guardRoute();`, 'handler-unreadable'],
    ['許していない口の外の行き先の表', `${G}${O}export const GET = guardRoute(async () => new Response(), { externalOrigins: signInRedirectOrigins });`, 'options-not-allowed'],
  ])('包まれていない: %s', (_name, source, kind) => {
    expect(routeGuardProblems('route.ts', source, false).map((problem) => problem.kind)).toEqual([kind]);
  });

  it.each([
    ['import した名前', `${G}${O}export const POST = guardRoute(async () => new Response(), { externalOrigins: signInRedirectOrigins });`, []],
    ['省略記法', `${G}import { externalOrigins } from '@/composition/session-endpoints';\nexport const POST = guardRoute(async () => new Response(), { externalOrigins });`, []],
    ['矢印関数で組む(閉じていない)', `${G}export const POST = guardRoute(async () => new Response(), { externalOrigins: () => ['https://evil.example'] });`, ['options-shape']],
    ['局所の値', `${G}const origins = () => ['https://evil.example'];\nexport const POST = guardRoute(async () => new Response(), { externalOrigins: origins });`, ['options-shape']],
    ['ほかの欄', `${G}${O}export const POST = guardRoute(async () => new Response(), { externalOrigins: signInRedirectOrigins, logger: x });`, ['options-shape']],
    ['3 つ目の引数', `${G}${O}export const POST = guardRoute(async () => new Response(), { externalOrigins: signInRedirectOrigins }, extra);`, ['options-shape']],
    ['オブジェクトでない第 2 引数', `${G}${O}export const POST = guardRoute(async () => new Response(), signInRedirectOrigins);`, ['options-shape']],
    ['ダウンロードの宣言が変数', `${G}const rows = [];\nexport const GET = guardRoute(async () => new Response(), { attachmentTypes: rows });`, ['options-shape']],
    ['ダウンロードの宣言が空', `${G}export const GET = guardRoute(async () => new Response(), { attachmentTypes: [] });`, ['options-shape']],
    ['ダウンロードの宣言に理由が無い', `${G}export const GET = guardRoute(async () => new Response(), { attachmentTypes: [{ type: 'text/csv' }] });`, ['options-shape']],
    ['ダウンロードの理由が空白', `${G}export const GET = guardRoute(async () => new Response(), { attachmentTypes: [{ type: 'text/csv', reason: ' ' }] });`, ['options-shape']],
    ['ダウンロードの型が計算', `${G}export const GET = guardRoute(async () => new Response(), { attachmentTypes: [{ type: csv, reason: '帳票の出力' }] });`, ['options-shape']],
    ['ダウンロードの行に余計な欄', `${G}export const GET = guardRoute(async () => new Response(), { attachmentTypes: [{ type: 'text/csv', reason: 'x', more: 1 }] });`, ['options-shape']],
    ['欄の重複', `${G}export const GET = guardRoute(async () => new Response(), { attachmentTypes: [{ type: 'text/csv', reason: 'x' }], attachmentTypes: [{ type: 'text/html', reason: 'y' }] });`, ['options-shape']],
    ['空のオブジェクト', `${G}export const GET = guardRoute(async () => new Response(), {});`, ['options-shape']],
  ])('認証の start の口の外の行き先の表: %s', (_name, source, kinds) => {
    expect(routeGuardProblems('route.ts', source, true).map((problem) => problem.kind)).toEqual(kinds);
  });

  it('包みは口の本体を変えない(ほかの検査が中の関数を読む)', () => {
    const file = parseModule('route.ts', `${G}export const POST = guardRoute(async (request: Request) => new Response());\nexport const GET = async () => new Response();`);
    expect(exportedFunctions(file).map(([name]) => name)).toEqual(['POST', 'GET']);
    const spoofed = parseModule('route.ts', "import { guardRoute } from './x';\nexport const POST = guardRoute(async () => new Response());");
    expect(exportedFunctions(spoofed)).toEqual([]);
  });
});

describe('J2: 全部の入口の口は出口の関所で包む', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** 一時の木(製品の `src/app` からの相対 → 本文)。 */
  function treeOf(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(path.join(tmpdir(), 'j2-entry-guard-'));
    made.push(root);
    putFrameConfig(root);
    for (const [file, text] of Object.entries(files)) {
      const target = path.join(root, 'app/src/app', file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    return root;
  }

  const START = `${G}${O}export const POST = guardRoute(async () => new Response(), { externalOrigins: signInRedirectOrigins });\n`;

  /** 認証の start / logout とジョブを宣言した入力。 */
  const run = (files: Readonly<Record<string, string>>) =>
    verifyEntryClosedWorld({
      jobs: jobModel([scheduledJob('hook', { endpoint: '/api/hook' })]),
      external: UNSELECTED,
      auth: authModel({ start: authEntry('start', '/api/auth/sign-in'), logout: authEntry('logout', '/api/auth/logout') }),
      repoRoot: treeOf(files),
      roots: TEST_ROOTS,
      layout: TEST_LAYOUT,
    }).findings;

  it('全部の口が包まれ、外の行き先の表は start の口だけなら 0 件', () => {
    expect(
      run({
        'api/hook/route.ts': `${G}export const GET = guardRoute(async () => new Response());\n`,
        'api/auth/sign-in/route.ts': START,
        'api/auth/logout/route.ts': `${G}export const POST = guardRoute(async () => new Response());\n`,
      }),
    ).toEqual([]);
  });

  it('探り(点検 10 回目 B10-1 の前提): 包まない口は、ジョブの口でも認証の口でも error でメソッドと直し方を名指す', () => {
    const findings = run({
      'api/hook/route.ts': 'export async function GET() { return new Response(null, { status: 303, headers: { location: next } }); }\n',
      'api/auth/sign-in/route.ts': START,
      'api/auth/logout/route.ts': 'export async function POST() { return new Response(); }\n',
    });
    expect(findings.map((finding) => finding.location?.file).sort()).toEqual(['app/src/app/api/auth/logout/route.ts', 'app/src/app/api/hook/route.ts']);
    expect(findings[0]).toMatchObject({ verifier: 'J2', severity: 'error' });
    expect(findings[0]?.message).toMatch(/の (GET|POST) が、出口の関所 guardRoute で包んでいません/u);
    expect(findings[0]?.suggestion).toContain("import { guardRoute } from '@kaninabe/runtime/http/route-guard'");
  });

  it('外の行き先の表は start の口だけ(logout やジョブの口が持てば error)', () => {
    const findings = run({
      'api/hook/route.ts': `${G}${O}export const GET = guardRoute(async () => new Response(), { externalOrigins: signInRedirectOrigins });\n`,
      'api/auth/sign-in/route.ts': START,
      'api/auth/logout/route.ts': `${G}${O}export const POST = guardRoute(async () => new Response(), { externalOrigins: signInRedirectOrigins });\n`,
    });
    expect(findings.map((finding) => finding.counterexample?.['problem'])).toEqual(['options-not-allowed', 'options-not-allowed']);
  });
});
