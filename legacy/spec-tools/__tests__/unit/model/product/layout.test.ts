/**
 * 置き場の役割の契約(`lib/model/product/layout.ts`)のテスト。
 *
 * 固定するのは 4 点 —— ①役割 + キー → パスの解決(基準の役割を辿る・URL の表記ゆれをそろえる・解決できなければ null)
 * ②実装の木を持たない製品(`productRoot: null`)はどれも null ③配置そのものの契約の違反(多重度の形・持ち主と生成物か手書きかの食い違い・
 * 基準の循環ほか)が理由つきで返る ④Next.js の値(`NEXTJS_LAYOUT`)が契約を満たし、旧い口(`paths.ts` の `endpointRoutePath` ほか。③-c6 で消した)が組んでいたときと同じパスを返す
 * (並走させている間の一致)。
 */

import { describe, expect, it } from 'vitest';
import {
  appIconPath,
  compositionRootPath,
  EMPTY_LAYOUT,
  hasDotSegment,
  httpEntryPath,
  LAYOUT_CLASSIFIED_ROLES,
  LAYOUT_CLASSIFY_ROLES,
  layoutFoldedPlace,
  layoutKeyFits,
  layoutRoundTrips,
  layoutScan,
  LAYOUT_MODULE_ROLES,
  LAYOUT_ROLE_MIN,
  LAYOUT_ROLES,
  layoutModule,
  layoutPath,
  normalizeUrlPath,
  requestGatePath,
  sourceAliasOf,
  sourceRootPath,
  generatedModuleOf,
  pathWithin,
} from '../../../../lib/model/product/layout.js';
import { layoutDefinitionProblems, layoutRootsProblems, layoutSelectionProblems } from '../../../../lib/model/product/layout-definition.js';
import type { ProductLayout, RoleDecl } from '../../../../lib/model/product/layout.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../helpers/platform.js';

/** 役割の宣言を取り出す(無ければテストの書き間違い)。 */
function decl(layout: ProductLayout, role: keyof ProductLayout): RoleDecl {
  const found = layout[role];
  if (found === undefined) throw new Error(`配置に ${role} がありません`);
  return found;
}

describe('layoutPath: 役割 + キー → パス(基準の役割を辿る)', () => {
  it('製品の根 → ソースの根 → HTTP の入口 / 組み立ての根の順に辿る', () => {
    expect(layoutPath(TEST_LAYOUT, 'app', 'product-root')).toBe('app');
    expect(layoutPath(TEST_LAYOUT, 'app', 'source-root')).toBe('app/src');
    expect(layoutPath(TEST_LAYOUT, 'app', 'http-entry', '/api/jobs/run')).toBe('app/src/app/api/jobs/run/route.ts');
    expect(layoutPath(TEST_LAYOUT, 'app', 'composition-root', 'billing_hook')).toBe('app/src/composition/inbound/billing_hook.ts');
  });

  it('製品の根が空文字なら製品の根からの相対で返す(期待ファイル木のように、根の外を知らない呼び手)', () => {
    expect(layoutPath(TEST_LAYOUT, '', 'source-root')).toBe('src');
    expect(layoutPath(TEST_LAYOUT, '', 'http-entry', '/api/x')).toBe('src/app/api/x/route.ts');
  });

  it('実装の木を持たない製品(製品の根が null)は、どの役割も解決できない', () => {
    for (const role of ['product-root', 'source-root', 'http-entry', 'composition-root'] as const) {
      expect(layoutPath(TEST_LAYOUT, null, role, '/x'), role).toBeNull();
    }
  });

  it('宣言されていない役割・空の配置は解決できない(黙って別の場所にしない)', () => {
    expect(layoutPath(EMPTY_LAYOUT, 'app', 'source-root')).toBeNull();
    expect(layoutPath({ 'source-root': decl(TEST_LAYOUT, 'source-root') }, 'app', 'source-root')).toBeNull();
  });

  it('URL のパスの表記ゆれ(先頭の / が無い・末尾の /)は同じ位置になる。根の URL は空のパスで解く', () => {
    expect(normalizeUrlPath('/api/jobs/run')).toBe('/api/jobs/run');
    expect(normalizeUrlPath('api/jobs/run')).toBe('/api/jobs/run');
    expect(normalizeUrlPath('/api/jobs/run/')).toBe('/api/jobs/run');
    expect(normalizeUrlPath('/')).toBe('');
    expect(layoutPath(TEST_LAYOUT, 'app', 'http-entry', 'api/jobs/run/')).toBe('app/src/app/api/jobs/run/route.ts');
    expect(layoutPath(TEST_LAYOUT, 'app', 'http-entry', '/')).toBe('app/src/app/route.ts');
  });

  it('キーの形に合わないキー(キーを持たない役割にキー・キーが要る役割にキー無し・連携 ID に区切り)は解決できない', () => {
    expect(layoutPath(TEST_LAYOUT, 'app', 'source-root', 'x')).toBeNull();
    expect(layoutPath(TEST_LAYOUT, 'app', 'http-entry')).toBeNull();
    expect(layoutPath(TEST_LAYOUT, 'app', 'http-entry', '/api/has space')).toBeNull();
    expect(layoutPath(TEST_LAYOUT, 'app', 'composition-root', 'a/b')).toBeNull();
    expect(layoutPath(TEST_LAYOUT, 'app', 'composition-root', '')).toBeNull();
  });

  it('基準が辿れない(基準の役割が宣言されていない・循環)なら null(無限ループにしない)', () => {
    const noBase: ProductLayout = { 'http-entry': decl(TEST_LAYOUT, 'http-entry') };
    expect(layoutPath(noBase, 'app', 'http-entry', '/x')).toBeNull();
    const cyclic: ProductLayout = {
      ...TEST_LAYOUT,
      'source-root': { ...decl(TEST_LAYOUT, 'source-root'), base: 'http-entry' },
      'http-entry': { ...decl(TEST_LAYOUT, 'http-entry'), base: 'source-root' },
    };
    expect(layoutPath(cyclic, 'app', 'http-entry', '/x')).toBeNull();
  });

  it('別の配置を渡すと、その値で解く(Next.js の綴りは出ない)', () => {
    expect(layoutPath(FOREIGN_LAYOUT, 'app', 'source-root')).toBe('app/server_code');
    expect(layoutPath(FOREIGN_LAYOUT, 'app', 'http-entry', '/api/jobs/run')).toBe('app/server_code/endpoints/api/jobs/run.handler.ts');
    expect(layoutPath(FOREIGN_LAYOUT, 'app', 'composition-root', 'billing_hook')).toBe('app/server_code/wiring/webhooks/billing_hook.wire.ts');
  });
});

