/**
 * J2(続き)cookie で認証する手書きの口の出どころの確認(`j2-entry-origin-guard.ts`)のユニットテスト。
 *
 * 送信の連携の `endpoints` の Route Handler が、状態を変えるメソッドを export するなら出どころを確かめる部品を呼ぶこと
 * (呼ばなければ error・状態を変えないメソッドだけなら言わない・口が無ければ閉世界の持ち物なので言わない)を見る。
 * 検証器は実装の木を読むので、テストごとに一時ディレクトリへ木を組む。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ORIGIN_GUARD_FUNCTION, ORIGIN_GUARD_MODULE, verifyEntryOriginGuard } from '../../../../lib/job/verifiers/j2-entry-origin-guard.js';
import { RUNTIME_REQUEST_ORIGIN_MODULE } from '../../../../lib/generate/render/runtime-modules.js';
import { externalModel, integration } from '../../../helpers/external-builder.js';
import { authLogout, authModel } from '../../../helpers/auth-builder.js';
import { jobModel } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { layoutPath } from '../../../../lib/model/product/layout.js';

/** 作った一時ディレクトリ(後で消す)。 */
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 口の本文を置いた木を組み、リポジトリルートを返す。 */
function treeWith(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'j2-origin-'));
  created.push(root);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  }
  return root;
}

/** 送信の連携 1 本(口 1 本)。 */
const EXTERNAL = externalModel([integration('chat', { service: 'anthropic', effect: 'read', endpoints: ['/api/ai/x'] })]).catalog ?? undefined;

/** 口の置き場(配置が決める。テストに製品の木のパスを直書きしない)。 */
const ROUTE = layoutPath(TEST_LAYOUT, TEST_ROOTS.app, 'http-entry', '/api/ai/x') ?? '';

/** 検査を回す。 */
function run(repoRoot: string) {
  return verifyEntryOriginGuard({ jobs: jobModel([]), external: EXTERNAL, auth: authModel({ logout: authLogout() }), repoRoot, roots: TEST_ROOTS, layout: TEST_LAYOUT });
}

