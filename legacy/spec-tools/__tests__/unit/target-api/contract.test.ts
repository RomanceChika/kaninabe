import { describe, expect, it } from 'vitest';
import { jobTargetsOf, selectTargetSet, targetGenerators, verifyInputsOf } from '../../../lib/target-api/contract.js';
import type { SelectionRoots, Target } from '../../../lib/target-api/contract.js';
import type { DocGenerator } from '../../../lib/gen-kit/generator.js';
import { SUPABASE_TARGET } from '../../../lib/targets/supabase/target.js';
import { NEXTJS_TARGET } from '../../../lib/targets/nextjs/target.js';
import { VERCEL_TARGET } from '../../../lib/targets/vercel/target.js';
import { NEXTJS_BROWSER_DEFENSE } from '../../../lib/targets/nextjs/browser-defense.js';
import type { ProductLayout, RoleDecl } from '../../../lib/model/product/layout.js';
import { TARGET_ROLES, TARGET_ROLE_MULTIPLICITY } from '../../../lib/kernel/target-role.js';
import { barePlatformTarget, FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_PLATFORM, TEST_GENERATOR_IDS, TEST_LAYOUT, TEST_PLATFORM, TEST_TARGETS } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/**
 * 後段の登録の契約(`lib/target-api/contract.ts`)。組み立ての根が選んだ後段の一覧が契約を満たすときだけ選択になり、
 * 違反は**理由つき**で返る(投げない)。コアは後段の名前を知らず、契約は役割(`role`)と口の ID だけで書かれている。
 */

/** 検査も生成器も持たない後段(役割と設定だけを変えて使う)。 */
function bare(id: string, role: Target['role'], extra: Partial<Target> = {}): Target {
  // アプリの枠の後段は置き場の配置とブラウザ側の守りの宣言を持つ(契約)。違反を見るテストだけ `extra` で上書きする。
  return { id, role, verifiers: [], generators: [], ...(role === 'app_frame' ? { layout: TEST_LAYOUT, browserDefense: NEXTJS_BROWSER_DEFENSE } : {}), ...extra };
}

/** 何も出さない生成器(ID だけ違う)。 */
function generator(id: string): DocGenerator {
  return { id, generate: () => [] };
}

/** 実装の木を宣言する製品の根(アプリの枠の後段がちょうど 1 つ要る)。 */
const WITH_APP: SelectionRoots = { app: 'app', generated: 'app/src/domain/generated' };
/** 実装の木を宣言しない製品の根(アプリの枠の後段は選ばない)。 */
const NO_APP: SelectionRoots = { app: null, generated: 'gen' };

/**
 * 契約に通す。製品の根を省略すると、後段の組に合わせる(アプリの枠の後段があれば実装の木あり・無ければ実装の木なし)ので、
 * 各テストが見たい契約(後段の名前・多重度・検査の登録 ほか)だけを見られる。アプリの枠との食い違いは専用のテストが根を明示する。
 */
function select(targets: readonly Target[], roots?: SelectionRoots, generatorIds: ReadonlySet<string> = TEST_GENERATOR_IDS): ReturnType<typeof selectTargetSet> {
  return selectTargetSet(targets, roots ?? (targets.some((target) => target.role === 'app_frame') ? WITH_APP : NO_APP), generatorIds);
}

/** 選べなかったときの理由。 */
function problemsOf(targets: readonly Target[], roots?: SelectionRoots, generatorIds?: ReadonlySet<string>): readonly string[] {
  const result = select(targets, roots, generatorIds);
  if (result.ok) throw new Error('選べてしまった');
  return result.problems;
}

describe('selectTargetSet: 契約を満たす選択', () => {
  it('本番の後段の組(Supabase + Vercel + Next.js)は選べて、プラットフォームの設定は platform の後段のもの・置き場の配置は app_frame の後段のものになる', () => {
    const result = select(TEST_TARGETS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.platform).toBe(TEST_PLATFORM);
    expect(result.selection.layout).toBe(NEXTJS_TARGET.layout);
    expect(result.selection.targets).toEqual([SUPABASE_TARGET, VERCEL_TARGET, NEXTJS_TARGET]);
  });

  it('アプリの枠の後段が無い構成(実装の木を宣言しない製品)は空の配置(どの役割も解決できない)を持つ。別の配置を持つ後段に差し替えられる', () => {
    const none = select([SUPABASE_TARGET]);
    expect(none.ok && none.selection.layout).toEqual({});
    const foreign = select([SUPABASE_TARGET, bare('foreign-frame', 'app_frame', { layout: FOREIGN_BODY_COMPATIBLE_LAYOUT })], { app: 'app', generated: 'app/server_code/generated' });
    expect(foreign.ok && foreign.selection.layout).toBe(FOREIGN_BODY_COMPATIBLE_LAYOUT);
  });

  it('ホストの後段が無い構成(プラットフォームだけ)も選べる。受け持つ検査が無いだけで、契約の違反ではない', () => {
    expect(select([SUPABASE_TARGET]).ok).toBe(true);
    expect(select([barePlatformTarget()]).ok).toBe(true);
  });

  it('別のプラットフォームの設定を持つ後段に差し替えられる(コアは設定の中身を知らない)', () => {
    const result = select([barePlatformTarget(FOREIGN_PLATFORM), VERCEL_TARGET]);
    expect(result.ok && result.selection.platform).toBe(FOREIGN_PLATFORM);
  });
});