describe('layoutKeyFits: キーの形', () => {
  it('役割が宣言されていて、キーが形に合うときだけ true(パスが解決できない理由が「キーの形」かを言い分けるために使う)', () => {
    expect(layoutKeyFits(TEST_LAYOUT, 'http-entry', '/api/x')).toBe(true);
    expect(layoutKeyFits(TEST_LAYOUT, 'http-entry', '/has space')).toBe(false);
    expect(layoutKeyFits(TEST_LAYOUT, 'http-entry')).toBe(false);
    expect(layoutKeyFits(TEST_LAYOUT, 'source-root')).toBe(true);
    expect(layoutKeyFits(TEST_LAYOUT, 'source-root', 'x')).toBe(false);
    expect(layoutKeyFits(EMPTY_LAYOUT, 'source-root')).toBe(false);
  });
});

describe('layoutModule: import の指定', () => {
  it('配置が決める(キーの形はパスと同じに正規化する)。import されない役割・宣言の無い役割は null', () => {
    expect(layoutModule(TEST_LAYOUT, 'http-entry', '/api/jobs/run')).toBe('@/app/api/jobs/run/route');
    expect(layoutModule(TEST_LAYOUT, 'http-entry', 'api/jobs/run/')).toBe('@/app/api/jobs/run/route');
    expect(layoutModule(TEST_LAYOUT, 'composition-root', 'billing_hook')).toBe('@/composition/inbound/billing_hook');
    expect(layoutModule(FOREIGN_LAYOUT, 'http-entry', '/api/x')).toBe('~srv/endpoints/api/x.handler');
    expect(layoutModule(TEST_LAYOUT, 'product-root')).toBeNull();
    expect(layoutModule(EMPTY_LAYOUT, 'http-entry', '/x')).toBeNull();
    expect(layoutModule(TEST_LAYOUT, 'http-entry')).toBeNull();
  });
});

describe('実物の配置の解決(旧い口 `paths.ts` の `appSrcPath` / `endpointRoutePath` は部品化 ③-c6 で消えた。直書きのパスで固定する)', () => {
  it('HTTP の入口・ソースの根・受信口・受信の配線は、旧い組み方と同じパス', () => {
    for (const endpoint of ['/api/jobs/run', 'api/jobs/run']) {
      expect(httpEntryPath(TEST_LAYOUT, TEST_ROOTS, endpoint), endpoint).toBe('app/src/app/api/jobs/run/route.ts');
    }
    expect(httpEntryPath(TEST_LAYOUT, TEST_ROOTS, 'api/reviews/remind')).toBe('app/src/app/api/reviews/remind/route.ts');
    expect(sourceRootPath(TEST_LAYOUT, TEST_ROOTS)).toBe('app/src');
    expect(httpEntryPath(TEST_LAYOUT, TEST_ROOTS, '/api/inbound/billing_hook')).toBe('app/src/app/api/inbound/billing_hook/route.ts');
    expect(compositionRootPath(TEST_LAYOUT, TEST_ROOTS, 'billing_hook')).toBe('app/src/composition/inbound/billing_hook.ts');
    const noApp = { ...TEST_ROOTS, app: null };
    expect(httpEntryPath(TEST_LAYOUT, noApp, '/api/jobs/run')).toBeNull();
    expect(sourceRootPath(TEST_LAYOUT, noApp)).toBeNull();
  });
});

