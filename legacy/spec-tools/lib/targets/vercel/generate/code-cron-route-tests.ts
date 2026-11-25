/**
 * ジョブカタログ → **Cron 起動口の認可の見張りテスト**(ユニットテスト)の生成器。
 *
 * **ホストの後段 Vercel(`role: host`)が登録する生成器**である(Vercel Cron が `Authorization: Bearer {秘密}` で秘密を運ぶ形に属する)。
 * 出力のファイル・字面は、コアの生成器の一覧にあったときと同じ(置き場が動いただけ)。
 *
 * ## なぜ生成するのか
 *
 * 保証「設定が無ければ閉じる」(`config_absent_closes`)は「秘密が未設定なら Cron の起動口は常に 403」と
 * 言う。見張りテストが叩いていたのは判定の純関数だけで、**起動口が本当にそれを呼んでいるか**は誰も
 * 見ていなかった(Route Handler はカバレッジの対象外で、起動口を呼ぶテストが 1 本も無い)。口から認可を
 * 外しても、台帳の主張と見張りの範囲がずれたまま全部緑だった(網の穴探し 2026-10-06 の M01)。
 *
 * 認可の判定は composition に触る前に終わるので、起動口を**そのまま呼ぶ**だけで確かめられる
 * (DB は要らない)。時刻起点のジョブ 1 行 = 起動口 1 本として、カタログから表を作る —— ジョブを足せば
 * 見張りも自動で増える(足し忘れが起きない)。
 *
 * **起動口が export する HTTP メソッドは全部**見る(`GET` だけではない)。規約は「Cron の口は `GET` 1 つ」だが
 * 執行されていないと、認可を持たない `POST` を 1 本足されても `GET` だけの見張りは緑のままだった(独立レビュー m01d)。
 * メソッドの一覧は手書きせず、起動口の構文木(`semantics/route-exports.ts`)から取る。
 *
 * ## 形
 *
 * 保証台帳の見張りテスト(`config_absent_closes` の `test_cases`)が名指す 2 本の `it()`:
 *   - 秘密が未設定なら、**どの起動口も** 403(`Authorization: Bearer undefined` でも開かない)
 *   - 秘密と違う `Authorization`(または無し)なら、**どの起動口も** 403
 * どの起動口が 403 を返さなかったかを名指して落とす(ジョブ・口・実際のステータス)。例外で落ちた
 * 起動口は「閉じていない」として数える(認可を外すと、その先で配線が例外を投げる)。
 *
 * ファイルが 1 枚なのは、保証台帳の `test_cases` が指すテスト名が起動口の数に依らないようにするため
 * (ジョブが増えても台帳の宣言は動かない)。規約どおりファイル I/O はしない純粋関数である。
 */

import type { SpecModel } from '../../../model/types.js';
import type { ProductLayout } from '../../../model/product/layout.js';
import { exportedHttpMethods } from '../../../semantics/route-exports.js';
import type { HttpMethod } from '../../../semantics/route-exports.js';
import type { JobCatalogSpec, JobDecl } from '../../../model/job/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../../gen-kit/generator.js';
import { CRON_ROUTE_WORDING } from '../../../messages/messages-cron.js';
import { generatedHeader, toCamelCase, tsString } from '../../../gen-kit/code-emit.js';
import { placedModule, placedPath } from '../../../generate/layout-placement.js';
import { testPlacerOf } from '../../../generate/render/test-placement.js';
import type { Placement } from '../../../generate/layout-placement.js';

/**
 * Vercel Cron が `Authorization: Bearer {秘密}` の秘密に使う環境変数の名前。
 *
 * プラットフォームの契約であり、製品が選ぶ名前ではない(`vercel.json` の `crons` と同じ側に属する)。
 */
const CRON_SECRET_ENV = 'CRON_SECRET';

/** 「秘密が設定されている」場面で使うテスト用の値(本物の秘密ではない)。 */
const CONFIGURED_SECRET = 'test-cron-secret';