describe('J2: cookie で認証する手書きの口の出どころの確認', () => {
  it('部品の綴りは、生成物が import する実行時パッケージの公開の口と同じ', () => {
    expect(ORIGIN_GUARD_MODULE).toBe(RUNTIME_REQUEST_ORIGIN_MODULE);
  });

  it('状態を変えるメソッドを export するのに部品を呼ばない口は error(場所・メソッド・直し方を名指す)', () => {
    const findings = run(treeWith({ [ROUTE]: 'export async function POST(request: Request) { return new Response(null); }\n' }));
    expect(findings.map((finding) => [finding.verifier, finding.severity, finding.counterexample])).toEqual([
      ['J2', 'error', { endpoint: '/api/ai/x', route: ROUTE, methods: 'POST', shapes: 'not-called' }],
    ]);
    expect(findings[0]?.suggestion).toContain(ORIGIN_GUARD_FUNCTION);
  });

  it('部品を import して呼ぶ口・cookie の付かない OPTIONS だけの口・口が無い木では何も言わない', () => {
    const guarded = `import { X } from '@/domain/generated/browser-defense';\nimport { ${ORIGIN_GUARD_FUNCTION} } from '${ORIGIN_GUARD_MODULE}';\nexport async function POST(request: Request) {\n  const refused = ${ORIGIN_GUARD_FUNCTION}(request, X);\n  return refused ?? new Response(null);\n}\n`;
    expect(run(treeWith({ [ROUTE]: guarded }))).toEqual([]);
    expect(run(treeWith({ [ROUTE]: 'export async function OPTIONS() { return new Response(null); }\n' }))).toEqual([]);
    expect(run(treeWith({ [`${TEST_ROOTS.app ?? ''}/README.md`]: '' }))).toEqual([]);
  });

  it('呼び出しだけ・import だけ(どちらかが欠ける)は呼んでいないと数える', () => {
    const callOnly = `export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? new Response(null); }\n`;
    const importOnly = `import { ${ORIGIN_GUARD_FUNCTION} } from '${ORIGIN_GUARD_MODULE}';\nexport async function POST() { return new Response(null); }\n`;
    expect(run(treeWith({ [ROUTE]: callOnly }))).toHaveLength(1);
    expect(run(treeWith({ [ROUTE]: importOnly }))).toHaveLength(1);
  });

  /** 部品の import(別名・名前空間も試す)。 */
  const IMPORT = `import { X } from '@/domain/generated/browser-defense';\nimport { ${ORIGIN_GUARD_FUNCTION} } from '${ORIGIN_GUARD_MODULE}';\nimport { resolveActorId, handle } from '@/composition/x';\n`;

  /** 1 本の口の本文から、形の判定(違反が無ければ 'guarded')を返す。 */
  function shapeOf(body: string): string {
    const findings = run(treeWith({ [ROUTE]: body }));
    return findings.length === 0 ? 'guarded' : String(findings[0]?.counterexample?.['shapes']);
  }

  it('最初の文で部品を呼び、その結果を返す 2 つの形だけを認める(別名の import・名前空間の import・式の本体・同じファイルの関数の再輸出も同じ)', () => {
    const accepted = [
      `${IMPORT}export async function POST(request: Request) {\n  return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? (await handle(request));\n}\n`,
      `${IMPORT}export async function POST(req: Request) {\n  const refused = ${ORIGIN_GUARD_FUNCTION}(req, X);\n  if (refused !== null) return refused;\n  return handle(req);\n}\n`,
      `${IMPORT}export async function POST(req: Request) {\n  const refused = ${ORIGIN_GUARD_FUNCTION}(req, X);\n  if (null != refused) { return refused; }\n  return handle(req);\n}\n`,
      `${IMPORT}export async function POST(req: Request) {\n  const refused = (${ORIGIN_GUARD_FUNCTION}(req, X));\n  if (refused) return refused;\n  return handle(req);\n}\n`,
      `import { X } from '@/domain/generated/browser-defense';\nimport { ${ORIGIN_GUARD_FUNCTION} as guard } from '${ORIGIN_GUARD_MODULE}';\nexport const POST = async (request: Request) => guard(request, X) ?? handle(request);\n`,
      `import { X } from '@/domain/generated/browser-defense';\nimport * as origin from '${ORIGIN_GUARD_MODULE}';\nexport const POST = async function (request: Request) { return origin.${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request); };\n`,
      `${IMPORT}async function handler(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request); }\nexport { handler as POST };\n`,
    ];
    for (const body of accepted) expect(shapeOf(body), body).toBe('guarded');
  });

  it('関門に渡すほかの引数は副作用を持てない(import した識別子・字句と、それで組んだオブジェクトと配列だけ。外部レビュー)', () => {
    const pure = [
      `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request); }\n`,
      `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, { allowed: ['a', 1, true], base: X } as const) ?? handle(request); }\n`,
    ];
    for (const body of pure) expect(shapeOf(body), body).toBe('guarded');
    const effectful = [
      // 外部レビュー の反例: 第 2 引数の中の呼び出しは関門より先に走る
      `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, (writeAudit(), X)) ?? handle(request); }\n`,
      `${IMPORT}export async function POST(request: Request) {\n  const refused = ${ORIGIN_GUARD_FUNCTION}(request, await loadPolicy());\n  if (refused !== null) return refused;\n  return handle(request);\n}\n`,
      `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, (state.count = 1, X)) ?? handle(request); }\n`,
      `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, { base: X, at: Date.now() }) ?? handle(request); }\n`,
      `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, { ...build() }) ?? handle(request); }\n`,
      `${IMPORT}export const POST = async (request: Request) => ${ORIGIN_GUARD_FUNCTION}(request, X, track()) ?? handle(request);\n`,
      // 外部レビュー: 性質の参照は getter で関門より先に走りうる・import していない識別子(ローカルの getter を持つ値・グローバル)
      `${IMPORT}const holder = { get policy() { writeAudit(); return X; } };\nexport async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, holder.policy) ?? handle(request); }\n`,
      `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, localPolicy) ?? handle(request); }\n`,
    ];
    for (const body of effectful) expect(shapeOf(body), body).toBe('argument-has-effect');
  });

  it('関門の後置・結果を捨てる・コメントに書いただけ・要求以外を渡す・型だけの import は error(どう崩れているかを名指す)', () => {
    const cases: readonly (readonly [string, string])[] = [
      // 関門の後置(認証を先に呼んでから、関門の結果を返す)
      [`${IMPORT}export async function POST(request: Request) {\n  await resolveActorId();\n  return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request);\n}\n`, 'not-first'],
      // 結果を捨てる
      [`${IMPORT}export async function POST(request: Request) {\n  ${ORIGIN_GUARD_FUNCTION}(request, X);\n  return handle(request);\n}\n`, 'result-not-returned'],
      // 受けたが if で返さない・if の中身が違う・else を持つ・let で受ける
      [`${IMPORT}export async function POST(request: Request) {\n  const refused = ${ORIGIN_GUARD_FUNCTION}(request, X);\n  await resolveActorId();\n  return refused ?? handle(request);\n}\n`, 'result-not-returned'],
      [`${IMPORT}export async function POST(request: Request) {\n  const refused = ${ORIGIN_GUARD_FUNCTION}(request, X);\n  if (refused !== null) { await resolveActorId(); return refused; }\n  return handle(request);\n}\n`, 'result-not-returned'],
      [`${IMPORT}export async function POST(request: Request) {\n  const refused = ${ORIGIN_GUARD_FUNCTION}(request, X);\n  if (refused === null) return handle(request); else return refused;\n}\n`, 'result-not-returned'],
      [`${IMPORT}export async function POST(request: Request) {\n  let refused = ${ORIGIN_GUARD_FUNCTION}(request, X);\n  if (refused !== null) return refused;\n  return handle(request);\n}\n`, 'result-not-returned'],
      // 式の本体で結果を使わない(`||` は認めない)
      [`${IMPORT}export const POST = async (request: Request) => ${ORIGIN_GUARD_FUNCTION}(request, X) || handle(request);\n`, 'result-not-returned'],
      // コメントに書いただけ
      [`${IMPORT}export async function POST(request: Request) {\n  // ${ORIGIN_GUARD_FUNCTION}(request, X)\n  return handle(request);\n}\n`, 'not-called'],
      [`${IMPORT}export const POST = async (request: Request) => handle(request); // ${ORIGIN_GUARD_FUNCTION}(request, X)\n`, 'not-called'],
      // 要求でないものを渡す・要求を受け取らない
      [`${IMPORT}export async function POST(request: Request) {\n  return ${ORIGIN_GUARD_FUNCTION}(new Request('https://x'), X) ?? handle(request);\n}\n`, 'not-called'],
      [`${IMPORT}export async function POST() {\n  return handle();\n}\n`, 'not-called'],
      // 型だけの import(値の部品ではない)・別のモジュールの同名の関数
      [`import { X } from '@/domain/generated/browser-defense';\nimport type { ${ORIGIN_GUARD_FUNCTION} } from '${ORIGIN_GUARD_MODULE}';\nexport async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request); }\n`, 'not-called'],
      [`import { X } from '@/domain/generated/browser-defense';\nimport { ${ORIGIN_GUARD_FUNCTION} } from './my-guard';\nexport async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request); }\n`, 'not-called'],
      // 本体が読めない(別のモジュールからの再輸出・高階関数の戻り値・分割代入の引数)
      [`export { POST } from './impl';\n`, 'body-unreadable'],
      [`${IMPORT}export const POST = withAuth(async (request: Request) => ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request));\n`, 'body-unreadable'],
      [`${IMPORT}export async function POST({ headers }: Request) { return handle(headers); }\n`, 'body-unreadable'],
    ];
    for (const [body, shape] of cases) expect(shapeOf(body), body).toBe(shape);
  });

  it('状態を変えるメソッドが複数なら、崩れているメソッドだけを名指す', () => {
    const body = `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request); }\nexport async function DELETE(request: Request) { return handle(request); }\n`;
    const findings = run(treeWith({ [ROUTE]: body }));
    expect(findings.map((finding) => finding.counterexample)).toEqual([{ endpoint: '/api/ai/x', route: ROUTE, methods: 'DELETE', shapes: 'not-called' }]);
    expect(findings[0]?.message).toContain('DELETE');
  });

  /** 効果を外へ送る連携(effect: write)の口を見る。 */
  function runWith(effect: 'read' | 'write', body: string, auth = authModel({ logout: authLogout() })) {
    const external = externalModel([integration('notify', { service: 'discord', effect, endpoints: ['/api/ai/x'] })]).catalog ?? undefined;
    return verifyEntryOriginGuard({ jobs: jobModel([]), external, auth, repoRoot: treeWith({ [ROUTE]: body }), roots: TEST_ROOTS, layout: TEST_LAYOUT });
  }

  it('効果を外へ送る連携(effect: write)の口が GET / HEAD を export すれば error(SameSite=Lax の cookie は別のサイトからの最上位の GET に付く)', () => {
    const guardedPost = `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request); }\n`;
    for (const method of ['GET', 'HEAD'] as const) {
      const findings = runWith('write', `${guardedPost}export async function ${method}(request: Request) { await resolveActorId(); return handle(request); }\n`);
      expect(findings.map((finding) => [finding.verifier, finding.severity, finding.counterexample])).toEqual([
        ['J2', 'error', { endpoint: '/api/ai/x', route: ROUTE, methods: method, origin: 'external_endpoint' }],
      ]);
      expect(findings[0]?.message).toContain('SameSite=Lax');
      expect(findings[0]?.suggestion).toContain('POST');
    }
    // GET が部品を呼んでいても、最上位の GET の遷移は同じサイトの印を持たない(部品は GET を閉じる用途ではない)ので error のまま。
    const guardedGet = `${IMPORT}export async function GET(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request); }\n`;
    expect(runWith('write', guardedGet)).toHaveLength(1);
  });

  it('effect: read の連携の口の GET / HEAD も error(点検 4 回目 B4-4: effect は外の系への効果で、GET の本体は composition の書き込みに届きうる)', () => {
    for (const method of ['GET', 'HEAD'] as const) {
      // probe の形: 読み取りの連携の口の GET が、セッションの終了など composition の書き込みを呼ぶ。
      const findings = runWith('read', `${IMPORT}export async function ${method}(request: Request) { await sessionEndOthers(request); return handle(request); }\n`);
      expect(findings.map((finding) => [finding.verifier, finding.severity, finding.counterexample])).toEqual([
        ['J2', 'error', { endpoint: '/api/ai/x', route: ROUTE, methods: method, origin: 'external_endpoint' }],
      ]);
      expect(findings[0]?.message).toContain('effect: read');
      expect(findings[0]?.message).toContain('効果の種類によらず');
    }
    // 本体が読み取りだけに見えても(検査は証明できないので)同じく止める。
    expect(runWith('read', `${IMPORT}export async function GET(request: Request) { return handle(request); }\n`)).toHaveLength(1);
  });

  it('正例: どちらの effect でも、POST(出どころの確認つき)と OPTIONS(cookie が付かない)だけなら言わない', () => {
    const postAndOptions = `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request); }\nexport async function OPTIONS() { return new Response(null); }\n`;
    for (const effect of ['read', 'write'] as const) expect(runWith(effect, postAndOptions), effect).toEqual([]);
  });

  it('サインインの開始・ログアウトの口(宣言の種類そのものが状態を変える POST)が GET を export すれば error', () => {
    const routeOf = (endpoint: string): string => layoutPath(TEST_LAYOUT, TEST_ROOTS.app, 'http-entry', endpoint) ?? '';
    const withGet = (endpoint: string): readonly string[] => {
      const route = routeOf(endpoint);
      const body = `${IMPORT}export async function POST(request: Request) { return ${ORIGIN_GUARD_FUNCTION}(request, X) ?? handle(request); }\nexport async function GET(request: Request) { return handle(request); }\n`;
      return verifyEntryOriginGuard({
        jobs: jobModel([]),
        external: undefined,
        auth: authModel({ logout: authLogout(endpoint) }),
        repoRoot: treeWith({ [route]: body }),
        roots: TEST_ROOTS,
        layout: TEST_LAYOUT,
      }).map((finding) => String(finding.counterexample?.['origin']));
    };
    expect(withGet('/api/auth/logout')).toEqual(['auth_logout']);
  });

  it('実装の木が無いリポジトリでは見ない', () => {
    expect(verifyEntryOriginGuard({ jobs: jobModel([]), external: EXTERNAL, auth: undefined, repoRoot: treeWith({ 'README.md': '' }), roots: TEST_ROOTS, layout: TEST_LAYOUT })).toEqual([]);
  });
});