describe('sourceAliasOf: 閉包を辿る側が読む別名(綴りと行き先は配置が与える)', () => {
  it('配置の source-root の module(別名の綴り)と置き場(行き先)から作る', () => {
    expect(sourceAliasOf(TEST_LAYOUT, TEST_ROOTS)).toEqual({ prefix: '@/', dir: 'app/src' });
    expect(sourceAliasOf(FOREIGN_LAYOUT, { app: 'app' })).toEqual({ prefix: '~srv/', dir: 'app/server_code' });
  });

  it('実装の木が無い・配置に source-root が無い・module が無い(別名を持たない)ときは null', () => {
    expect(sourceAliasOf(TEST_LAYOUT, { app: null })).toBeNull();
    expect(sourceAliasOf(EMPTY_LAYOUT, TEST_ROOTS)).toBeNull();
    expect(sourceAliasOf({ ...TEST_LAYOUT, 'source-root': { ...decl(TEST_LAYOUT, 'source-root'), module: null } }, TEST_ROOTS)).toBeNull();
  });
});

describe('layoutDefinitionProblems: 配置そのものの契約', () => {
  it('Next.js の値・架空の値は契約を満たす(空の配置は、下限が 1 の役割を宣言していないので契約を満たさない — アプリの枠の後段ではなく、選ばれない側の値)', () => {
    expect(layoutDefinitionProblems(TEST_LAYOUT)).toEqual([]);
    expect(layoutDefinitionProblems(FOREIGN_BODY_COMPATIBLE_LAYOUT)).toEqual([]);
    // 下限が 1 の役割は全部、宣言が無いと定義の問題になる(語彙の順に並ぶ)。
    expect(layoutDefinitionProblems(EMPTY_LAYOUT)).toEqual(
      LAYOUT_ROLES.filter((role) => LAYOUT_ROLE_MIN[role] === 1).map((role) => `役割 ${role}: 多重度の下限が 1 の役割なのに、配置に宣言がありません`),
    );
  });

  it('多重度の下限(min): コアが決める役割ごとの下限(あるスタックにしか無い概念の 5 役割 = request-gate / app-icon / app-config / root-layout / session-refresh と、宣言した製品だけが使う認証基盤の操作の 4 役割を除いて 1)を下回れず、下限が 1 の役割は宣言が要る', () => {
    const stackOnly = new Set(['request-gate', 'app-icon', 'app-config', 'root-layout', 'session-refresh', 'platform-op-entry', 'platform-op-composition', 'platform-binding', 'platform-op-test']);
    expect(LAYOUT_ROLES.map((role) => LAYOUT_ROLE_MIN[role])).toEqual(LAYOUT_ROLES.map((role) => (stackOnly.has(role) ? 0 : 1)));
    const source = decl(TEST_LAYOUT, 'source-root');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'source-root': { ...source, multiplicity: { min: 0, max: 1, key: 'none' } } })).toEqual([
      '役割 source-root: 多重度の下限(min: 0)がコアの定める下限(1)を下回っています',
    ]);
    const withoutSource = { ...TEST_LAYOUT };
    delete (withoutSource as { 'source-root'?: RoleDecl })['source-root'];
    expect(layoutDefinitionProblems(withoutSource)).toContain('役割 source-root: 多重度の下限が 1 の役割なのに、配置に宣言がありません');
    // 受信だけを採る製品(ジョブを採らない)でも、口の置き場は宣言が要る(検査は緑のまま生成が止まる経路を、選択の段で止める)。
    const withoutEntry = { ...TEST_LAYOUT };
    delete (withoutEntry as { 'http-entry'?: RoleDecl })['http-entry'];
    expect(layoutDefinitionProblems(withoutEntry)).toContain('役割 http-entry: 多重度の下限が 1 の役割なのに、配置に宣言がありません');
    const withoutComposition = { ...TEST_LAYOUT };
    delete (withoutComposition as { 'composition-root'?: RoleDecl })['composition-root'];
    expect(layoutDefinitionProblems(withoutComposition)).toContain('役割 composition-root: 多重度の下限が 1 の役割なのに、配置に宣言がありません');
    // 下限を 0 に下げた宣言も定義の問題(アプリの枠の後段が下限を緩められない)。
    const entry0 = decl(TEST_LAYOUT, 'http-entry');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'http-entry': { ...entry0, multiplicity: { min: 0, max: 'many', key: 'url_path' } } })).toEqual([
      '役割 http-entry: 多重度の下限(min: 0)がコアの定める下限(1)を下回っています',
    ]);
  });

  it('下限 0 の役割(request-gate / app-icon)は、配置が宣言していなくても契約を満たす(そのスタックに無い概念を全部の後段に宣言させない)', () => {
    const without: Record<string, RoleDecl | undefined> = { ...TEST_LAYOUT };
    delete without['request-gate'];
    delete without['app-icon'];
    expect(layoutDefinitionProblems(without)).toEqual([]);
    expect(requestGatePath(without, TEST_ROOTS)).toBeNull();
    expect(appIconPath(without, TEST_ROOTS)).toBeNull();
  });

  it('逆引き(classify)を読む役割(画面の器・HTTP の入口・生成テストの 4 種・操作・保存点・フォーム・操作の本体・基盤の層・単発の操作の hooks)は classify が必須(無いと検査は走査できず、黙って全部スキップする)', () => {
    expect(LAYOUT_CLASSIFY_ROLES).toEqual([
      'screen-shell',
      'http-entry',
      'compute-example-test',
      'eq-test',
      'eq-save-test',
      'rls-test',
      'operation-entry',
      'operation-composition',
      'save-entry',
      'save-composition',
      'ui-component',
      'operation-logic',
      'infrastructure',
      'operation-hooks',
      'platform-op-entry',
      'platform-op-composition',
    ]);
    for (const role of LAYOUT_CLASSIFY_ROLES) {
      const own = decl(TEST_LAYOUT, role);
      const { classify: _classify, ...withoutClassify } = own;
      expect(layoutDefinitionProblems({ ...TEST_LAYOUT, [role]: withoutClassify })).toEqual([
        `役割 ${role}: 検査が逆引き(実在のファイル → キー)を読む役割なのに、逆引き(classify)がありません(無いと検査は実装の木を走査できず、黙って全部スキップする)`,
      ]);
    }
  });

  it('逆引きを持つ役割の一覧は、実際に classify を宣言する役割と同じ(一覧にだけある・実際だけにある、のどちらも無い)。走査の口の型は一覧の役割しか受け付けない', () => {
    for (const layout of [TEST_LAYOUT, FOREIGN_LAYOUT, FOREIGN_BODY_COMPATIBLE_LAYOUT]) {
      const declared = Object.entries(layout).flatMap(([role, own]) => (own?.classify === undefined ? [] : [role]));
      expect([...declared].sort()).toEqual([...LAYOUT_CLASSIFY_ROLES].sort());
    }
    // 一覧の役割は、どれも走査の根を引ける(型の絞り込みと値の一覧が同じ集合である)。
    for (const role of LAYOUT_CLASSIFIED_ROLES) {
      expect(LAYOUT_CLASSIFY_ROLES).toContain(role);
      expect(layoutScan(TEST_LAYOUT, 'app', role), role).not.toBeNull();
    }
  });

  it('import される役割(http-entry / composition-root / operation-composition / save-composition と、手書きの接続点の 8 役割)の module: 必須で、基準の役割の module に置き場(拡張子なし)を接いだ形と一致する', () => {
    expect(LAYOUT_MODULE_ROLES).toEqual([
      'http-entry',
      'composition-root',
      'operation-composition',
      'save-composition',
      'operation-hooks',
      'computes-module',
      'preflight-module',
      'shared-component',
      'auth-composition',
      'system-clock',
      'db-ports',
      'session-refresh',
      'platform-op-composition',
      'platform-binding',
    ]);
    const entry = decl(TEST_LAYOUT, 'http-entry');
    const composition = decl(TEST_LAYOUT, 'composition-root');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'http-entry': { ...entry, module: null } })).toEqual([
      '役割 http-entry: 生成物から import される役割なのに、module がありません',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'http-entry': { ...entry, module: (url) => `@/app${url}/handler` } })).toEqual([
      '役割 http-entry: module(@/app/sample/path/handler)が、基準の役割 source-root の module に置き場(拡張子なし)を接いだ形(@/app/sample/path/route)と一致しません',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'composition-root': { ...composition, module: (id) => `@/wiring/${id}` } })).toEqual([
      '役割 composition-root: module(@/wiring/sample_id)が、基準の役割 source-root の module に置き場(拡張子なし)を接いだ形(@/composition/inbound/sample_id)と一致しません',
    ]);
    // 操作・保存点の組み立ての根も同じ契約(部品化 ③-c4a): module が無い・置き場と食い違うと定義の問題。
    const operation = decl(TEST_LAYOUT, 'operation-composition');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'operation-composition': { ...operation, module: null } })).toEqual([
      '役割 operation-composition: 生成物から import される役割なのに、module がありません',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'save-composition': { ...decl(TEST_LAYOUT, 'save-composition'), module: (id) => `@/wiring/${id}` } })).toEqual([
      '役割 save-composition: module(@/wiring/sample_usecase.sample_save)が、基準の役割 source-root の module に置き場(拡張子なし)を接いだ形(@/composition/usecase/sample_usecase/sample_save)と一致しません',
    ]);
    // 基準の役割に module が無ければ、この役割の module の正しさを確かめられない(定義の問題)。
    const source = decl(TEST_LAYOUT, 'source-root');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'source-root': { ...source, module: null } })).toEqual([
      '役割 http-entry: 基準の役割 source-root に module が無く、この役割の module の正しさを確かめられません',
      '役割 composition-root: 基準の役割 source-root に module が無く、この役割の module の正しさを確かめられません',
      '役割 operation-composition: 基準の役割 source-root に module が無く、この役割の module の正しさを確かめられません',
      '役割 save-composition: 基準の役割 source-root に module が無く、この役割の module の正しさを確かめられません',
      ...['operation-hooks', 'computes-module', 'preflight-module', 'shared-component', 'auth-composition', 'system-clock', 'db-ports', 'session-refresh', 'platform-op-composition', 'platform-binding'].map(
        (role) => `役割 ${role}: 基準の役割 source-root に module が無く、この役割の module の正しさを確かめられません`,
      ),
    ]);
    // 手書きの接続点(部品化 ③-e1)も同じ契約: module が無い・置き場と食い違うと定義の問題。
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'system-clock': { ...decl(TEST_LAYOUT, 'system-clock'), module: null } })).toEqual([
      '役割 system-clock: 生成物から import される役割なのに、module がありません',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'computes-module': { ...decl(TEST_LAYOUT, 'computes-module'), module: (ref) => `@/pure/${ref}` } })).toEqual([
      '役割 computes-module: module(@/pure/sample_name)が、基準の役割 source-root の module に置き場(拡張子なし)を接いだ形(@/domain/computes/sample_name)と一致しません',
    ]);
  });

  it('多重度の形(1 つだけなのにキー・複数なのにキー無し)・持ち主なし', () => {
    const entry = decl(TEST_LAYOUT, 'http-entry');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'http-entry': { ...entry, multiplicity: { min: 1, max: 1, key: 'url_path' } } })).toEqual([
      '役割 http-entry: 多重度が 1 つだけなのにキーの形(url_path)を持っています',
    ]);
    // キーの形が none だと、逆引きの往復の見本(キー無し)も戻らない(逆引きを持つ役割なので、形の誤りが往復の食い違いとしても出る)。
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'http-entry': { ...entry, multiplicity: { min: 1, max: 'many', key: 'none' } } })).toEqual([
      '役割 http-entry: キーごとに複数なのに、キーの形がありません',
      '役割 http-entry: 置き場(place)と逆引き(classify)が食い違います(キーの見本 (なし) が、置き場 → 逆引きで同じキーに戻りません)',
      // 土台の表がこの役割を名指しているので、キーの形が壊れた役割は表の側からも指される(形の誤りの連鎖)。
      '土台 app/api/inbound: 書き込む役割 http-entry のキーの見本 /api/inbound/sample_id が、役割のキーの形に合いません',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'http-entry': { ...entry, owners: [] } })).toContain('役割 http-entry: 持ち主がありません');
  });

  it('生成物か手書きかと持ち主の食い違い(generated に手書きの持ち主・handwritten に生成器・mixed なのに片方だけ)', () => {
    const entry = decl(TEST_LAYOUT, 'http-entry');
    const composition = decl(TEST_LAYOUT, 'composition-root');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'http-entry': { ...entry, origin: 'generated' } })).toEqual([
      '役割 http-entry: 生成物(generated)なのに、生成器以外の持ち主がいます',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'composition-root': { ...composition, origin: 'handwritten' } })).toEqual([
      '役割 composition-root: 手書き(handwritten)なのに、生成器の持ち主がいます',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'composition-root': { ...composition, origin: 'mixed' } })).toEqual([
      '役割 composition-root: 混在(mixed)なのに、生成器と手書きの両方の持ち主がいません',
    ]);
  });

  it('製品の宣言が持ち主の役割だけが place を持たない・書く側は持ち主の生成器に含まれる・読み書きの条件は空でない', () => {
    const root = decl(TEST_LAYOUT, 'product-root');
    const entry = decl(TEST_LAYOUT, 'http-entry');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'product-root': { ...root, place: () => 'x' } })).toEqual([
      '役割 product-root: 製品の宣言が持ち主の役割だけが `place` を持たず(null)、それ以外は `place` が要ります',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'http-entry': { ...entry, place: null } })).toContain(
      '役割 http-entry: 製品の宣言が持ち主の役割だけが `place` を持たず(null)、それ以外は `place` が要ります',
    );
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'http-entry': { ...entry, access: { ...entry.access, writers: ['unknown-gen'] } } })).toEqual([
      '役割 http-entry: 書く側 unknown-gen が、持ち主の生成器に含まれていません',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'http-entry': { ...entry, access: { ...entry.access, when: ' ' } } })).toEqual([
      '役割 http-entry: 読み書きの条件が空です',
    ]);
  });

  it('基準: 宣言されていない・キーを持つ・循環', () => {
    const entry = decl(TEST_LAYOUT, 'http-entry');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'source-root': undefined } as unknown as ProductLayout)).toContain('役割 http-entry: 基準の役割 source-root が宣言されていません');
    expect(layoutDefinitionProblems({ 'http-entry': entry })).toContain('役割 http-entry: 基準の役割 source-root が宣言されていません');
    const keyedBase = layoutDefinitionProblems({
      ...TEST_LAYOUT,
      'composition-root': { ...decl(TEST_LAYOUT, 'composition-root'), base: 'http-entry' },
    });
    expect(keyedBase).toContain('役割 composition-root: 基準の役割 http-entry がキーを持っています(基準はキーを持たない 1 つだけの役割)');
    const cyclic = layoutDefinitionProblems({
      ...TEST_LAYOUT,
      'source-root': { ...decl(TEST_LAYOUT, 'source-root'), base: 'http-entry' },
    });
    expect(cyclic.join('\n')).toContain('基準をたどると循環します');
  });

  it('製品の宣言が決める役割は基準を持てない', () => {
    const root = decl(TEST_LAYOUT, 'product-root');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'product-root': { ...root, base: 'source-root' } })).toContain(
      '役割 product-root: 製品の宣言が決める役割は、基準を持てません(リポジトリルートからの相対)',
    );
  });
});