/**
 * 保証台帳の見張りテスト(`config_absent_closes`)が指す、1 本目のテストケース ID。
 * テスト名は文言表(`CRON_ROUTE_WORDING.absent`)が持ち、保証台帳の `test_cases[].implementation` が名指す(Z1 が突き合わせる)。
 */
export const CRON_ROUTE_ABSENT_TC = 'TC-GUAR-CONFIG-002';
/** 2 本目のテストケース ID(テスト名は `CRON_ROUTE_WORDING.mismatch`)。 */
export const CRON_ROUTE_MISMATCH_TC = 'TC-GUAR-CONFIG-003';

/** 起動口 1 本の宣言(時刻起点のジョブ 1 行)。 */
type CronJob = JobDecl & { readonly endpoint: string };

/** 起動口を持つ時刻起点のジョブ(カタログの宣言順)。 */
function cronJobs(catalog: JobCatalogSpec): readonly CronJob[] {
  return catalog.jobs.flatMap((decl) => {
    const endpoint = decl.schedule?.endpoint;
    return endpoint === undefined ? [] : [{ ...decl, endpoint }];
  });
}

/**
 * 起動口が export している HTTP メソッド。
 * 本文が読めない(文脈に載っていない・1 つも export していない)ときは `GET` とみなす(規約: Cron の口は GET)。
 */
function methodsOf(job: CronJob, ctx: GenerateContext, layout: ProductLayout): readonly HttpMethod[] {
  const route = placedPath(layout, ctx.roots, entryOf(job));
  const source = ctx.routeSources?.get(route);
  const methods = source === undefined ? [] : exportedHttpMethods(route, source);
  return methods.length === 0 ? ['GET'] : methods;
}

/** ジョブの起動口の置き場の主張(配置の `http-entry`。キーは URL のパス)。 */
function entryOf(job: CronJob): Placement {
  return { role: 'http-entry', key: job.endpoint, what: `ジョブ ${job.id} の起動口 ${job.endpoint}`, location: job.location };
}

/**
 * 起動口の import(モジュール指定は置き場の配置の `http-entry` が決める)。メソッドを 1 つずつ取り出すので名前空間で受ける。
 * 配置が import の指定を決められなければ前提の失敗で止める(その口を黙ってテストの表から外さない — 認可の見張りが黙って縮む)。
 */
function importLine(job: CronJob, layout: ProductLayout): string {
  return `import * as ${toCamelCase(job.id)} from '${placedModule(layout, entryOf(job))}';`;
}

/** 起動口の表の行(export しているメソッド 1 つにつき 1 行)。 */
function routeRows(job: CronJob, ctx: GenerateContext, layout: ProductLayout): readonly string[] {
  return methodsOf(job, ctx, layout).map(
    (method) =>
      `  { job: ${tsString(job.id)}, endpoint: ${tsString(job.endpoint)}, method: ${tsString(method)}, handler: ${toCamelCase(job.id)}.${method} },`,
  );
}