describe('selectTargetSet: 契約の違反は理由つきで返る', () => {
  it('プラットフォームの後段が無い / 2 つある', () => {
    expect(problemsOf([VERCEL_TARGET])).toEqual(['プラットフォームの後段(role: platform)はちょうど 1 つ要ります(いま 0 つ)']);
    expect(problemsOf([SUPABASE_TARGET, barePlatformTarget()]).join('\n')).toContain('ちょうど 1 つ要ります(いま 2 つ)');
  });

  it('platform の後段が設定を持たない / platform でない後段が設定を持つ', () => {
    expect(problemsOf([bare('no-settings', 'platform')])).toEqual(['後段 no-settings は role: platform なのに、プラットフォームの設定(platform)がありません']);
    const problems = problemsOf([SUPABASE_TARGET, bare('host-with-settings', 'host', { platform: TEST_PLATFORM })]);
    expect(problems).toEqual(['後段 host-with-settings は役割が host なのに、プラットフォームの設定を持っています(設定を持てるのは platform の後段だけ)']);
  });

  it('app_frame の後段が配置を持たない / app_frame でない後段が配置を持つ / 配置そのものが契約に反する', () => {
    expect(problemsOf([SUPABASE_TARGET, { id: 'no-layout', role: 'app_frame', verifiers: [], generators: [], browserDefense: NEXTJS_BROWSER_DEFENSE }])).toEqual([
      '後段 no-layout は role: app_frame なのに、置き場の配置(layout)がありません',
    ]);
    expect(problemsOf([SUPABASE_TARGET, bare('host-with-layout', 'host', { layout: TEST_LAYOUT })])).toEqual([
      '後段 host-with-layout は役割が host なのに、置き場の配置を持っています(配置を持てるのは app_frame の後段だけ)',
    ]);
    const source = TEST_LAYOUT['source-root'] as RoleDecl;
    const cyclic: ProductLayout = { ...TEST_LAYOUT, 'source-root': { ...source, base: 'http-entry' } };
    const problems = problemsOf([SUPABASE_TARGET, bare('cyclic', 'app_frame', { layout: cyclic })]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((problem) => problem.startsWith('後段 cyclic の配置: '))).toBe(true);
    expect(problems.join('\n')).toContain('基準をたどると循環します');
  });

  it('app_frame の後段がブラウザ側の守りの宣言を持たない / app_frame でない後段が持つ / 宣言が床を下回る', () => {
    const withoutDefense: Target = { id: 'no-defense', role: 'app_frame', verifiers: [], generators: [], layout: TEST_LAYOUT };
    expect(problemsOf([SUPABASE_TARGET, withoutDefense])).toEqual(['後段 no-defense は role: app_frame なのに、ブラウザ側の守りの宣言(browserDefense)がありません']);
    expect(problemsOf([SUPABASE_TARGET, bare('host-with-defense', 'host', { browserDefense: NEXTJS_BROWSER_DEFENSE }), bare('frame', 'app_frame')])).toEqual([
      '後段 host-with-defense は役割が host なのに、ブラウザ側の守りの宣言を持っています(持てるのは app_frame の後段だけ)',
    ]);
    const weak = { ...NEXTJS_BROWSER_DEFENSE, headers: NEXTJS_BROWSER_DEFENSE.headers.filter((header) => header.name !== 'X-Content-Type-Options') };
    expect(problemsOf([SUPABASE_TARGET, bare('weak', 'app_frame', { browserDefense: weak })])).toEqual([
      '後段 weak のブラウザ側の守り: 全応答に付けるヘッダ x-content-type-options がありません',
    ]);
  });

  it('受信だけを採る製品でも、口(http-entry / composition-root)の置き場の宣言が無い配置は選択の段で止まる(下限 1。ジョブを採らず J2 が回らない構成の生成が黙って壊れる経路を消す)', () => {
    for (const role of ['http-entry', 'composition-root'] as const) {
      const without: Record<string, RoleDecl | undefined> = { ...TEST_LAYOUT };
      delete without[role];
      const problems = problemsOf([SUPABASE_TARGET, bare('no-entry', 'app_frame', { layout: without })]);
      expect(problems).toEqual([`後段 no-entry の配置: 役割 ${role}: 多重度の下限が 1 の役割なのに、配置に宣言がありません`]);
    }
  });

  it('H5 の検査(authConfig)を持てるのは platform の後段だけで、ID は H5', () => {
    const h5 = SUPABASE_TARGET.authConfig;
    if (h5 === undefined) throw new Error('Supabase の後段は H5 を登録する');
    expect(select([SUPABASE_TARGET]).ok).toBe(true);
    expect(problemsOf([SUPABASE_TARGET, bare('x', 'host', { authConfig: h5 })])).toEqual([
      '後段 x は役割が host なのに、H5 の検査(authConfig)を持っています(持てるのは platform の後段だけ)',
    ]);
    expect(problemsOf([barePlatformTarget(TEST_PLATFORM, []), bare('y', 'host', { authConfig: { ...h5, id: 'H9' as never } })])).toEqual([
      '後段 y は役割が host なのに、H5 の検査(authConfig)を持っています(持てるのは platform の後段だけ)',
      '後段 y の authConfig の ID が H9 です(H5 と書く)',
    ]);
  });

  it('verifyInputsOf は platform の後段が登録した H5 を渡す(登録しない後段なら null)', () => {
    const selected = select(TEST_TARGETS);
    if (!selected.ok) throw new Error('選べるはず');
    expect(verifyInputsOf(selected.selection).authConfig).toBe(SUPABASE_TARGET.authConfig);

    const bareSelected = select([barePlatformTarget(TEST_PLATFORM, [])]);
    if (!bareSelected.ok) throw new Error('選べるはず');
    expect(verifyInputsOf(bareSelected.selection).authConfig).toBeNull();
  });

  it('後段の名前の重なり', () => {
    expect(problemsOf([SUPABASE_TARGET, SUPABASE_TARGET]).join('\n')).toContain('後段の名前 supabase が重なっています');
  });

  it('口の表に無い検査 / 口の役割と違う後段が登録した検査 / 同じ口に 2 本', () => {
    const j2 = VERCEL_TARGET.verifiers.find((verifier) => verifier.id === 'J2');
    if (j2 === undefined) throw new Error('Vercel の後段は J2 を登録する');
    const unknown = { ...j2, id: 'J99' };
    expect(problemsOf([SUPABASE_TARGET, bare('x', 'host', { verifiers: [unknown] })])).toEqual([
      '後段 x が登録した検査 J99 は、口の表(JOB_CHECK_SLOTS)にありません',
    ]);
    // J2 はホストの口。プラットフォームの後段が登録しても当たらない。
    expect(problemsOf([barePlatformTarget(TEST_PLATFORM, [j2])])).toEqual([
      '後段 bare-platform(role: platform)が登録した検査 J2 は、role: host の後段が受け持つ口です',
    ]);
    // ホストは高々 1 つなので、同じ口に 2 本の登録は 2 つ目のホストの後段(多重度の違反)と一緒に出る。
    expect(problemsOf([SUPABASE_TARGET, VERCEL_TARGET, bare('second-host', 'host', { verifiers: [j2] })])).toEqual([
      'ホストの後段(role: host)は高々 1 つです(いま 2 つ)',
      '検査 J2 を後段 vercel と second-host の両方が登録しています(1 つの口に登録できるのは 1 本)',
    ]);
  });

  it('生成器の ID の重なり', () => {
    const problems = problemsOf([
      SUPABASE_TARGET,
      bare('a', 'host', { generators: [generator('g')] }),
      bare('b', 'app_frame', { generators: [generator('g')] }),
    ]);
    expect(problems).toEqual(['生成器 g を後段 a と b の両方が登録しています']);
  });
});