describe('画面の器まわりの役割(部品化 ③-c2)', () => {
  it('キーの形 file_name は区切り・空白を含まないファイル名だけを受ける(画面の部品・画面テスト)', () => {
    expect(layoutPath(TEST_LAYOUT, 'app', 'screen-part', 'a.b.tsx')).toBe('app/src/app/_screens/generated/a.b.tsx');
    expect(layoutKeyFits(TEST_LAYOUT, 'screen-part', 'a.b.tsx')).toBe(true);
    for (const bad of ['', 'a/b.tsx', 'a b.tsx']) expect(layoutKeyFits(TEST_LAYOUT, 'screen-part', bad), bad).toBe(false);
    expect(layoutKeyFits(TEST_LAYOUT, 'screen-part', undefined)).toBe(false);
    expect(layoutPath(TEST_LAYOUT, 'app', 'screen-part', 'a/b.tsx')).toBeNull();
  });

  it('キーを持たない役割(リクエスト前段・既定のアイコン)はキー無しだけを受ける', () => {
    expect(layoutPath(TEST_LAYOUT, 'app', 'request-gate')).toBe('app/src/proxy.ts');
    expect(layoutPath(TEST_LAYOUT, 'app', 'app-icon')).toBe('app/src/app/favicon.ico');
    expect(layoutPath(TEST_LAYOUT, 'app', 'request-gate', 'x')).toBeNull();
  });

  it('layoutScan: 走査の根とその下の逆引きを返す(逆引きを持たない役割・実装の木が無いときは null)', () => {
    const scan = layoutScan(TEST_LAYOUT, 'app', 'screen-shell');
    expect(scan?.dir).toBe('app/src/app');
    expect(scan?.keyOf('workshops/[id]/page.tsx')).toBe('/workshops/:id');
    expect(scan?.keyOf('workshops/parts.tsx')).toBeNull();
    expect(layoutScan(FOREIGN_LAYOUT, 'app', 'screen-shell')?.dir).toBe('app/server_code/pages');
    // 逆引きを持たない役割は、走査の口の型が受け付けない(逆引きを読む呼び出し元は、必須の一覧 `LAYOUT_CLASSIFY_ROLES` に入っている役割だけ)。
    // @ts-expect-error request-gate は逆引きを持つ役割ではない
    expect(layoutScan(TEST_LAYOUT, 'app', 'request-gate')).toBeNull();
    expect(layoutScan(TEST_LAYOUT, null, 'screen-shell')).toBeNull();
    expect(layoutScan(EMPTY_LAYOUT, 'app', 'screen-shell')).toBeNull();
    // 基準の役割が辿れない配置では走査の根も決まらない。
    expect(layoutScan({ 'screen-shell': decl(TEST_LAYOUT, 'screen-shell') }, 'app', 'screen-shell')).toBeNull();
  });

  it('layoutScan: 逆引きが入口のファイルの判定(entryOf)を宣言していれば、そのまま運ぶ。宣言していなければ持たない', () => {
    const entry = decl(TEST_LAYOUT, 'http-entry');
    if (entry.classify === undefined) throw new Error('テストの前提が壊れています: http-entry が逆引きを持たない');
    const isEntry = (relative: string): boolean => relative.endsWith('.handler.ts');
    const withEntryOf: ProductLayout = { ...TEST_LAYOUT, 'http-entry': { ...entry, classify: { ...entry.classify, entryOf: isEntry } } };
    const withoutEntryOf: ProductLayout = { ...TEST_LAYOUT, 'http-entry': { ...entry, classify: { dir: entry.classify.dir, keyOf: entry.classify.keyOf } } };

    expect(layoutScan(withEntryOf, 'app', 'http-entry')?.entryOf).toBe(isEntry);
    expect(layoutScan(withoutEntryOf, 'app', 'http-entry')).not.toHaveProperty('entryOf');
    expect(layoutScan(TEST_LAYOUT, 'app', 'screen-shell')).not.toHaveProperty('entryOf');
  });

  it('layoutRoundTrips: 置き場 → 逆引きで同じキーに戻る(辿れないキー・形に合わないキー・基準が辿れない配置は戻らない。逆引きの無い役割は常に true)', () => {
    expect(layoutRoundTrips(TEST_LAYOUT, 'screen-shell', '/')).toBe(true);
    expect(layoutRoundTrips(TEST_LAYOUT, 'screen-shell', '/workshops/:id')).toBe(true);
    expect(layoutRoundTrips(FOREIGN_LAYOUT, 'screen-shell', '/workshops/:id')).toBe(true);
    expect(layoutRoundTrips(TEST_LAYOUT, 'screen-shell', '/_x')).toBe(false);
    expect(layoutRoundTrips(TEST_LAYOUT, 'screen-shell', '/a b')).toBe(false);
    expect(layoutRoundTrips({ 'screen-shell': decl(TEST_LAYOUT, 'screen-shell') }, 'screen-shell', '/')).toBe(false);
    expect(layoutRoundTrips(TEST_LAYOUT, 'composition-root', 'anything')).toBe(true);
  });

  it('配置の定義の検査: 語彙に無い役割・語彙に無いキーの形・逆引きと置き場の食い違い・製品の宣言が決める役割の逆引き・空の走査の根', () => {
    const shell = decl(TEST_LAYOUT, 'screen-shell');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'made-up-role': shell })).toEqual([
      `役割 made-up-role: コアの語彙(${LAYOUT_ROLES.join(' / ')})に無い役割です`,
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'request-gate': { ...decl(TEST_LAYOUT, 'request-gate'), multiplicity: { min: 1, max: 1, key: 'made_up' } } })).toContain(
      '役割 request-gate: キーの形 made_up が、コアの語彙(none / url_path / integration_id / file_name / operation_id / spec_name / save_id / relative_path)に無い形です',
    );
    // 逆引きが別の綴りを前提にしていると、置き場 → 逆引きが往復しない(`module` の契約と同じ形で、別々に書かれた 2 本の食い違いを止める)。
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'screen-shell': { ...shell, classify: { dir: 'app', keyOf: () => null } } })).toEqual([
      '役割 screen-shell: 置き場(place)と逆引き(classify)が食い違います(キーの見本 /sample/path が、置き場 → 逆引きで同じキーに戻りません)',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'screen-shell': { ...shell, classify: { dir: 'elsewhere', keyOf: () => '/sample/path' } } })).toEqual([
      '役割 screen-shell: 置き場(place)と逆引き(classify)が食い違います(キーの見本 /sample/path が、置き場 → 逆引きで同じキーに戻りません)',
    ]);
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'screen-shell': { ...shell, classify: { dir: ' ', keyOf: () => null } } })).toEqual([
      '役割 screen-shell: 逆引きの走査の根(dir)が空です',
    ]);
    const root = decl(TEST_LAYOUT, 'product-root');
    expect(layoutDefinitionProblems({ ...TEST_LAYOUT, 'product-root': { ...root, classify: { dir: 'x', keyOf: () => null } } })).toEqual([
      '役割 product-root: 製品の宣言が決める役割は、逆引き(classify)を持てません',
    ]);
  });
});

