import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTsTree } from '../../../lib/io/read-ts-tree.js';
import { buildImportGraph, importsOfSource, isRuntimeEdge } from '../../../lib/semantics/import-graph.js';
import { checkLayering, diffBaseline, layerOf, tableProblems } from '../../../lib/gates/layer-check.js';
import type { LayerTable } from '../../../lib/gates/layer-check.js';
import { CLOSURE_BANS, EDGE_BANS, IO_MODULES, IO_ROWS, LAYER_ENTRANCES, LAYER_RANK, LAYER_ROWS, TARGET_BOUNDARIES } from '../../../lib/gates/lib-layers.js';

/**
 * **`legacy/spec-tools/lib` の依存の向きを構造テストで見る**(設計: `docs/design/scripts-layering.md`、
 * 規約: scripts-code-quality.md「依存の向きが行数より先」)。
 *
 * 見るのは 3 つ —— (1) 層の表(`lib/gates/lib-layers.ts`)に対する向き。**表に当たらないファイルは赤**
 * (2) **値の循環 import がファイル単位で 0**(基線を持たない) (3) `node:fs` を import してよいのは
 * io 層と宣言された入口だけ。数えるのは `typescript` の AST で、副作用 import・動的 import・
 * `export … from` も辺である(旧 `semantics-layer.test.ts` はこの 3 形が検査を通り抜けた)。
 *
 * **移行中の基線**: 向きと `fs` の違反は、いまある分を `lib-layering.baseline.json`(1 行 1 違反 =
 * `読む側 → 読まれる側`)に固定する。**増えたら赤・減ったら基線から消さないと赤**(減らし忘れも
 * 見つける。`no-type-restoring-cast.test.ts` と同じ流儀)。層の移設の束が基線を縮め、最後に空にする。
 */

const LIB_DIR = fileURLToPath(new URL('../../../lib/', import.meta.url));
const CLI_DIR = fileURLToPath(new URL('../../../cli/', import.meta.url));
const BASELINE_FILE = fileURLToPath(new URL('./lib-layering.baseline.json', import.meta.url));

/** 本番の層の表一式。 */
const TABLE: LayerTable = { rank: LAYER_RANK, rows: LAYER_ROWS, ioRows: IO_ROWS, ioModules: IO_MODULES, rootPrefix: ['lib/', 'cli/'], closureBans: CLOSURE_BANS, entrances: LAYER_ENTRANCES, targets: TARGET_BOUNDARIES, edgeBans: EDGE_BANS };

