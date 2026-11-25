import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkLayering } from '../../../lib/gates/layer-check.js';
import type { LayerTable } from '../../../lib/gates/layer-check.js';
import { EDGE_BANS, IO_MODULES, IO_ROWS, LAYER_RANK, LAYER_ROWS, TARGET_BOUNDARIES } from '../../../lib/gates/lib-layers.js';
import { readTsTree } from '../../../lib/io/read-ts-tree.js';

/**
 * **`lib/targets/<後段>/**` を import してよいのは組み立ての根(`cli/`)だけ**(C28 の続き。設計メモ framework-modules §20。
 * 新しいルール ID は足さない)。コアから後段への辺は 0 で、後段どうしも読まない。
 *
 * 後段の置き場は層の表で `target`(contract の上・orch と同順位)に置かれ、コアが決めた契約(設定の型・検査の契約・生成器の契約・
 * 後段の登録の契約 `lib/target-api/`)を読む向きだけが層の向きで通る(検証の束ね・変異・差分は読めない)。辺の許可はここが絞る。
 * 値を選ぶのは根の 1 回だけで、コアは引数で受け取る。
 */

const LIB_DIR = fileURLToPath(new URL('../../../lib/', import.meta.url));
const CLI_DIR = fileURLToPath(new URL('../../../cli/', import.meta.url));

/** 本番の表(後段の境界つき)。 */
const TABLE: LayerTable = { rank: LAYER_RANK, rows: LAYER_ROWS, ioRows: IO_ROWS, ioModules: IO_MODULES, rootPrefix: ['lib/', 'cli/'], targets: TARGET_BOUNDARIES, edgeBans: EDGE_BANS };

/** 本文の写しを作る。 */
function tree(files: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  return new Map(Object.entries(files));
}

/** 後段の辺の違反の鍵だけを返す(本番の表)。 */
function targetKeys(files: Readonly<Record<string, string>>): readonly string[] {
  return checkLayering(tree(files), TABLE).violations.filter((violation) => violation.category === 'target').map((violation) => violation.key);
}

/** 後段の値の入口と、それが読む契約(型)の最小の木。 */
const PROFILE = {
  'lib/targets/supabase/platform-profile.ts': "import type { PlatformProfile } from '../../model/product/platform-profile.js';\nexport const P: PlatformProfile = { x: 1 };",
  'lib/model/product/platform-profile.ts': 'export interface PlatformProfile { readonly x: number }',
} as const;

describe('lib と cli の実物', () => {
  const sources = new Map([...readTsTree(LIB_DIR, 'lib/'), ...readTsTree(CLI_DIR, 'cli/')]);
  const report = checkLayering(sources, TABLE);

  it('後段の置き場を読む辺はあり(空振りでない)、根(cli/)と置き場の中だけから来る。コアから後段への辺は 0', () => {
    const into = report.graph.edges.filter((edge) => edge.to.startsWith('lib/targets/'));
    expect(into.length).toBeGreaterThan(0);
    expect(into.filter((edge) => !edge.from.startsWith('cli/') && !edge.from.startsWith('lib/targets/'))).toEqual([]);
    expect(report.violations.filter((violation) => violation.category === 'target')).toEqual([]);
  });

  it('後段は 3 つ(プラットフォーム supabase・ホスト vercel・アプリの枠 nextjs)で、いずれも後段の登録の契約(target-api)を読む。契約は後段を読まない', () => {
    const owners = new Set(sources.keys());
    for (const file of ['lib/targets/nextjs/target.ts', 'lib/targets/supabase/target.ts', 'lib/targets/vercel/target.ts']) expect(owners.has(file), file).toBe(true);
    const toContract = report.graph.edges.filter((edge) => edge.to === 'lib/target-api/contract.ts');
    expect(toContract.map((edge) => edge.from).filter((from) => from.startsWith('lib/targets/')).sort()).toEqual(['lib/targets/nextjs/target.ts', 'lib/targets/supabase/target.ts', 'lib/targets/vercel/target.ts']);
    expect(report.graph.edges.filter((edge) => edge.from.startsWith('lib/target-api/') && edge.to.startsWith('lib/targets/'))).toEqual([]);
  });

  it('検査の束ね役(lib/verify/** と lib/compose/verify-pipeline*.ts)は後段の登録の契約(lib/target-api/**)を読まない(辺の禁止 EDGE_BANS。型だけの import も)', () => {
    const bundlers = [...sources.keys()].filter((file) => EDGE_BANS.some((ban) => ban.from.test(file)));
    // 空振りでない: 束ね役の本体(組み立ての根に移った 2 本)も、束ねの木(lib/verify/**)も、辺を持つ。
    for (const file of ['lib/compose/verify-pipeline.ts', 'lib/compose/verify-pipeline-groups.ts']) {
      expect(bundlers, file).toContain(file);
      expect(report.graph.edges.filter((edge) => edge.from === file).length, file).toBeGreaterThan(0);
    }
    expect(report.graph.edges.filter((edge) => edge.from.startsWith('lib/verify/')).length).toBeGreaterThan(0);
    expect(report.graph.edges.filter((edge) => bundlers.includes(edge.from) && edge.to.startsWith('lib/target-api/'))).toEqual([]);
    expect(report.violations.filter((violation) => violation.category === 'edge')).toEqual([]);
    // 契約を読む側は実在する(契約が孤立していない)ので、上の 0 は「そもそも誰も読まない」ことの帰結ではない。
    expect(report.graph.edges.filter((edge) => edge.to.startsWith('lib/target-api/')).length).toBeGreaterThan(0);
  });

  it('後段の置き場の直下にファイルは無い(後段は必ずディレクトリ)', () => {
    expect(report.looseTargetFiles).toEqual([]);
  });

  it('後段の置き場は層の表に当たり(未割り付け 0)、コアの契約(型)を読む向きは層の向きに反しない', () => {
    expect(report.unassigned).toEqual([]);
    const own = report.graph.edges.filter((edge) => edge.from.startsWith('lib/targets/'));
    expect(own.length).toBeGreaterThan(0);
    expect(report.violations.filter((violation) => violation.category === 'layer' && violation.key.startsWith('lib/targets/'))).toEqual([]);
  });
});