describe('HTTP の入口の逆引きと畳んだ名前(部品化 ③-c2b)', () => {
  it('http-entry も往復を見る: ルーティングに使わない名前(_)・パラレルルート(@)・ルートグループ((g))・動的なセグメント([x])の下の URL は戻らない', () => {
    expect(layoutRoundTrips(TEST_LAYOUT, 'http-entry', '/api/jobs/run')).toBe(true);
    expect(layoutRoundTrips(TEST_LAYOUT, 'http-entry', '/')).toBe(true);
    for (const url of ['/_cron/x', '/(g)/x', '/@a/x', '/[x]/y', '/(.)x', '/a/[...rest]']) {
      expect(layoutRoundTrips(TEST_LAYOUT, 'http-entry', url), url).toBe(false);
    }
    expect(layoutRoundTrips(FOREIGN_LAYOUT, 'http-entry', '/api/jobs/run')).toBe(true);
  });

  it('URL のパスの `.` / `..` のセグメントはキーの形に合わない(仕様の誤り。置き場が親ディレクトリへ出る)', () => {
    expect(hasDotSegment('/a/../b')).toBe(true);
    expect(hasDotSegment('/a/./b')).toBe(true);
    expect(hasDotSegment('/..')).toBe(true);
    expect(hasDotSegment('/a/b..c/.d')).toBe(false);
    expect(httpEntryPath(TEST_LAYOUT, TEST_ROOTS, '/a/../b')).toBeNull();
    expect(layoutKeyFits(TEST_LAYOUT, 'http-entry', '/a/./b')).toBe(false);
    expect(layoutKeyFits(TEST_LAYOUT, 'screen-shell', '/../x')).toBe(false);
    expect(layoutKeyFits(TEST_LAYOUT, 'http-entry', '/a/b..c')).toBe(true);
  });

  it('layoutFoldedPlace: ルーティングの規約で同じ実体になる置き場は同じ名前に畳まれ、同じ走査の根を取る別の役割(page と route)も同じ名前になる', () => {
    // `/(g)/x` はルートグループで消えるので `/x` と同じ名前に畳まれる(往復は戻らない = not_reachable)。非公開・動的な名前の下は畳めない。
    expect(layoutFoldedPlace(TEST_LAYOUT, 'http-entry', '/(g)/x')).toBe(layoutFoldedPlace(TEST_LAYOUT, 'http-entry', '/x'));
    expect(layoutFoldedPlace(TEST_LAYOUT, 'screen-shell', '/(g)/x')).toBe(layoutFoldedPlace(TEST_LAYOUT, 'screen-shell', '/x'));
    expect(layoutFoldedPlace(TEST_LAYOUT, 'http-entry', '/_cron/x')).toBeNull();
    expect(layoutFoldedPlace(TEST_LAYOUT, 'http-entry', '/[x]/y')).toBeNull();
    expect(layoutFoldedPlace(TEST_LAYOUT, 'http-entry', '/x')).toBe('src/app::/x');
    expect(layoutFoldedPlace(TEST_LAYOUT, 'screen-shell', '/x')).toBe('src/app::/x');
    expect(layoutFoldedPlace(TEST_LAYOUT, 'screen-shell', '/x/')).toBe('src/app::/x');
    // 逆引きを持たない役割・宣言の無い役割・実装の木に無いキーは畳めない。
    expect(layoutFoldedPlace(TEST_LAYOUT, 'composition-root', 'stripe')).toBeNull();
    expect(layoutFoldedPlace(EMPTY_LAYOUT, 'http-entry', '/x')).toBeNull();
    // 架空の配置では走査の根が別なので、同じキーでも名前を共有しない(別の空間)。
    expect(layoutFoldedPlace(FOREIGN_LAYOUT, 'http-entry', '/x')).not.toBe(layoutFoldedPlace(FOREIGN_LAYOUT, 'screen-shell', '/x'));
  });
});

