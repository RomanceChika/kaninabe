/**
 * Cron 起動口の認可の見張りテスト(`code-cron-route-tests.ts`)のユニットテスト。
 *
 * 固定するのは 4 点 —— ①時刻起点のジョブ 1 行(起動口を持つ行)= 起動口 1 本として表に載ること
 * (載せ忘れが起きない)②**起動口が export している HTTP メソッド全部**が表に載ること(`GET` だけではない。
 * 一覧は起動口の構文木から取り、本文が読めないときだけ `GET`)③保証台帳が名指すテストケース ID とテスト名が、
 * 生成テストの字面と同じであること(Z1 が突き合わせる綴りの正がここ 1 か所)④カタログも実装の木も無い製品では何も出さないこと。
 */

import { describe, expect, it } from 'vitest';
import { GeneratorPreconditionError } from '../../../../../lib/kernel/generator-precondition.js';
import { EMPTY_LAYOUT } from '../../../../../lib/model/product/layout.js';
import {
  CRON_ROUTE_ABSENT_TC,
  CRON_ROUTE_MISMATCH_TC,
  cronRouteTestsGenerator,
} from '../../../../../lib/targets/vercel/generate/code-cron-route-tests.js';
import { CRON_ROUTE_WORDING } from '../../../../../lib/messages/messages-cron.js';
import { jobModel, notScheduledJob, outboxJob, scheduledJob } from '../../../../helpers/job-builder.js';
import { specModel, stubGuards } from '../../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';
import { LAYOUT_DEFINITION_CHECK } from '../../../../../lib/generate/layout-placement.js';
import { FOREIGN_LAYOUT, leaksNextjsEntrySpelling, TEST_LAYOUT, TEST_PLATFORM } from '../../../../helpers/platform.js';
import type { ProductLayout } from '../../../../../lib/model/product/layout.js';
import type { ProductRoots } from '../../../../../lib/model/product/types.js';
import { NO_GATES } from '../../../../helpers/generate-context.js';

/** 起動口 2 本・起動口の無い時刻起点 1 本・outbox 1 本のカタログ。 */
const CATALOG = jobModel([
  outboxJob('notify_organizer_new_entry'),
  scheduledJob('close_due_workshops', { endpoint: '/api/deadlines/run' }),
  scheduledJob('run_due_jobs', { endpoint: '/api/jobs/run' }),
  notScheduledJob('not_wired_yet', 'まだ結線していない'),
]);

/** 生成する(`routeSources` は起動口の本文。省略すれば読めていない場合と同じ)。 */
function generate(
  jobs = CATALOG,
  roots: ProductRoots = TEST_ROOTS,
  routeSources?: ReadonlyMap<string, string>,
  layout: ProductLayout = TEST_LAYOUT,
) {
  return cronRouteTestsGenerator.generate(specModel([]), {
    guards: stubGuards(),
    roots,
    platform: TEST_PLATFORM,
    layout,
    gates: NO_GATES,
    jobs,
    ...(routeSources === undefined ? {} : { routeSources }),
  });
}