describe('わざと壊す確認: 束ね役が契約を読む辺', () => {
  const CONTRACT = { 'lib/target-api/contract.ts': 'export interface Target { readonly id: string }' };
  const edgeKeys = (files: Readonly<Record<string, string>>): readonly string[] =>
    checkLayering(tree({ ...CONTRACT, ...files }), TABLE).violations.filter((violation) => violation.category === 'edge').map((violation) => violation.key);

  it('束ね役の本体(組み立ての根の 2 本)と束ねの木(lib/verify/**)が契約を読むと赤(値でも型でも副作用でも)', () => {
    for (const from of ['lib/compose/verify-pipeline.ts', 'lib/compose/verify-pipeline-groups.ts', 'lib/verify/x.ts']) {
      const toContract = '../target-api/contract.js';
      for (const line of [`import { selectTargetSet } from '${toContract}';\nexport const t = selectTargetSet;`, `import type { Target } from '${toContract}';\nexport type T = Target;`, `import '${toContract}';`]) {
        expect(edgeKeys({ [from]: line }), `${from}: ${line}`).toEqual([`${from} → lib/target-api/contract.ts`]);
      }
    }
  });

  it('束ね役でない組み立ての根(生成器の一覧・CLI)が契約を読むのは緑(選んだ後段の合成は根の仕事)', () => {
    const line = "import type { Target } from '../target-api/contract.js';\nexport type T = Target;";
    expect(edgeKeys({ 'lib/compose/all-generators.ts': line })).toEqual([]);
    expect(edgeKeys({ 'cli/select-targets.ts': line.replace('../target-api', '../lib/target-api') })).toEqual([]);
  });

  it('辺の禁止を宣言しない表では何も見ない', () => {
    const { edgeBans: _edgeBans, ...none } = TABLE;
    const files = { ...CONTRACT, 'lib/compose/verify-pipeline.ts': "import type { Target } from '../target-api/contract.js';\nexport type T = Target;" };
    expect(checkLayering(tree(files), none).violations.filter((violation) => violation.category === 'edge')).toEqual([]);
  });
});

describe('わざと壊す確認: 置き場の直下のファイル', () => {
  const loose = (files: Readonly<Record<string, string>>): readonly string[] => checkLayering(tree(files), TABLE).looseTargetFiles;

  it('lib/targets/ の直下にファイルを置くと赤(どの後段にも属さず、辺の境界をすり抜けるため)', () => {
    expect(loose({ ...PROFILE, 'lib/targets/helper.ts': 'export const h = 1;' })).toEqual(['lib/targets/helper.ts']);
  });

  it('後段のディレクトリの下(深さを問わない)なら赤にならない', () => {
    expect(loose({ ...PROFILE, 'lib/targets/supabase/samples/a.ts': 'export const a = 1;' })).toEqual([]);
  });

  it('直下のファイルは辺の境界をすり抜ける実例: コアから読めてしまう(だから別に止める)', () => {
    expect(targetKeys({ ...PROFILE, 'lib/targets/helper.ts': 'export const h = 1;', 'lib/sql/x.ts': "import { h } from '../targets/helper.js';\nexport const x = h;" })).toEqual([]);
  });
});