describe('selectTargetSet: 製品の宣言(実装の木の有無・生成物の置き場)との食い違い', () => {
  it('実装の木を宣言する製品は、アプリの枠の後段が 0 つなら選べない(配置が空のまま生成が黙って何も出さない構成を作らせない)', () => {
    expect(problemsOf([SUPABASE_TARGET, VERCEL_TARGET], WITH_APP)).toEqual([
      '製品が実装の木(roots.app: app)を宣言しているので、アプリの枠の後段(role: app_frame)がちょうど 1 つ要ります(いま 0 つ)',
    ]);
  });

  it('実装の木を宣言しない製品に、アプリの枠の後段を選ぶことはできない', () => {
    expect(problemsOf([SUPABASE_TARGET, NEXTJS_TARGET], NO_APP)).toEqual([
      '製品が実装の木(roots.app)を宣言していないのに、アプリの枠の後段 nextjs が選ばれています(実装の木の無い製品は、アプリの枠の後段を選ばない)',
    ]);
  });

  it('実装の木の有無と後段が合えば選べる(実装の木なし + アプリの枠なし = 空の配置)', () => {
    expect(select([SUPABASE_TARGET, NEXTJS_TARGET], WITH_APP).ok).toBe(true);
    const none = select([SUPABASE_TARGET], NO_APP);
    expect(none.ok && none.selection.layout).toEqual({});
  });

  it('生成物の置き場(roots.generated)が配置の source-root の中に無ければ選べない(外にある宣言)', () => {
    expect(problemsOf([SUPABASE_TARGET, NEXTJS_TARGET], { app: 'app', generated: 'elsewhere/generated' })).toEqual([
      '製品の roots.generated(elsewhere/generated)が、後段 nextjs の配置の source-root(app/src)の外にあります(生成物の置き場は実装のソースの根の中)',
    ]);
    // 兄弟に当たるだけの綴り(app/src2)も外。末尾の区切りは無視し、source-root そのものも中。
    expect(problemsOf([SUPABASE_TARGET, NEXTJS_TARGET], { app: 'app', generated: 'app/src2/generated' })).toHaveLength(1);
    expect(select([SUPABASE_TARGET, NEXTJS_TARGET], { app: 'app', generated: 'app/src/' }).ok).toBe(true);
    expect(select([SUPABASE_TARGET, NEXTJS_TARGET], { app: 'app', generated: 'app/src/domain/generated' }).ok).toBe(true);
  });

  it('包含はパスを正規化したあとで比べる(先頭の ./・重なった区切り・`..` の畳み込みは同じ。`..` で外へ出れば外)', () => {
    for (const generated of ['./app/src/domain/generated', 'app//src//domain/generated/', 'app/src/x/../domain/generated']) {
      expect(select([SUPABASE_TARGET, NEXTJS_TARGET], { app: 'app', generated }).ok, generated).toBe(true);
    }
    expect(problemsOf([SUPABASE_TARGET, NEXTJS_TARGET], { app: 'app', generated: 'app/src/../other' })).toHaveLength(1);
  });

  it('このリポジトリの宣言(product.md)は配置の source-root の中に生成物の置き場がある(全題材で成り立つ)', () => {
    expect(select(TEST_TARGETS, TEST_ROOTS).ok).toBe(true);
  });
});