/** ファイル全体。 */
function renderFile(catalog: JobCatalogSpec, ctx: GenerateContext, layout: ProductLayout): string {
  const jobs = cronJobs(catalog);
  const rows = jobs.flatMap((job) => routeRows(job, ctx, layout));
  return [
    generatedHeader([catalog.location.file]),
    '',
    "import { afterEach, describe, expect, it, vi } from 'vitest';",
    ...jobs.map((job) => importLine(job, layout)),
    '',
    '/** 起動口 1 本の 1 メソッド(時刻起点のジョブ 1 行の、export している HTTP メソッド 1 つ)。 */',
    'interface CronRoute {',
    '  readonly job: string;',
    '  readonly endpoint: string;',
    '  readonly method: string;',
    '  readonly handler: (request: Request) => Promise<Response>;',
    '}',
    '',
    `/** 時刻起点のジョブ(\`source: schedule\`)のうち、起動口を持つもの全部(${jobs.length} 本)の、export している HTTP メソッド全部(${rows.length} 口)。 */`,
    'const ROUTES: readonly CronRoute[] = [',
    ...rows,
    '];',
    '',
    '/** 起動口を 1 回呼び、HTTP ステータスを返す(例外で落ちたものは、その理由を文字列で返す)。 */',
    'async function statusOf(route: CronRoute, authorization: string | null): Promise<number | string> {',
    '  const headers = new Headers();',
    "  if (authorization !== null) headers.set('authorization', authorization);",
    '  try {',
    '    return (await route.handler(new Request(`http://localhost${route.endpoint}`, { method: route.method, headers }))).status;',
    '  } catch (error) {',
    `    return \`${CRON_ROUTE_WORDING.thrown}\${error instanceof Error ? error.message : String(error)}\`;`,
    '  }',
    '}',
    '',
    '/** 403 を返さなかった起動口(`ジョブ メソッド (口): 実際`の並び。空なら全部閉じている)。 */',
    'async function notClosed(authorization: string | null): Promise<readonly string[]> {',
    '  const results = await Promise.all(',
    '    ROUTES.map(async (route) => ({ route, status: await statusOf(route, authorization) })),',
    '  );',
    '  return results',
    '    .filter(({ status }) => status !== 403)',
    '    .map(({ route, status }) => `${route.job} ${route.method} (${route.endpoint}): ${String(status)}`);',
    '}',
    '',
    `describe(${tsString(CRON_ROUTE_WORDING.suite)}, () => {`,
    '  afterEach(() => {',
    '    vi.unstubAllEnvs();',
    '  });',
    '',
    `  // @spec guarantee-catalog @tc ${CRON_ROUTE_ABSENT_TC}`,
    `  it(${tsString(CRON_ROUTE_WORDING.absent)}, async () => {`,
    `    vi.stubEnv(${tsString(CRON_SECRET_ENV)}, undefined);`,
    "    expect(await notClosed('Bearer undefined')).toEqual([]);",
    '    expect(await notClosed(null)).toEqual([]);',
    '  });',
    '',
    `  // @spec guarantee-catalog @tc ${CRON_ROUTE_MISMATCH_TC}`,
    `  it(${tsString(CRON_ROUTE_WORDING.mismatch)}, async () => {`,
    `    vi.stubEnv(${tsString(CRON_SECRET_ENV)}, ${tsString(CONFIGURED_SECRET)});`,
    "    expect(await notClosed('Bearer wrong-secret')).toEqual([]);",
    '    expect(await notClosed(null)).toEqual([]);',
    '  });',
    '});',
    '',
  ].join('\n');
}

/**
 * ジョブカタログから Cron 起動口の認可の見張りテストを生成するジェネレーター。
 * 出力は 1 ファイル(全置換)。**そのテストファイル自身の置き場は置き場の配置の `cron-route-test` が決め**、Next.js なら `{実装の木}/src/app/api/__tests__/generated/cron-routes.test.ts`。
 * カタログが無い・実装の木を持たない製品では何も出さない。**時刻起点のジョブ(起動口を持つ行)が 1 本も無い製品でも何も出さない**
 * (見張る口が 0 本の試験は何も見ずに通る。生成器は見るものの無い試験を出さない — scripts-code-quality.md §テスト)。
 * **起動口の位置と import は置き場の配置の `http-entry` が決め**、決められなければ前提の失敗で止める(黙って表から外さない)。
 */
export const cronRouteTestsGenerator: DocGenerator = {
  id: 'code-cron-route-tests',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.jobs?.catalog;
    if (catalog === undefined || catalog === null) return [];
    // 時刻起点のジョブが無ければ見張る口が 0 本で、2 本の it は何も見ずに通る。生成器は見るものの無い試験を出さない(fix27 A2)。
    if (cronJobs(catalog).length === 0) return [];
    const place = testPlacerOf(ctx.layout, ctx.roots, 'cron-route-test', { what: 'Cron 起動口の認可の見張りテスト', location: catalog.location });
    if (place === null) return [];
    // 起動口の置き場(J2 が先に指す)を決めてから、テストファイル自身の置き場を決める(配置が欠けたとき、先に見るべき検査を先に名指す)。
    const content = renderFile(catalog, ctx, ctx.layout);
    return [{ file: place(''), content, wholeFile: true }];
  },
};