describe('わざと壊す確認: 後段への辺', () => {
  it('根(cli/)が後段を読むのは正しい向き', () => {
    expect(targetKeys({ ...PROFILE, 'cli/run.ts': "import { P } from '../lib/targets/supabase/platform-profile.js';\nexport const p = P;" })).toEqual([]);
  });

  it('コアの層(sql・生成・検証・世界・前段)が後段を読むと赤(値も型も)', () => {
    for (const from of ['lib/sql/x.ts', 'lib/generate/x.ts', 'lib/verify/x.ts', 'lib/world/x.ts', 'lib/model/x.ts', 'lib/gates/x.ts']) {
      const toDeep = '../targets/supabase/platform-profile.js';
      expect(targetKeys({ ...PROFILE, [from]: `import { P } from '${toDeep}';\nexport const p = P;` }), from).toEqual([`${from} → lib/targets/supabase/platform-profile.ts`]);
      expect(targetKeys({ ...PROFILE, [from]: `import type { P } from '${toDeep}';\nexport type T = typeof P;` }), `${from}(型)`).toEqual([`${from} → lib/targets/supabase/platform-profile.ts`]);
    }
  });

  it('副作用 import・動的 import・export … from も辺になる', () => {
    const files = (line: string) => ({ ...PROFILE, 'lib/sql/x.ts': line });
    for (const line of ["import '../targets/supabase/platform-profile.js';", "export { P } from '../targets/supabase/platform-profile.js';", "export const load = () => import('../targets/supabase/platform-profile.js');"]) {
      expect(targetKeys(files(line)), line).toEqual(['lib/sql/x.ts → lib/targets/supabase/platform-profile.ts']);
    }
  });

  it('後段どうしも読まない。同じ後段の中どうしは自由', () => {
    expect(targetKeys({ ...PROFILE, 'lib/targets/other/y.ts': "import { P } from '../supabase/platform-profile.js';\nexport const y = P;" })).toEqual([
      'lib/targets/other/y.ts → lib/targets/supabase/platform-profile.ts',
    ]);
    expect(targetKeys({ ...PROFILE, 'lib/targets/supabase/b.ts': "import { P } from './platform-profile.js';\nexport const b = P;" })).toEqual([]);
  });

  it('境界を宣言しない表では何も見ない', () => {
    const { targets: _targets, ...none } = TABLE;
    const report = checkLayering(tree({ ...PROFILE, 'lib/sql/x.ts': "import { P } from '../targets/supabase/platform-profile.js';\nexport const p = P;" }), none);
    expect(report.violations.filter((violation) => violation.category === 'target')).toEqual([]);
  });

  it('後段は検証の束ね・変異・差分(orch)の値を読めない(契約は型として下から借りる向きだけ。orch と同順位なので層の向きが止める)', () => {
    const files = { ...PROFILE, 'lib/mutation/run.ts': 'export const x = 1;', 'lib/verify/run.ts': 'export const y = 1;' };
    const layerKeys = (extra: Readonly<Record<string, string>>): readonly string[] =>
      checkLayering(tree({ ...files, ...extra }), TABLE).violations.filter((violation) => violation.category === 'layer').map((violation) => violation.key);
    expect(layerKeys({ 'lib/targets/supabase/z.ts': "import { x } from '../../mutation/run.js';\nexport const z = x;" })).toEqual(['lib/targets/supabase/z.ts → lib/mutation/run.ts']);
    expect(layerKeys({ 'lib/targets/vercel/z.ts': "import { y } from '../../verify/run.js';\nexport const z = y;" })).toEqual(['lib/targets/vercel/z.ts → lib/verify/run.ts']);
  });

  it('後段は後段の登録の契約(contract)を読める。契約が後段を読むと赤(コアから後段への辺)', () => {
    const contract = { 'lib/target-api/contract.ts': 'export interface Target { readonly id: string }' };
    const own = "import type { Target } from '../../target-api/contract.js';\nexport const t: Target = { id: 'x' };";
    expect(targetKeys({ ...PROFILE, ...contract, 'lib/targets/vercel/target.ts': own })).toEqual([]);
    const layerKeys = checkLayering(tree({ ...PROFILE, ...contract, 'lib/targets/vercel/target.ts': own }), TABLE).violations.map((violation) => violation.key);
    expect(layerKeys).toEqual([]);
    expect(
      targetKeys({ ...PROFILE, ...contract, 'lib/target-api/contract.ts': "import { P } from '../targets/supabase/platform-profile.js';\nexport const p = P;" }),
    ).toEqual(['lib/target-api/contract.ts → lib/targets/supabase/platform-profile.ts']);
  });
});