describe('selectTargetSet: 役割の多重度(platform = ちょうど 1・host = 高々 1・app_frame = 高々 1)', () => {
  it('ホスト・アプリの枠は 0 つでも 1 つでも選べる', () => {
    expect(select([SUPABASE_TARGET]).ok).toBe(true);
    expect(select([SUPABASE_TARGET, VERCEL_TARGET]).ok).toBe(true);
    expect(select([SUPABASE_TARGET, bare('frame', 'app_frame')]).ok).toBe(true);
  });

  it('ホストの後段が 2 つ・アプリの枠の後段が 2 つは選べない(理由に役割と数が出る)', () => {
    expect(problemsOf([SUPABASE_TARGET, bare('h1', 'host'), bare('h2', 'host')])).toEqual(['ホストの後段(role: host)は高々 1 つです(いま 2 つ)']);
    expect(problemsOf([SUPABASE_TARGET, bare('f1', 'app_frame'), bare('f2', 'app_frame')])).toEqual(['アプリの枠の後段(role: app_frame)は高々 1 つです(いま 2 つ)']);
  });

  it('多重度の表は役割の一覧と同じ数だけある(役割を足した日に足し忘れない)・platform だけが必須', () => {
    expect(Object.keys(TARGET_ROLE_MULTIPLICITY).sort()).toEqual([...TARGET_ROLES].sort());
    expect(TARGET_ROLES.filter((role) => TARGET_ROLE_MULTIPLICITY[role].min > 0)).toEqual(['platform']);
    expect(TARGET_ROLES.map((role) => TARGET_ROLE_MULTIPLICITY[role].max)).toEqual([1, 1, 1]);
  });
});