describe('code-cron-route-tests', () => {
  it('起動口を持つ時刻起点のジョブ 1 行が、起動口 1 本として表に載る(起動口の無い行・outbox の行は載らない)', () => {
    const [section] = generate();

    expect(section?.file).toBe('app/src/app/api/__tests__/generated/cron-routes.test.ts');
    expect(section?.wholeFile).toBe(true);
    expect(section?.content).toContain("import * as closeDueWorkshops from '@/app/api/deadlines/run/route';");
    expect(section?.content).toContain("{ job: 'close_due_workshops', endpoint: '/api/deadlines/run', method: 'GET', handler: closeDueWorkshops.GET },");
    expect(section?.content).toContain("{ job: 'run_due_jobs', endpoint: '/api/jobs/run', method: 'GET', handler: runDueJobs.GET },");
    expect(section?.content).not.toContain('notWiredYet');
    expect(section?.content).not.toContain('notify_organizer_new_entry');
    expect(section?.content).toContain('(2 本)');
  });

  it('起動口が export している HTTP メソッドは全部が表に載る(起動口の構文木から取る)', () => {
    const routeSources = new Map([
      ['app/src/app/api/deadlines/run/route.ts', 'export async function GET() {}\nexport const POST = async () => new Response();\n'],
      ['app/src/app/api/jobs/run/route.ts', 'export { handler as GET, remove as DELETE };\n'],
    ]);

    const content = generate(CATALOG, TEST_ROOTS, routeSources)[0]?.content ?? '';

    expect(content).toContain("{ job: 'close_due_workshops', endpoint: '/api/deadlines/run', method: 'GET', handler: closeDueWorkshops.GET },");
    expect(content).toContain("{ job: 'close_due_workshops', endpoint: '/api/deadlines/run', method: 'POST', handler: closeDueWorkshops.POST },");
    expect(content).toContain("{ job: 'run_due_jobs', endpoint: '/api/jobs/run', method: 'GET', handler: runDueJobs.GET },");
    expect(content).toContain("{ job: 'run_due_jobs', endpoint: '/api/jobs/run', method: 'DELETE', handler: runDueJobs.DELETE },");
    expect(content).toContain('(2 本)の、export している HTTP メソッド全部(4 口)');
  });

  it('メソッドごとに、そのメソッドで起動口を呼び、失敗の報告にもメソッドを載せる', () => {
    const content = generate()[0]?.content ?? '';

    expect(content).toContain('new Request(`http://localhost${route.endpoint}`, { method: route.method, headers })');
    expect(content).toContain('`${route.job} ${route.method} (${route.endpoint}): ${String(status)}`');
  });

  it('起動口が 1 つも HTTP メソッドを export していない本文でも GET として出す(古い生成物を取り残さず、見張りも外さない)', () => {
    const routeSources = new Map([['app/src/app/api/deadlines/run/route.ts', "export const dynamic = 'force-dynamic';\n"]]);

    const content = generate(CATALOG, TEST_ROOTS, routeSources)[0]?.content ?? '';

    expect(content).toContain("{ job: 'close_due_workshops', endpoint: '/api/deadlines/run', method: 'GET', handler: closeDueWorkshops.GET },");
  });

  it('保証台帳が名指すテストケース ID とテスト名が、生成テストの字面そのものである', () => {
    const content = generate()[0]?.content ?? '';

    expect(content).toContain(`// @spec guarantee-catalog @tc ${CRON_ROUTE_ABSENT_TC}\n  it('${CRON_ROUTE_WORDING.absent}'`);
    expect(content).toContain(`// @spec guarantee-catalog @tc ${CRON_ROUTE_MISMATCH_TC}\n  it('${CRON_ROUTE_WORDING.mismatch}'`);
  });

  it('秘密の未設定・違う Authorization・Authorization 無しの 3 つの場面を、全起動口に対して見る', () => {
    const content = generate()[0]?.content ?? '';

    expect(content).toContain("vi.stubEnv('CRON_SECRET', undefined);");
    expect(content).toContain("expect(await notClosed('Bearer undefined')).toEqual([]);");
    expect(content).toContain("expect(await notClosed('Bearer wrong-secret')).toEqual([]);");
    expect(content).toContain('expect(await notClosed(null)).toEqual([]);');
  });

  // 生成器は見るものの無い試験を出さない(fix27 A2): 見張る口が 0 本の 2 本の it は何も見ずに通るので、生成しない。
  it.each([
    ['outbox のジョブだけ', jobModel([outboxJob('notify_organizer_new_entry')])],
    ['時刻起点だが起動口の無いジョブだけ', jobModel([notScheduledJob('not_wired_yet', 'まだ結線していない')])],
    ['ジョブが 1 行も無い', jobModel([])],
  ] as const)('負例: 起動口を持つ時刻起点のジョブが 1 本も無ければ、試験を生成しない(%s)', (_name, jobs) => {
    expect(generate(jobs)).toEqual([]);
  });

  it('正例: 起動口を持つ時刻起点のジョブが 1 本でもあれば、見る口の表は空でなく、2 本の it が出る', () => {
    const content = generate(jobModel([scheduledJob('run_due_jobs', { endpoint: '/api/jobs/run' })]))[0]?.content ?? '';
    expect(content).not.toContain('const ROUTES: readonly CronRoute[] = [];');
    expect(content).toContain("{ job: 'run_due_jobs', endpoint: '/api/jobs/run', method: 'GET', handler: runDueJobs.GET },");
    expect(content.match(/^ {2}it\(/gm)).toHaveLength(2);
  });

  it('配置を差し替えると、起動口の位置と import の指定がその配置の値になる(Next.js の綴りは import にも表にも残らない)', () => {
    const routeSources = new Map([
      ['app/server_code/endpoints/api/deadlines/run.handler.ts', 'export async function GET() {}\nexport const POST = async () => new Response();\n'],
      // Next.js の位置に本文があっても、配置が指す位置ではないので読まない(起動口の GET だけが表に載る)。
      ['app/src/app/api/jobs/run/route.ts', 'export const DELETE = 1;\n'],
    ]);

    const [section] = generate(CATALOG, TEST_ROOTS, routeSources, FOREIGN_LAYOUT);
    const content = section?.content ?? '';

    // テストファイル自身の置き場も、配置の役割 cron-route-test が決める(Next.js の `app/api/__tests__/generated` は残らない)。
    expect(section?.file).toBe('app/server_code/checks/cron/all_routes.check.ts');
    expect(leaksNextjsEntrySpelling(section?.file ?? '')).toBe(false);
    expect(content).toContain("import * as closeDueWorkshops from '~srv/endpoints/api/deadlines/run.handler';");
    expect(content).toContain("import * as runDueJobs from '~srv/endpoints/api/jobs/run.handler';");
    expect(content).toContain("{ job: 'close_due_workshops', endpoint: '/api/deadlines/run', method: 'POST', handler: closeDueWorkshops.POST },");
    expect(content).not.toContain('runDueJobs.DELETE');
    expect(leaksNextjsEntrySpelling(content)).toBe(false);
  });

  it('実装の木があるのに配置が http-entry を解決できなければ、黙って表から外さず前提の失敗で止める(認可の見張りが黙って縮まない)', () => {
    const stop = (layout: ProductLayout): GeneratorPreconditionError => {
      try {
        generate(CATALOG, TEST_ROOTS, undefined, layout);
      } catch (error) {
        if (error instanceof GeneratorPreconditionError) return error;
        throw error;
      }
      throw new Error('止まらなかった');
    };

    const empty = stop(EMPTY_LAYOUT);
    expect(empty.findings.map((finding) => finding.verifier)).toEqual(['J2']);
    expect(empty.findings[0]?.message).toContain('ジョブ close_due_workshops の起動口 /api/deadlines/run の置き場を、置き場の配置から決められません(役割 http-entry');
    // 置き場は決まるが import の指定を持てない配置(module が無い)も、その口を黙って外さない。
    const httpEntry = FOREIGN_LAYOUT['http-entry'];
    if (httpEntry === undefined) throw new Error('配置に http-entry がある');
    const noModule = stop({ ...FOREIGN_LAYOUT, 'http-entry': { ...httpEntry, module: null } });
    expect(noModule.findings[0]?.message).toContain('ジョブ close_due_workshops の起動口 /api/deadlines/run の import の指定を、置き場の配置から決められません');
  });

  it('起動口の置き場は決まるのに、テストファイル自身の置き場(cron-route-test)を決められない配置は、配置の定義の検査を名指して止める', () => {
    const { 'cron-route-test': _omitted, ...withoutCronTest } = FOREIGN_LAYOUT;
    try {
      generate(CATALOG, TEST_ROOTS, undefined, withoutCronTest);
      throw new Error('止まらなかった');
    } catch (error) {
      if (!(error instanceof GeneratorPreconditionError)) throw error;
      expect(error.findings.map((finding) => finding.verifier)).toEqual([LAYOUT_DEFINITION_CHECK]);
      expect(error.findings[0]?.message).toContain('Cron 起動口の認可の見張りテスト の置き場を、置き場の配置から決められません(役割 cron-route-test)');
    }
  });

  it('カタログが無ければ何も出さない', () => {
    expect(generate({ available: false, catalog: null })).toEqual([]);
  });

  it('実装の木を持たない製品では何も出さない', () => {
    expect(generate(CATALOG, { ...TEST_ROOTS, app: null })).toEqual([]);
  });
});