describe('layoutRootsProblems / layoutSelectionProblems: 選択の契約(roots.generated が source-root の中)', () => {
  const roots = (generated: string): { readonly app: string | null; readonly generated: string } => ({ app: 'app', generated });

  it('パスを正規化して比べる(先頭の ./・重なった区切り・末尾の区切り・`..` の畳み込みは同じ)', () => {
    for (const generated of ['app/src/domain/generated', './app/src/domain/generated', 'app//src/domain/generated/', 'app/src/x/../domain/generated', 'app/src', 'app/src/']) {
      expect(layoutRootsProblems(TEST_LAYOUT, roots(generated)), generated).toEqual([]);
    }
  });

  it('source-root の外(兄弟に当たるだけの綴り・別の木・`..` で外へ出る綴り)は違反', () => {
    for (const generated of ['app/src2/domain', 'elsewhere/generated', 'app/src/../other', 'app']) {
      expect(layoutRootsProblems(TEST_LAYOUT, roots(generated)), generated).toEqual([
        `製品の roots.generated(${generated})が、配置の source-root(app/src)の外にあります(生成物の置き場は実装のソースの根の中)`,
      ]);
    }
    expect(layoutRootsProblems(TEST_LAYOUT, roots('x'), '後段 nextjs の配置の')[0]).toContain('が、後段 nextjs の配置の source-root(app/src)の外');
  });

  it('前後の空白つきの綴りは外にあるものとして赤にする(書き出す先のパスも空白つきのままなので、包含だけ trim で比べない)', () => {
    for (const generated of [' app/src/g', ' app/src', '\tapp/src/g']) {
      expect(layoutRootsProblems(TEST_LAYOUT, roots(generated)), generated).toHaveLength(1);
      expect(generatedModuleOf(TEST_LAYOUT, roots(generated), 'x'), generated).toBeNull();
    }
  });

  it('選択の検査が通る roots.generated は、指定の導出も必ず引ける(2 つが食い違わない)', () => {
    for (const generated of ['app/src/domain/generated', './app/src/domain/generated', 'app//src/domain/generated/', 'app/src', 'app/src/', './app/src/']) {
      expect(layoutRootsProblems(TEST_LAYOUT, roots(generated)), generated).toEqual([]);
      expect(generatedModuleOf(TEST_LAYOUT, roots(generated), 'x'), generated).not.toBeNull();
    }
    expect(generatedModuleOf(TEST_LAYOUT, roots('app/src'), 'x')).toBe('@/x');
    expect(generatedModuleOf(TEST_LAYOUT, roots('app/src/domain/generated/'), 'x')).toBe('@/domain/generated/x');
    expect(generatedModuleOf(TEST_LAYOUT, roots('app/src2/domain'), 'x')).toBeNull();
    expect(generatedModuleOf(TEST_LAYOUT, roots('app/src/domain'), '')).toBeNull();
  });

  it('pathWithin: 基準の中の相対(同じ場所は空文字)・外と兄弟に当たるだけの綴りは null', () => {
    expect(pathWithin('app/src', 'app/src')).toBe('');
    expect(pathWithin('./app/src/', 'app//src/x/../y/')).toBe('y');
    expect(pathWithin('app/src', 'app/src2')).toBeNull();
    expect(pathWithin('app/src', 'app/../x')).toBeNull();
    expect(pathWithin('', 'x/y')).toBe('x/y');
    expect(pathWithin('', '../x')).toBeNull();
    expect(pathWithin('', '/abs')).toBeNull();
  });

  it('実装の木を宣言していない・配置に source-root が無いときは、見る相手が無いので何も言わない', () => {
    expect(layoutRootsProblems(TEST_LAYOUT, { app: null, generated: 'x' })).toEqual([]);
    expect(layoutRootsProblems(EMPTY_LAYOUT, roots('x'))).toEqual([]);
  });

  it('layoutSelectionProblems は配置そのものの契約と包含の両方を 1 本で返す', () => {
    expect(layoutSelectionProblems(TEST_LAYOUT, roots('app/src/domain/generated'))).toEqual([]);
    const withoutEntry: Record<string, RoleDecl | undefined> = { ...TEST_LAYOUT };
    delete withoutEntry['http-entry'];
    expect(layoutSelectionProblems(withoutEntry, roots('elsewhere'))).toEqual([
      '役割 http-entry: 多重度の下限が 1 の役割なのに、配置に宣言がありません',
      '製品の roots.generated(elsewhere)が、配置の source-root(app/src)の外にあります(生成物の置き場は実装のソースの根の中)',
    ]);
  });
});