describe('selectTargetSet: 対象外の宣言(notApplicable)', () => {
  const j4 = VERCEL_TARGET.verifiers.find((verifier) => verifier.id === 'J4');
  if (j4 === undefined) throw new Error('Vercel の後段は J4 を登録する');

  it('口の表にある ID・自分の役割が受け持つ口・理由つきなら選べる', () => {
    expect(select([SUPABASE_TARGET, bare('quiet', 'host', { notApplicable: { J4: '頻度の制約が無い' } })]).ok).toBe(true);
  });

  it('(iv) 対象外と宣言した口に検査も登録すれば契約の違反', () => {
    expect(problemsOf([SUPABASE_TARGET, bare('both', 'host', { verifiers: [j4], notApplicable: { J4: '理由' } })])).toEqual([
      '後段 both は J4 を対象外と宣言しているのに、同じ検査を登録しています(どちらかにする)',
    ]);
  });

  it('口の表に無い ID・別の役割の口・空の理由は契約の違反', () => {
    expect(problemsOf([SUPABASE_TARGET, bare('x', 'host', { notApplicable: { J99: '理由' } })])).toEqual([
      '後段 x が対象外と宣言した J99 は、口の表(JOB_CHECK_SLOTS)にありません',
    ]);
    expect(problemsOf([SUPABASE_TARGET, bare('x', 'host', { notApplicable: { J3: '理由' } })])).toEqual([
      '後段 x(role: host)が対象外と宣言した J3 は、role: platform の後段が受け持つ口です',
    ]);
    expect(problemsOf([SUPABASE_TARGET, bare('x', 'host', { notApplicable: { J4: '  ' } })])).toEqual([
      '後段 x の J4 の対象外の宣言に、理由がありません(理由つきでだけ宣言できる)',
    ]);
  });
});

describe('配置が持ち主として名指す生成器の実在', () => {
  /** コアの生成器の ID のうち、Cron の見張りテストを書く生成器(ホストの後段が登録する分)を除いたもの。 */
  const CORE_ONLY = new Set([...TEST_GENERATOR_IDS].filter((id) => id !== 'code-cron-route-tests'));

  it('ホストを選ばない(その生成器が登録されない)と、配置の持ち主が宙に浮くので選択で止まる', () => {
    expect(problemsOf([SUPABASE_TARGET, NEXTJS_TARGET], WITH_APP, CORE_ONLY)).toEqual([
      '後段 nextjs の配置の役割 cron-route-test: 持ち主の生成器 code-cron-route-tests が、組み立てた生成器の一覧(コアの生成器と選んだ後段の生成器)にありません',
    ]);
  });

  it('ホストの後段が生成器を登録していれば(コアの ID に無くても)実在として数える', () => {
    expect(select(TEST_TARGETS, WITH_APP, CORE_ONLY).ok).toBe(true);
  });

  it('コアの生成器の ID を 1 つも渡さなければ、配置が名指す生成器の全部が実在しないと言われる(ID が配置の宣言と食い違えば止まる)', () => {
    const problems = problemsOf([SUPABASE_TARGET, NEXTJS_TARGET], WITH_APP, new Set());
    expect(problems.length).toBeGreaterThan(10);
    expect(problems.every((problem) => problem.startsWith('後段 nextjs の配置の役割 '))).toBe(true);
  });
});

describe('登録の集め方', () => {
  it('検査は後段の役割をつけて集める(口に当てるときに役割を見るため)', () => {
    const registry = jobTargetsOf(TEST_TARGETS);
    expect(registry.checks.map((entry) => [entry.role, entry.check.id]).sort()).toEqual([
      ['host', 'J2'],
      ['host', 'J4'],
      ['platform', 'J3'],
    ]);
  });

  it('選んだ後段の名前・役割・対象外の宣言も集める(口が埋まらない理由を事実で言うため。宣言が無ければ空)', () => {
    const quiet = bare('quiet', 'host', { notApplicable: { J4: '理由' } });
    expect(jobTargetsOf([SUPABASE_TARGET, quiet]).targets).toEqual([
      { id: 'supabase', role: 'platform', notApplicable: {} },
      { id: 'quiet', role: 'host', notApplicable: { J4: '理由' } },
    ]);
  });

  it('生成器は後段の並び・後段の中の並びの順に集める', () => {
    const first = generator('first');
    const second = generator('second');
    const third = generator('third');
    const targets = [bare('a', 'host', { generators: [first, second] }), bare('b', 'app_frame', { generators: [third] })];
    expect(targetGenerators(targets).map((entry) => entry.id)).toEqual(['first', 'second', 'third']);
    expect(targetGenerators([])).toEqual([]);
  });
});