/** わざと壊す確認用の小さい表(`lib/` 直下のディレクトリ名がそのまま層)。 */
const MINI: LayerTable = {
  rank: { io: 0, low: 1, high: 2, left: 3, right: 3 },
  rows: [
    { pattern: /^lib\/io\//, layer: 'io', reason: 'test' },
    { pattern: /^lib\/low\//, layer: 'low', reason: 'test' },
    { pattern: /^lib\/high\//, layer: 'high', reason: 'test' },
    { pattern: /^lib\/left\//, layer: 'left', reason: 'test' },
    { pattern: /^lib\/right\//, layer: 'right', reason: 'test' },
  ],
  ioRows: [{ pattern: /^lib\/io\//, reason: 'test' }],
  ioModules: new Set(['fs', 'fs/promises', 'child_process']),
  rootPrefix: 'lib/',
};

/** 本文の写しを作る。 */
function tree(files: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  return new Map(Object.entries(files));
}

/** 違反の鍵だけを返す。 */
function keysOf(files: Readonly<Record<string, string>>): readonly string[] {
  return checkLayering(tree(files), MINI).violations.map((violation) => violation.key);
}

/** 基線(1 行 1 違反)。 */
function baseline(): readonly string[] {
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as readonly string[];
}

describe('lib と cli の実物(層の表・値の循環・fs の入口)', () => {
  const sources = new Map([...readTsTree(LIB_DIR, 'lib/'), ...readTsTree(CLI_DIR, 'cli/')]);
  const report = checkLayering(sources, TABLE);
  const diff = diffBaseline(report.violations.map((violation) => violation.key), baseline());
  const explain = (keys: readonly string[]): string[] =>
    keys.map((key) => `${key}  ${report.violations.find((violation) => violation.key === key)?.detail ?? ''}`);

  it('走査の母集合が空でない・表が壊れていない(組み立てが壊れても緑にしない)', () => {
    expect(sources.size).toBeGreaterThan(500);
    expect([...sources.keys()].filter((file) => file.startsWith('cli/')).length).toBeGreaterThan(5);
    expect(tableProblems(TABLE)).toEqual([]);
  });

  it('cli は lib を読んでよく、lib は cli を読まない(cli は最上層)', () => {
    const cli = report.graph.edges.filter((edge) => edge.from.startsWith('cli/') && edge.to.startsWith('lib/'));
    expect(cli.length).toBeGreaterThan(0);
    expect(report.graph.edges.filter((edge) => edge.from.startsWith('lib/') && edge.to.startsWith('cli/'))).toEqual([]);
  });

  it('未割り付けのファイルは 0(新しいディレクトリは lib-layers.ts に 1 行足して層を選ぶ)', () => {
    expect(report.unassigned).toEqual([]);
  });

  it('値の循環 import はファイル単位で 0(基線を持たない)', () => {
    expect(report.cycles).toEqual([]);
  });

  it('実体の無い相対 import は 0', () => {
    expect(report.unresolved).toEqual([]);
  });

  it('基線に無い違反が増えていない(向き・fs の入口・木の外)', () => {
    expect(explain(diff.added)).toEqual([]);
  });

  it('基線にあるのに現物に無い違反が残っていない(直したら lib-layering.baseline.json から消す)', () => {
    expect(diff.removed).toEqual([]);
  });

  it('基線は昇順・重複なしの「読む側 → 読まれる側」の行である', () => {
    const lines = baseline();
    expect([...lines].sort()).toEqual(lines);
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines.filter((line) => !/^(lib|cli)\/\S+ → \S+$/.test(line))).toEqual([]);
  });

  it('`fs` の違反は基線に 1 行も無い(検証器は io 層の小道具を通す。入口は名指しで宣言する)', () => {
    expect(baseline().filter((line) => line.endsWith(' → node:fs'))).toEqual([]);
  });

  it('`fs` を読む実際の入口は宣言済みで、宣言の行は全部現物に当たっている(腐った宣言を残さない)', () => {
    const entrances = new Set(report.graph.external.filter((edge) => edge.kind !== 'type' && TABLE.ioModules.has(edge.to.replace(/^node:/, ''))).map((edge) => edge.from));
    const dead = IO_ROWS.filter((row) => ![...entrances].some((file) => row.pattern.test(file)));
    expect(dead.map((row) => String(row.pattern))).toEqual([]);
    expect([...entrances].filter((file) => !IO_ROWS.some((row) => row.pattern.test(file)))).toEqual([]);
  });

  it('文言の層は葉である(文言の層の外へ向かう値の辺が 0。型だけ下の層から借りてよい)', () => {
    const messages = report.graph.edges.filter((edge) => edge.from.startsWith('lib/messages/'));
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.filter((edge) => edge.kind !== 'type' && !edge.to.startsWith('lib/messages/')).map((edge) => `${edge.from} → ${edge.to}`)).toEqual([]);
    expect(report.graph.external.filter((edge) => edge.from.startsWith('lib/messages/') && edge.kind !== 'type')).toEqual([]);
  });

  it('値の閉包の禁止: 人向けの本・結果表・世界の組み立ての実行時の閉包に lib/sql/ が入らない(基線にも 1 行も無い)', () => {
    const roots = [...report.graph.files].filter((file) => CLOSURE_BANS.some((ban) => ban.from.test(file)));
    expect(roots.filter((file) => file.startsWith('lib/generate/render/book/')).length).toBeGreaterThan(50);
    expect(roots.filter((file) => file.startsWith('lib/results/')).length).toBeGreaterThan(5);
    expect(roots.filter((file) => file.startsWith('lib/world/')).length).toBeGreaterThan(20);
    expect(explain(report.violations.filter((violation) => violation.category === 'closure').map((violation) => violation.key))).toEqual([]);
    expect(baseline().filter((line) => line.includes(' → lib/sql/') && /^lib\/(generate\/render\/book|results|world)\//.test(line))).toEqual([]);
  });

  it('前段の置き場: lib/model/<種類>/ の実行時の閉包は解析に出ない(閉包の違反 0)・種類のディレクトリには前段のファイルが残らない', () => {
    const kinds = ['auth', 'config', 'data', 'design', 'docs', 'extension', 'external', 'guarantee', 'job', 'notification', 'product', 'query', 'screen', 'surface', 'terms', 'trace', 'usecase', 'ux', 'ux-principles'];
    const front = (kind: string): string[] => [...report.graph.files].filter((file) => file.startsWith(`lib/model/${kind}/`));
    expect(kinds.filter((kind) => front(kind).length === 0), '前段のファイルが 1 本も無い種類').toEqual([]);
    expect(front('screen').length, '起点が空でない').toBeGreaterThan(10);
    expect([...report.graph.files].filter((file) => file.startsWith('lib/model/')).length).toBeGreaterThan(100);
    expect(front('data').every((file) => layerOf(file, TABLE) === 'model')).toBe(true);
    expect(explain(report.violations.filter((violation) => violation.category === 'closure' && violation.key.startsWith('lib/model/')).map((violation) => violation.key))).toEqual([]);
    const strays = [...report.graph.files].filter(
      (file) => kinds.some((kind) => new RegExp(`^lib/${kind}/(types[^/]*|loader|parse-[^/]*)\\.ts$`).test(file)),
    );
    expect(strays, '名前が types* / loader / parse-* のファイルは lib/model/<種類>/ に置く(解析のディレクトリに前段を残さない)').toEqual([]);
  });

  it('関係の層: lib/relations/ は前段・土台・事実の層の葉だけを読む(閉包の違反 0・種類のディレクトリの解析は型でも読まない)', () => {
    const files = [...report.graph.files].filter((file) => file.startsWith('lib/relations/'));
    expect(files.length, '起点が空でない').toBeGreaterThan(3);
    expect(files.every((file) => layerOf(file, TABLE) === 'relations')).toBe(true);
    expect(explain(report.violations.filter((violation) => violation.category === 'closure' && violation.key.startsWith('lib/relations/')).map((violation) => violation.key))).toEqual([]);
    const reads = new Set(report.graph.edges.filter((edge) => edge.from.startsWith('lib/relations/') && !edge.to.startsWith('lib/relations/')).map((edge) => edge.to.split('/').slice(0, 2).join('/')));
    expect([...reads].filter((dir) => !['lib/model', 'lib/kernel', 'lib/guard', 'lib/semantics'].includes(dir)), '関係の層が読む置き場').toEqual([]);
    expect(report.violations.filter((violation) => violation.category === 'layer' && violation.key.startsWith('lib/relations/'))).toEqual([]);
  });

  it('生成器の道具箱と組み立ての根: lib/gen-kit/ は前段・土台・事実の層だけを読み、lib/compose/ は lib/ のどこからも読まれない(プラットフォームの設定の型は前段・受信口の導出は derive)', () => {
    const kit = [...report.graph.files].filter((file) => file.startsWith('lib/gen-kit/'));
    expect(kit.length, '起点が空でない').toBeGreaterThanOrEqual(5);
    expect(kit.every((file) => layerOf(file, TABLE) === 'kit')).toBe(true);
    const reads = new Set(report.graph.edges.filter((edge) => edge.from.startsWith('lib/gen-kit/') && !edge.to.startsWith('lib/gen-kit/')).map((edge) => edge.to.split('/').slice(0, 2).join('/')));
    expect([...reads].filter((dir) => !['lib/model', 'lib/kernel', 'lib/guard', 'lib/semantics'].includes(dir)), '道具箱が読む置き場').toEqual([]);
    const compose = [...report.graph.files].filter((file) => file.startsWith('lib/compose/'));
    expect(compose.length, '起点が空でない').toBeGreaterThanOrEqual(4);
    expect(compose.every((file) => layerOf(file, TABLE) === 'compose')).toBe(true);
    expect(report.graph.edges.filter((edge) => edge.to.startsWith('lib/compose/') && !edge.from.startsWith('lib/compose/') && !edge.from.startsWith('cli/')), '組み立ての根を読んでよいのは cli だけ').toEqual([]);
    expect(layerOf('lib/model/product/platform-profile.ts', TABLE)).toBe('model');
    expect(report.graph.files, 'プラットフォームの設定の型は前段にある').not.toContain('lib/sql/platform-profile.ts');
    expect([...report.graph.files].filter((file) => file.startsWith('lib/inbound/')).every((file) => layerOf(file, TABLE) === 'derive')).toBe(true);
  });

  it('公開の入口: 部品化でできた層(関係の層・世界・検査の契約・テストケースの語彙)は、外から入口だけを import される(深い import 0・基線にも無い)', () => {
    expect(report.missingEntrances, '入口のファイルが実在する').toEqual([]);
    expect(explain(report.violations.filter((violation) => violation.category === 'entrance').map((violation) => violation.key))).toEqual([]);
    expect(baseline().filter((line) => /^(lib|cli)\/\S+ → lib\/(world|testcase|check-api|relations)\//.test(line))).toEqual([]);
    // 宣言が空振りでない: 4 つの置き場のどれも、外から入口を通って読まれている(入口が生きている)
    const throughEntry = (prefix: string, entry: string): number => report.graph.edges.filter((edge) => edge.to === entry && !edge.from.startsWith(prefix)).length;
    expect(throughEntry('lib/world/', 'lib/world/index.ts')).toBeGreaterThan(20);
    expect(throughEntry('lib/testcase/', 'lib/testcase/index.ts')).toBeGreaterThan(10);
    expect(throughEntry('lib/testcase/', 'lib/testcase/types.ts')).toBeGreaterThan(20);
    expect(throughEntry('lib/check-api/', 'lib/check-api/contract.ts')).toBeGreaterThan(20);
    const relations = [...report.graph.files].filter((file) => /^lib\/relations\/[^/]+\/index\.ts$/.test(file));
    expect(relations.length, '関係の層の住人はそれぞれ index.ts を持つ').toBeGreaterThanOrEqual(2);
    for (const entry of relations) expect(throughEntry(entry.replace(/index\.ts$/, ''), entry), entry).toBeGreaterThan(2);
    // 入口は外から使われている名前だけを再輸出する(使われていない名前を出さない)ので、入口は中のファイルを読むだけで、中は入口を読まない
    // テストケースの層は入口が 2 本: 型・語彙の入口 types.ts は台帳の組み立て・突合の値の実装を読まない(前段が型だけを読んでも、
    // 値の実装が実行時の依存の閉包と C24 の写し元の閉包に入らない)。前段は値の入口 index.ts を読まない。
    const readsOf = (file: string): string[] => report.graph.edges.filter((edge) => edge.from === file).map((edge) => edge.to).sort();
    expect(readsOf('lib/testcase/types.ts'), '型・語彙の入口が読むのは型だけの葉と kernel').toEqual(['lib/kernel/source-location.ts', 'lib/testcase/types-scan.ts']);
    expect(report.graph.edges.filter((edge) => edge.from.startsWith('lib/model/') && edge.to === 'lib/testcase/index.ts').map((edge) => edge.from), '前段は値の入口を読まない').toEqual([]);
    for (const entry of ['lib/world/index.ts', 'lib/testcase/index.ts']) {
      const prefix = entry.replace(/index\.ts$/, '');
      expect(report.graph.edges.filter((edge) => edge.to === entry && edge.from.startsWith(prefix)), `${entry} を中から読まない`).toEqual([]);
    }
  });

  it('生成器と変異の層: lib/generate/ は変異の層を実行時の依存に持たない(閉包の違反 0・基線にも無い)', () => {
    const roots = [...report.graph.files].filter((file) => file.startsWith('lib/generate/'));
    expect(roots.length, '起点が空でない').toBeGreaterThan(100);
    expect(explain(report.violations.filter((violation) => violation.category === 'closure' && violation.key.startsWith('lib/generate/')).map((violation) => violation.key))).toEqual([]);
    expect(baseline().filter((line) => line.includes(' → lib/mutation/'))).toEqual([]);
    expect(report.graph.edges.filter((edge) => edge.from.startsWith('lib/generate/') && edge.to.startsWith('lib/mutation/')), '型でも読まない(結果の型は kernel)').toEqual([]);
    expect(report.graph.edges.some((edge) => edge.from.startsWith('lib/mutation/') && edge.to.startsWith('lib/generate/')), '変異の層が生成器を読む向きは残る').toBe(true);
    expect(roots.filter((file) => layerOf(file, TABLE) === 'compose').length, '組み立ての根(generate-context)は生成器の中に残る').toBeGreaterThan(0);
  });

  it('部分利用の入口: cli/generate-book.ts の実行時の閉包に SQL の層と変異の層が入らない(閉包の違反 0・基線にも無い)。全部入りの generate の閉包には入る(禁止が空振りでない)', () => {
    const closureOf = (entry: string): ReadonlySet<string> => {
      const next = new Map<string, string[]>();
      for (const edge of report.graph.edges) if (isRuntimeEdge(edge)) next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
      const seen = new Set([entry]);
      for (const file of seen) for (const to of next.get(file) ?? []) seen.add(to);
      return seen;
    };
    const entry = closureOf('cli/generate-book.ts');
    const full = closureOf('cli/generate-docs.ts');
    const banned = (file: string): boolean => /^lib\/(sql|mutation)\//.test(file);
    expect(entry.size, '起点が空でない(入口の閉包は本の生成器を含む)').toBeGreaterThan(300);
    expect([...entry].filter((file) => file.startsWith('lib/generate/render/book/')).length).toBeGreaterThan(50);
    expect([...entry].filter(banned)).toEqual([]);
    expect([...full].filter((file) => file.startsWith('lib/sql/')).length, '全部入りは SQL の層を読む').toBeGreaterThan(20);
    expect([...full].filter((file) => file.startsWith('lib/mutation/')).length, '全部入りは変異の層を読む').toBeGreaterThan(3);
    expect(explain(report.violations.filter((violation) => violation.category === 'closure' && /^(cli\/(generate-book|run-generators)|lib\/generate\/)/.test(violation.key)).map((violation) => violation.key))).toEqual([]);
    expect(CLOSURE_BANS.some((ban) => ban.from.test('cli/generate-book.ts') && ban.banned.test('lib/sql/rls-migration.ts') && ban.banned.test('lib/mutation/matrix.ts'))).toBe(true);
    expect(entry.has('lib/verify/pre-generate.ts'), '生成を止める error の判定は呼ぶ(全検査 pipeline は呼ばない)').toBe(true);
    expect(entry.has('lib/compose/verify-pipeline.ts')).toBe(false);
    expect(entry.has('lib/compose/all-generators.ts'), '全部入りの生成器の一覧(SQL の生成器を含む)は呼ばない').toBe(false);
    expect(entry.has('lib/compose/book-generators.ts')).toBe(true);
  });

  it('部分利用の入口: cli/generate-book.ts の実行時の閉包に、後段の登録の契約と後段の生成器・検査が入らない(入るのは設定の値と置き場の配置の値の 2 ファイルだけ)。全部入りの generate の閉包には入る(禁止が空振りでない)', () => {
    const closureOf = (entry: string): ReadonlySet<string> => {
      const next = new Map<string, string[]>();
      for (const edge of report.graph.edges) if (isRuntimeEdge(edge)) next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
      const seen = new Set([entry]);
      for (const file of seen) for (const to of next.get(file) ?? []) seen.add(to);
      return seen;
    };
    const entry = closureOf('cli/generate-book.ts');
    const full = closureOf('cli/generate-docs.ts');
    expect([...entry].filter((file) => file.startsWith('lib/target-api/'))).toEqual([]);
    expect([...entry].filter((file) => file.startsWith('lib/targets/')).sort()).toEqual(['lib/targets/nextjs/layout.ts', 'lib/targets/supabase/platform-profile.ts']);
    expect([...full].filter((file) => file.startsWith('lib/targets/vercel/')).length, '全部入りはホストの後段を読む').toBeGreaterThan(0);
    expect([...full].filter((file) => file.startsWith('lib/target-api/')).length).toBeGreaterThan(0);
    const ban = CLOSURE_BANS.find((candidate) => candidate.from.test('cli/generate-book.ts') && candidate.banned.test('lib/target-api/contract.ts'));
    expect(ban?.banned.test('lib/targets/vercel/target.ts')).toBe(true);
    expect(ban?.banned.test('lib/targets/supabase/job/j3-pgcron-parity.ts')).toBe(true);
    expect(ban?.banned.test('lib/targets/supabase/platform-profile.ts'), '設定の値は読んでよい').toBe(false);
    expect(ban?.banned.test('lib/targets/nextjs/layout.ts'), '置き場の配置の値は読んでよい').toBe(false);
    expect(ban?.banned.test('lib/targets/nextjs/target.ts'), '後段の値(契約を読む側)は読めない').toBe(true);
    expect(explain(report.violations.filter((violation) => violation.category === 'closure' && /^(cli\/(generate-book|run-generators)|lib\/generate\/)/.test(violation.key)).map((violation) => violation.key))).toEqual([]);
  });

  it('入口を SQL の層・変異の層を読む形に壊すと閉包の違反になる(わざと壊す。入口そのものと、入口の組み立ての口の両方)', () => {
    const broken = (file: string, line: string): readonly string[] => {
      const next = new Map(sources);
      next.set(file, `${next.get(file) ?? ''}\n${line}\n`);
      return checkLayering(next, TABLE).violations.filter((violation) => violation.category === 'closure').map((violation) => violation.key);
    };
    expect(broken('cli/generate-book.ts', "import '../lib/mutation/matrix.js';")).toContain('cli/generate-book.ts → lib/mutation/matrix.ts');
    expect(broken('lib/generate/book-entry-report.ts', "import '../sql/rls-migration.js';")).toContain('lib/generate/book-entry-report.ts → lib/sql/rls-migration.ts');
    expect(broken('lib/generate/generate-inputs.ts', "import '../mutation/matrix.js';")).toContain('lib/generate/generate-inputs.ts → lib/mutation/matrix.ts');
    expect(broken('cli/run-generators.ts', "import '../lib/sql/rls-migration.js';")).toContain('cli/run-generators.ts → lib/sql/rls-migration.ts');
    // 章の冒頭の注記と全部入りとの比較も、入口が組み立てに使う口なので同じ閉包の禁止に当たる。
    expect(broken('lib/generate/book-entry-notice.ts', "import '../sql/rls-migration.js';")).toContain('lib/generate/book-entry-notice.ts → lib/sql/rls-migration.ts');
    expect(broken('lib/generate/book-entry-check.ts', "import '../mutation/matrix.js';")).toContain('lib/generate/book-entry-check.ts → lib/mutation/matrix.ts');
  });

  it('画面と UX 経験則は互いの置き場を読まない(共有の事実は semantics・画面の宣言の読みは前段に置く。型でも)', () => {
    const between = (from: string, to: string): string[] =>
      report.graph.edges.filter((edge) => edge.from.startsWith(`lib/${from}/`) && edge.to.startsWith(`lib/${to}/`)).map((edge) => `${edge.from} → ${edge.to}`);
    expect(report.graph.edges.filter((edge) => edge.from.startsWith('lib/ux/')).length, '起点が空でない').toBeGreaterThan(5);
    expect(between('ux', 'screen')).toEqual([]);
    expect(between('screen', 'ux')).toEqual([]);
  });

  it('画面とユースケースは互いの置き場を読まない(画面の到達は関係の層・tc 照合は testcase・ID の値域は semantics。型でも)', () => {
    const between = (from: string, to: string): string[] =>
      report.graph.edges.filter((edge) => edge.from.startsWith(`lib/${from}/`) && edge.to.startsWith(`lib/${to}/`)).map((edge) => `${edge.from} → ${edge.to}`);
    expect(report.graph.edges.filter((edge) => edge.from.startsWith('lib/usecase/')).length, '起点が空でない').toBeGreaterThan(50);
    expect(between('usecase', 'screen')).toEqual([]);
    expect(between('screen', 'usecase')).toEqual([]);
    expect(between('usecase', 'trace'), 'trace → usecase(計画を読む検査 A15 / A19)だけが自然な一方向として残る').toEqual([]);
    expect(between('trace', 'usecase').length, '残る一方向').toBeGreaterThan(0);
    expect(report.graph.edges.filter((edge) => edge.from.startsWith('lib/relations/screen-reachability/')).length, '関係の層の住人が居る').toBeGreaterThan(5);
  });

  it('`fs` の入口は名指しである(接頭辞つきの任意の名前を通さない)', () => {
    for (const file of ['lib/sql/zz-loader.ts', 'lib/usecase/zz-scan.ts', 'lib/sql/verifiers/loader.ts', 'lib/sql/verifiers/scan.ts']) {
      expect(IO_ROWS.find((row) => row.pattern.test(file)), file).toBeUndefined();
    }
  });
});

describe('わざと壊す確認: 値の循環', () => {
  it('値の循環は赤(2 ファイルが互いに値を import)', () => {
    const report = checkLayering(tree({ 'lib/low/a.ts': "import { b } from './b.js';\nexport const a = b;", 'lib/low/b.ts': "import { a } from './a.js';\nexport const b = a;" }), MINI);
    expect(report.cycles).toEqual([['lib/low/a.ts', 'lib/low/b.ts']]);
  });

  it('型だけの循環は値の循環に数えない', () => {
    const report = checkLayering(
      tree({ 'lib/low/a.ts': "import type { B } from './b.js';\nexport type A = B;", 'lib/low/b.ts': "import { type A } from './a.js';\nexport type B = A;" }),
      MINI,
    );
    expect(report.cycles).toEqual([]);
  });

  it('副作用 import・動的 import・export … from も循環の辺に数える', () => {
    for (const back of ["import './a.js';", "export const load = () => import('./a.js');", "export * from './a.js';", "export { a } from './a.js';"]) {
      const report = checkLayering(tree({ 'lib/low/a.ts': "import { b } from './b.js';\nexport const a = b;", 'lib/low/b.ts': `${back}\nexport const b = 1;` }), MINI);
      expect(report.cycles).toEqual([['lib/low/a.ts', 'lib/low/b.ts']]);
    }
  });

  it('自己ループと 3 ファイルの輪も捕る', () => {
    expect(checkLayering(tree({ 'lib/low/a.ts': "import { a } from './a.js';" }), MINI).cycles).toEqual([['lib/low/a.ts']]);
    const ring = checkLayering(
      tree({ 'lib/low/a.ts': "import './b.js';", 'lib/low/b.ts': "import './c.js';", 'lib/low/c.ts': "import './a.js';" }),
      MINI,
    );
    expect(ring.cycles).toEqual([['lib/low/a.ts', 'lib/low/b.ts', 'lib/low/c.ts']]);
  });

  it('コメントと文字列の中の import は辺にならない(正規表現でなく AST で数える)', () => {
    const source = "// import { b } from './b.js';\nconst text = \"import x from './b.js'\";\n/* export * from './b.js'; */";
    expect(importsOfSource('lib/low/a.ts', source)).toEqual([]);
  });
});

describe('わざと壊す確認: import の形(辺の取りこぼしを塞ぐ)', () => {
  it('置換なしのテンプレートリテラルの動的 import も辺になる(上の層への迂回路にしない)', () => {
    expect(keysOf({ 'lib/low/a.ts': 'export const load = () => import(`../high/b.js`);', 'lib/high/b.ts': 'export const b = 1;' })).toEqual(['lib/low/a.ts → lib/high/b.ts']);
    expect(importsOfSource('lib/low/a.ts', 'const m = import(`./b.js`);')).toEqual([{ specifier: './b.js', kind: 'dynamic', line: 1 }]);
  });

  it('置換のあるテンプレートリテラル・変数を渡す動的 import / require は辺にせず、行き先が決まらない印をつけて拾う(閉包が欠けた。B6-1)', () => {
    expect(importsOfSource('lib/low/a.ts', 'const m = import(`./${name}.js`);\nconst n = import(name);\nconst o = require(name);\nconst p = import();')).toEqual([
      { specifier: '`./${name}.js`', kind: 'dynamic', line: 1, opaque: true },
      { specifier: 'name', kind: 'dynamic', line: 2, opaque: true },
      { specifier: 'name', kind: 'dynamic', line: 3, opaque: true },
      { specifier: '', kind: 'dynamic', line: 4, opaque: true },
    ]);
    const graph = buildImportGraph(tree({ 'lib/low/a.ts': 'export const load = (x: string) => import(`../high/${x}.js`);', 'lib/high/b.ts': '' }), 'lib/');
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([{ from: 'lib/low/a.ts', to: '`../high/${x}.js`', kind: 'dynamic', line: 1 }]);
  });

  it('require() の呼び出しと `import x = require()` も辺になる', () => {
    const high = { 'lib/high/b.ts': 'export const b = 1;' };
    for (const line of ["const b = require('../high/b.js');", "import b = require('../high/b.js');", 'const b = require(`../high/b.js`);']) {
      expect(keysOf({ 'lib/low/a.ts': line, ...high }), line).toEqual(['lib/low/a.ts → lib/high/b.ts']);
    }
  });

  it('require() も値の循環を作る', () => {
    const report = checkLayering(tree({ 'lib/low/a.ts': "const b = require('./b.js');", 'lib/low/b.ts': "const a = require('./a.js');" }), MINI);
    expect(report.cycles).toEqual([['lib/low/a.ts', 'lib/low/b.ts']]);
  });

  it('require() で node:fs を読む入口でないファイルは赤', () => {
    expect(keysOf({ 'lib/high/v.ts': "const fs = require('node:fs');" })).toEqual(['lib/high/v.ts → node:fs']);
  });

  it('`.mts` / `.mjs` などの拡張子も解く(`./x.mjs` は `x.mts` にも `x.mjs` にも当たる)', () => {
    const graph = buildImportGraph(tree({ 'lib/low/a.ts': "import './b.mjs';\nimport './c.js';", 'lib/low/b.mts': '', 'lib/low/c.mjs': '' }), 'lib/');
    expect(graph.edges.map((edge) => edge.to)).toEqual(['lib/low/b.mts']);
    expect(graph.unresolved.map((edge) => edge.to)).toEqual(['./c.js']);
    const exact = buildImportGraph(tree({ 'lib/low/a.ts': "import './m.mjs';", 'lib/low/m.mjs': '' }), 'lib/');
    expect(exact.edges.map((edge) => edge.to)).toEqual(['lib/low/m.mjs']);
  });
});

describe('わざと壊す確認: 値の閉包の禁止', () => {
  const CLOSURE: LayerTable = {
    ...MINI,
    rank: { ...MINI.rank, mid: 2 },
    rows: [...MINI.rows, { pattern: /^lib\/mid\//, layer: 'mid', reason: 'test' }],
    closureBans: [{ from: /^lib\/left\//, banned: /^lib\/low\//, reason: '起点は low を実行時の依存に持たない' }],
  };
  /** 閉包の違反だけを `鍵(説明)` で返す。 */
  function closureOf(files: Readonly<Record<string, string>>): readonly string[] {
    return checkLayering(tree(files), CLOSURE).violations.filter((violation) => violation.category === 'closure').map((violation) => violation.key);
  }

  it('起点が禁止の置き場を直接読む辺と、間に 1 枚はさんだ辺の両方を、入る辺として 1 本ずつ名指す', () => {
    expect(closureOf({ 'lib/left/a.ts': "import { x } from '../low/x.js';", 'lib/low/x.ts': 'export const x = 1;' })).toEqual(['lib/left/a.ts → lib/low/x.ts']);
    expect(
      closureOf({
        'lib/left/a.ts': "import { m } from '../mid/m.js';",
        'lib/mid/m.ts': "import { x } from '../low/x.js';\nexport const m = x;",
        'lib/low/x.ts': 'export const x = 1;',
      }),
    ).toEqual(['lib/mid/m.ts → lib/low/x.ts']);
  });

  it('経路が説明に出る(起点 → … → 入る手前)', () => {
    const report = checkLayering(
      tree({
        'lib/left/a.ts': "import { m } from '../mid/m.js';",
        'lib/mid/m.ts': "import { x } from '../low/x.js';\nexport const m = x;",
        'lib/low/x.ts': 'export const x = 1;',
      }),
      CLOSURE,
    );
    expect(report.violations.find((violation) => violation.category === 'closure')?.detail).toContain('lib/left/a.ts → lib/mid/m.ts');
  });

  it('型だけの import は実行時に消えるので数えない', () => {
    expect(closureOf({ 'lib/left/a.ts': "import type { X } from '../low/x.js';", 'lib/low/x.ts': 'export type X = 1;' })).toEqual([]);
    expect(closureOf({ 'lib/left/a.ts': "import { type X } from '../low/x.js';", 'lib/low/x.ts': 'export type X = 1;' })).toEqual([]);
  });

  it('起点の閉包の外にある禁止の置き場への辺は数えない', () => {
    expect(closureOf({ 'lib/mid/m.ts': "import { x } from '../low/x.js';", 'lib/low/x.ts': 'export const x = 1;', 'lib/left/a.ts': 'export const a = 1;' })).toEqual([]);
  });

  it('禁止の置き場の先は数えない(入った時点で違反。同じ原因を何本にも増やさない)', () => {
    expect(
      closureOf({
        'lib/left/a.ts': "import { x } from '../low/x.js';",
        'lib/low/x.ts': "import { y } from './y.js';\nexport const x = y;",
        'lib/low/y.ts': 'export const y = 1;',
      }),
    ).toEqual(['lib/left/a.ts → lib/low/x.ts']);
  });

  it('副作用 import・動的 import・export … from も入る辺になる', () => {
    for (const line of ["import '../low/x.js';", "export const load = () => import('../low/x.js');", "export * from '../low/x.js';"]) {
      expect(closureOf({ 'lib/left/a.ts': line, 'lib/low/x.ts': 'export const x = 1;' }), line).toEqual(['lib/left/a.ts → lib/low/x.ts']);
    }
  });

  it('循環があっても止まる', () => {
    expect(
      closureOf({
        'lib/left/a.ts': "import { b } from './b.js';\nexport const a = b;",
        'lib/left/b.ts': "import { a } from './a.js';\nimport { x } from '../low/x.js';\nexport const b = [a, x];",
        'lib/low/x.ts': 'export const x = 1;',
      }),
    ).toEqual(['lib/left/b.ts → lib/low/x.ts']);
  });

  it('禁止を宣言しない表では何も見ない', () => {
    expect(checkLayering(tree({ 'lib/left/a.ts': "import { x } from '../low/x.js';", 'lib/low/x.ts': 'export const x = 1;' }), MINI).violations.filter((violation) => violation.category === 'closure')).toEqual([]);
  });
});

describe('わざと壊す確認: 関係の層(本番の表)', () => {
  /** 本番の表に当てた違反の鍵(`読む側 → 読まれる側`)。 */
  function violationsOf(files: Readonly<Record<string, string>>): readonly string[] {
    return checkLayering(tree(files), TABLE).violations.map((violation) => violation.key);
  }

  it('関係の層が種類のディレクトリの解析(検査・計画)を読むと赤(型の import も)', () => {
    expect(
      violationsOf({
        'lib/relations/x/a.ts': "import { v } from '../../query/verifiers/q4.js';\nexport const a = v;",
        'lib/query/verifiers/q4.ts': 'export const v = 1;',
      }),
    ).toContain('lib/relations/x/a.ts → lib/query/verifiers/q4.ts');
    expect(
      violationsOf({
        'lib/relations/x/a.ts': "import type { P } from '../../sql/plan.js';\nexport type A = P;",
        'lib/sql/plan.ts': 'export type P = 1;',
      }),
    ).toContain('lib/relations/x/a.ts → lib/sql/plan.ts');
  });

  it('事実の層(semantics)でも、名指しの葉(9 本)以外へ値が入ると閉包の違反になる(葉だけが許される)', () => {
    const closure = (files: Readonly<Record<string, string>>): readonly string[] =>
      checkLayering(tree(files), TABLE).violations.filter((violation) => violation.category === 'closure').map((violation) => violation.key);
    expect(
      closure({
        'lib/relations/x/a.ts': "import { b } from '../../semantics/domain-lookup.js';\nexport const a = b;",
        'lib/semantics/domain-lookup.ts': 'export const b = 1;',
      }),
    ).toEqual([]);
    expect(
      closure({
        'lib/relations/x/a.ts': "import { b } from '../../semantics/operation-facts.js';\nexport const a = b;",
        'lib/semantics/operation-facts.ts': 'export const b = 1;',
      }),
    ).toEqual(['lib/relations/x/a.ts → lib/semantics/operation-facts.ts']);
    // 画面の到達が読む葉(入場の判定・状態の判定・操作 ID の接地・ドメインの索引)は許される
    for (const leaf of ['domain-index', 'domain-env', 'entity-state-axes', 'state-admit', 'action-ground', 'required-guards']) {
      expect(
        closure({
          'lib/relations/x/a.ts': `import { b } from '../../semantics/${leaf}.js';\nexport const a = b;`,
          [`lib/semantics/${leaf}.ts`]: 'export const b = 1;',
        }),
        leaf,
      ).toEqual([]);
    }
  });

  it('関係の層は検査・生成から読まれてよい(上から下への向きは正しい)', () => {
    expect(
      violationsOf({
        'lib/data/verifiers/t.ts': "import { a } from '../../relations/x/index.js';\nexport const t = a;",
        'lib/generate/render/g.ts': "import { a } from '../../relations/x/index.js';\nexport const g = a;",
        'lib/relations/x/index.ts': "export { a } from './a.js';",
        'lib/relations/x/a.ts': 'export const a = 1;',
      }),
    ).toEqual([]);
  });
});

describe('わざと壊す確認: 公開の入口', () => {
  const ENTRANCE: LayerTable = {
    ...MINI,
    entrances: [
      { inside: /^lib\/low\/([^/]+)\//, entries: ['lib/low/$1/index.ts', 'lib/low/$1/types.ts'], reason: '入口の宣言(値の入口と型の入口の 2 本)' },
      { inside: /^lib\/io\//, entries: ['lib/io/gate.ts'], reason: '入口の宣言(1 ファイル)' },
    ],
  };
  const INSIDE = {
    'lib/low/x/index.ts': "export { a } from './a.js';",
    'lib/low/x/types.ts': 'export type T = 1;',
    'lib/low/x/a.ts': 'export const a = 1;',
    'lib/low/x/b.ts': 'export const b = 1;',
  };
  /** 入口の違反の鍵だけ。 */
  function entranceKeys(files: Readonly<Record<string, string>>, table: LayerTable = ENTRANCE): readonly string[] {
    return checkLayering(tree(files), table).violations.filter((violation) => violation.category === 'entrance').map((violation) => violation.key);
  }

  it('外から中のファイルを直接読むと赤(入口を通せば緑。種類も形も同じ: 値・型・再輸出・副作用・動的)', () => {
    expect(entranceKeys({ ...INSIDE, 'lib/high/h.ts': "import { a } from '../low/x/index.js';\nexport const h = a;" })).toEqual([]);
    expect(entranceKeys({ ...INSIDE, 'lib/high/h.ts': "import type { T } from '../low/x/types.js';\nexport type H = T;" }), '入口は複数あってよい(型の入口)').toEqual([]);
    for (const line of ["import { b } from '../low/x/b.js';", "import type { B } from '../low/x/b.js';", "export { b } from '../low/x/b.js';", "import '../low/x/b.js';", "export const load = () => import('../low/x/b.js');"]) {
      expect(entranceKeys({ ...INSIDE, 'lib/high/h.ts': line }), line).toEqual(['lib/high/h.ts → lib/low/x/b.ts']);
    }
  });

  it('入口でないファイルへの辺は、型だけでも赤(説明に入口の名前が出る)', () => {
    const report = checkLayering(tree({ ...INSIDE, 'lib/high/h.ts': "import type { B } from '../low/x/b.js';" }), ENTRANCE);
    const found = report.violations.find((violation) => violation.category === 'entrance');
    expect(found?.runtime).toBe(false);
    expect(found?.detail).toContain('入口は lib/low/x/index.ts か lib/low/x/types.ts');
  });

  it('置き場の中どうしは自由に読み合ってよい(入口を経なくても赤にならない)', () => {
    expect(entranceKeys({ ...INSIDE, 'lib/low/x/c.ts': "import { b } from './b.js';\nexport const c = b;" })).toEqual([]);
  });

  it('同じ形の別の置き場(`$1` が違う)の中は「外」である(隣の置き場の中身を読めない)', () => {
    expect(
      entranceKeys({ ...INSIDE, 'lib/low/y/index.ts': 'export {};', 'lib/low/y/d.ts': "import { b } from '../x/b.js';\nexport const d = b;" }),
    ).toEqual(['lib/low/y/d.ts → lib/low/x/b.ts']);
  });

  it('1 ファイルの置き場は、そのファイルが入口(宣言した名前でなければ赤)', () => {
    const single = { 'lib/io/gate.ts': 'export const g = 1;', 'lib/io/other.ts': 'export const o = 1;' };
    expect(entranceKeys({ ...single, 'lib/high/h.ts': "import { g } from '../io/gate.js';" })).toEqual([]);
    expect(entranceKeys({ ...single, 'lib/high/h.ts': "import { o } from '../io/other.js';" })).toEqual(['lib/high/h.ts → lib/io/other.ts']);
  });

  it('入口のファイルが無い置き場は赤(新しい置き場は入口を作る)', () => {
    expect(checkLayering(tree({ 'lib/low/z/a.ts': 'export const a = 1;', 'lib/io/other.ts': 'export const o = 1;' }), ENTRANCE).missingEntrances).toEqual([
      'lib/io/ → lib/io/gate.ts',
      'lib/low/z/ → lib/low/z/index.ts',
      'lib/low/z/ → lib/low/z/types.ts',
    ]);
    expect(checkLayering(tree(INSIDE), ENTRANCE).missingEntrances).toEqual([]);
  });

  it('入口を宣言しない表では何も見ない', () => {
    expect(entranceKeys({ ...INSIDE, 'lib/high/h.ts': "import { b } from '../low/x/b.js';" }, MINI)).toEqual([]);
    expect(checkLayering(tree(INSIDE), MINI).missingEntrances).toEqual([]);
  });

  it('本番の表: 実物の木に深い import を足すと赤になる(lib からも cli からも・型でも。入口を通すなら緑)', () => {
    const sources = new Map([...readTsTree(LIB_DIR, 'lib/'), ...readTsTree(CLI_DIR, 'cli/')]);
    /** 実物の木の何本かに 1 行ずつ足して、入口の違反の鍵だけを返す(木の判定は重いので 1 回にまとめる)。 */
    const broken = (lines: Readonly<Record<string, string>>): readonly string[] => {
      const next = new Map(sources);
      for (const [file, line] of Object.entries(lines)) next.set(file, `${next.get(file) ?? ''}\n${line}\n`);
      return checkLayering(next, TABLE).violations.filter((violation) => violation.category === 'entrance').map((violation) => violation.key);
    };
    expect(
      broken({
        'lib/compose/verify-pipeline.ts': "import { eqCatalog } from '../world/index.js';",
        'lib/world/rls-plan.ts': "import { eqCatalog } from './eq-catalog.js';",
      }),
      '入口を通す・置き場の中どうしは緑',
    ).toEqual([]);
    expect(
      broken({
        'lib/compose/verify-pipeline.ts': "import { eqCatalog } from '../world/eq-catalog.js';\nimport type { RlsWorld } from '../world/rls-world.js';",
        'cli/generate-book.ts': "import { buildTcRegistry } from '../lib/testcase/registry.js';",
        'lib/screen/verifiers/s13-role-state-reach.ts': "import { indexRequirementsOfModels } from '../../relations/index-requirements/index-derivation.js';",
      }),
    ).toEqual([
      'cli/generate-book.ts → lib/testcase/registry.ts',
      'lib/compose/verify-pipeline.ts → lib/world/eq-catalog.ts',
      'lib/compose/verify-pipeline.ts → lib/world/rls-world.ts',
      'lib/screen/verifiers/s13-role-state-reach.ts → lib/relations/index-requirements/index-derivation.ts',
    ]);
  });

  it('本番の表: 入口を削ると、入口の無い置き場として赤になる', () => {
    const sources = new Map([...readTsTree(LIB_DIR, 'lib/'), ...readTsTree(CLI_DIR, 'cli/')]);
    sources.delete('lib/relations/screen-reachability/index.ts');
    expect(checkLayering(sources, TABLE).missingEntrances).toEqual(['lib/relations/screen-reachability/ → lib/relations/screen-reachability/index.ts']);
  });
});

describe('わざと壊す確認: 生成器と変異の層(本番の表)', () => {
  /** 本番の表に当てた閉包の違反の鍵。 */
  function closureOf(files: Readonly<Record<string, string>>): readonly string[] {
    return checkLayering(tree(files), TABLE).violations.filter((violation) => violation.category === 'closure').map((violation) => violation.key);
  }

  it('生成器が変異の層を値で直接読むと赤', () => {
    expect(
      closureOf({
        'lib/generate/generate-context.ts': "import { mutationReportOf } from '../mutation/matrix.js';\nexport const g = mutationReportOf;",
        'lib/mutation/matrix.ts': 'export const mutationReportOf = 1;',
      }),
    ).toEqual(['lib/generate/generate-context.ts → lib/mutation/matrix.ts']);
  });

  it('生成器が間に 1 枚はさんで変異の層を値で読んでも赤(層の向きに当たらない経路は、閉包だけが止める)', () => {
    // 向きの違反になる辺(事実の層 → 変異の層)は同じ鍵が 1 行に畳まれるので、向きに当たらない経路で見る。
    expect(
      closureOf({
        'lib/generate/render/book/b.ts': "import { v } from '../../../verify/report.js';\nexport const b = v;",
        'lib/verify/report.ts': "import { d } from '../mutation/detectors.js';\nexport const v = d;",
        'lib/mutation/detectors.ts': 'export const d = 1;',
      }),
    ).toEqual(['lib/verify/report.ts → lib/mutation/detectors.ts']);
  });

  it('生成器の一覧(組み立ての根)が変異の層を値で読むと赤(置き場を動かしても禁止が外れない)・全検査のパイプラインは変異を読んでよい(起動する側)', () => {
    expect(
      closureOf({
        'lib/compose/all-generators.ts': "import { mutationReportOf } from '../mutation/matrix.js';\nexport const a = mutationReportOf;",
        'lib/compose/verify-pipeline.ts': "import { mutationReportOf } from '../mutation/matrix.js';\nexport const v = mutationReportOf;",
        'lib/mutation/matrix.ts': 'export const mutationReportOf = 1;',
      }),
    ).toEqual(['lib/compose/all-generators.ts → lib/mutation/matrix.ts']);
  });

  it('生成器の道具箱が変異の層・SQL の層を読むのは層の向きで赤(道具箱は前段・土台・事実の層だけを読む)', () => {
    const violations = checkLayering(
      tree({
        'lib/gen-kit/generator.ts': "import type { MutationReport } from '../mutation/matrix.js';\nimport type { Rpc } from '../sql/rpc-body.js';\nexport type G = [MutationReport, Rpc];",
        'lib/mutation/matrix.ts': 'export type MutationReport = 1;',
        'lib/sql/rpc-body.ts': 'export type Rpc = 1;',
      }),
      TABLE,
    ).violations.map((violation) => violation.key);
    expect(violations).toEqual(['lib/gen-kit/generator.ts → lib/mutation/matrix.ts', 'lib/gen-kit/generator.ts → lib/sql/rpc-body.ts']);
  });

  it('結果をデータで受け取る葉(kernel の mutation-report)と、型だけの import は読んでよい', () => {
    expect(
      closureOf({
        'lib/generate/render/book/m.ts': "import { holesOf } from '../../../kernel/mutation-report.js';\nexport const m = holesOf;",
        'lib/gen-kit/generator.ts': "import type { MutationReport } from '../mutation/matrix.js';\nexport type G = MutationReport;",
        'lib/kernel/mutation-report.ts': 'export const holesOf = 1;',
        'lib/mutation/matrix.ts': 'export type MutationReport = 1;',
      }),
    ).toEqual([]);
  });

  it('変異の層が生成器を読むのは正しい向き(検出器は生成器を呼ぶ)', () => {
    expect(
      closureOf({
        'lib/mutation/detectors.ts': "import { gen } from '../generate/render/code-ddl.js';\nexport const d = gen;",
        'lib/generate/render/code-ddl.ts': 'export const gen = 1;',
      }),
    ).toEqual([]);
  });
});

describe('わざと壊す確認: cli → lib の向き', () => {
  const CLI_MINI: LayerTable = {
    ...MINI,
    rank: { ...MINI.rank, top: 9 },
    rows: [...MINI.rows, { pattern: /^cli\//, layer: 'top', reason: 'test' }],
    ioRows: [...MINI.ioRows, { pattern: /^cli\//, reason: 'test' }],
    rootPrefix: ['lib/', 'cli/'],
  };

  it('cli から lib を読むのは正しい向き(cli は最上層)・cli 同士も読んでよい', () => {
    const report = checkLayering(tree({ 'cli/a.ts': "import { b } from '../lib/high/b.js';\nimport './c.js';", 'cli/c.ts': '', 'lib/high/b.ts': 'export const b = 1;' }), CLI_MINI);
    expect(report.violations).toEqual([]);
    expect(report.unresolved).toEqual([]);
  });

  it('lib から cli を読むと赤(下の層が上の層を読んでいる)', () => {
    const report = checkLayering(tree({ 'lib/low/a.ts': "import { x } from '../../cli/x.js';", 'cli/x.ts': 'export const x = 1;' }), CLI_MINI);
    expect(report.violations.map((violation) => violation.key)).toEqual(['lib/low/a.ts → cli/x.ts']);
  });

  it('cli が lib と cli の外(テストの木)を読むと木の外の違反になる', () => {
    const report = checkLayering(tree({ 'cli/a.ts': "import { h } from '../__tests__/harness.js';" }), CLI_MINI);
    expect(report.violations.map((violation) => [violation.key, violation.category])).toEqual([['cli/a.ts → __tests__/harness.js', 'outside']]);
  });

  it('cli は node:fs を読んでよい(入口)', () => {
    expect(checkLayering(tree({ 'cli/a.ts': "import { readFileSync } from 'node:fs';" }), CLI_MINI).violations).toEqual([]);
  });
});

describe('わざと壊す確認: 層の向き', () => {
  it('下の層から上の層を import すると赤', () => {
    expect(keysOf({ 'lib/low/a.ts': "import { b } from '../high/b.js';", 'lib/high/b.ts': 'export const b = 1;' })).toEqual(['lib/low/a.ts → lib/high/b.ts']);
  });

  it('上の層から下の層を import するのは正しい向き', () => {
    expect(keysOf({ 'lib/high/a.ts': "import { b } from '../low/b.js';", 'lib/low/b.ts': 'export const b = 1;' })).toEqual([]);
  });

  it('同じ層の中は読んでよい', () => {
    expect(keysOf({ 'lib/low/a.ts': "import { b } from './b.js';", 'lib/low/b.ts': 'export const b = 1;' })).toEqual([]);
  });

  it('同じ順位の別の層は互いを読まない(check と emit の関係)', () => {
    expect(keysOf({ 'lib/left/a.ts': "import { b } from '../right/b.js';", 'lib/right/b.ts': 'export const b = 1;' })).toEqual(['lib/left/a.ts → lib/right/b.ts']);
  });

  it('型の import も向きの違反に数える(実行時には効かない印が付く)', () => {
    const report = checkLayering(tree({ 'lib/low/a.ts': "import type { B } from '../high/b.js';", 'lib/high/b.ts': 'export type B = 1;' }), MINI);
    expect(report.violations.map((violation) => [violation.key, violation.runtime])).toEqual([['lib/low/a.ts → lib/high/b.ts', false]]);
  });

  it('副作用 import・動的 import・export … from も向きの違反になる', () => {
    const high = { 'lib/high/b.ts': 'export const b = 1;' };
    for (const line of ["import '../high/b.js';", "export const load = () => import('../high/b.js');", "export * from '../high/b.js';", "export { b } from '../high/b.js';"]) {
      expect(keysOf({ 'lib/low/a.ts': line, ...high })).toEqual(['lib/low/a.ts → lib/high/b.ts']);
    }
  });

  it('同じ辺が何本あっても違反は 1 行に畳む', () => {
    const keys = keysOf({ 'lib/low/a.ts': "import { b } from '../high/b.js';\nimport type { B } from '../high/b.js';", 'lib/high/b.ts': 'export const b = 1;' });
    expect(keys).toEqual(['lib/low/a.ts → lib/high/b.ts']);
  });

  it('未割り付けのファイルは赤(どの行にも当たらない)', () => {
    const report = checkLayering(tree({ 'lib/zzz/new.ts': 'export const x = 1;', 'lib/low/a.ts': 'export const a = 1;' }), MINI);
    expect(report.unassigned).toEqual(['lib/zzz/new.ts']);
    expect(layerOf('lib/zzz/new.ts', MINI)).toBeNull();
  });

  it('順位の無い層を宣言する行は表の不備として名指す', () => {
    const broken: LayerTable = { ...MINI, rows: [...MINI.rows, { pattern: /^lib\/x\//, layer: 'nowhere', reason: 'test' }] };
    expect(tableProblems(broken)).toHaveLength(1);
  });

  it('lib の外を読む・実体の無い相対 import も違反として数える', () => {
    const report = checkLayering(tree({ 'lib/low/a.ts': "import { x } from '../../cli/x.js';\nimport { y } from './missing.js';" }), MINI);
    expect(report.violations.map((violation) => [violation.key, violation.category])).toEqual([['lib/low/a.ts → cli/x.js', 'outside']]);
    expect(report.unresolved).toEqual(['lib/low/a.ts → ./missing.js']);
  });

  it('ディレクトリの index.ts と `.js` 指定を解く', () => {
    const graph = buildImportGraph(tree({ 'lib/low/a.ts': "import { d } from './dir';\nimport { e } from './e.js';", 'lib/low/dir/index.ts': '', 'lib/low/e.ts': '' }), 'lib/');
    expect(graph.edges.map((edge) => edge.to)).toEqual(['lib/low/dir/index.ts', 'lib/low/e.ts']);
  });
});

describe('わざと壊す確認: fs の入口', () => {
  it('宣言されていないファイルが node:fs を import すると赤', () => {
    expect(keysOf({ 'lib/high/v.ts': "import { readFileSync } from 'node:fs';" })).toEqual(['lib/high/v.ts → node:fs']);
  });

  it('node: の無い綴り・fs/promises・child_process も同じ', () => {
    for (const spec of ['fs', 'node:fs/promises', 'node:child_process']) {
      expect(keysOf({ 'lib/high/v.ts': `import x from '${spec}';` })).toEqual([`lib/high/v.ts → ${spec}`]);
    }
  });

  it('io 層(宣言された入口)は node:fs を読んでよい', () => {
    expect(keysOf({ 'lib/io/r.ts': "import { readFileSync } from 'node:fs';" })).toEqual([]);
  });

  it('型だけの import と、I/O でない組み込みモジュールは違反にしない', () => {
    expect(keysOf({ 'lib/high/v.ts': "import type { Dirent } from 'node:fs';\nimport path from 'node:path';" })).toEqual([]);
  });
});

describe('わざと壊す確認: 基線', () => {
  it('基線に無い違反は added に出る', () => {
    expect(diffBaseline(['a → b', 'c → d'], ['a → b'])).toEqual({ added: ['c → d'], removed: [] });
  });

  it('基線にあるのに現物に無い違反は removed に出る(減らし忘れ)', () => {
    expect(diffBaseline(['a → b'], ['a → b', 'c → d'])).toEqual({ added: [], removed: ['c → d'] });
  });

  it('一致すれば差は無い', () => {
    expect(diffBaseline(['a → b'], ['a → b'])).toEqual({ added: [], removed: [] });
  });
});

describe('readTsTree(木を再帰で読む)', () => {
  it('`.mts` / `.cts` / `.tsx` / `.mjs` / `.cjs` / `.js` も読む(現物が無くても、足した日に検査の範囲に入る)', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lib-layering-ext-'));
    try {
      for (const name of ['a.ts', 'b.mts', 'c.cts', 'd.tsx', 'e.mjs', 'f.cjs', 'g.js', 'h.json', 'i.md', 'j.d.ts.map']) writeFileSync(path.join(root, name), 'export {};');
      expect([...readTsTree(root, 'lib/').keys()]).toEqual(['lib/a.ts', 'lib/b.mts', 'lib/c.cts', 'lib/d.tsx', 'lib/e.mjs', 'lib/f.cjs', 'lib/g.js']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('入れ子のディレクトリを読み、対象の拡張子以外は読まない(名前で飛ばさない。点検 14 回目 C14-1)', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lib-layering-'));
    try {
      mkdirSync(path.join(root, 'a/b'), { recursive: true });
      mkdirSync(path.join(root, 'node_modules/x'), { recursive: true });
      writeFileSync(path.join(root, 'top.ts'), 'export {};');
      writeFileSync(path.join(root, 'a/b/deep.ts'), 'export {};');
      writeFileSync(path.join(root, 'a/readme.md'), '# x');
      writeFileSync(path.join(root, 'node_modules/x/dep.ts'), 'export {};');
      expect([...readTsTree(root, 'lib/').keys()]).toEqual(['lib/a/b/deep.ts', 'lib/node_modules/x/dep.ts', 'lib/top.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
