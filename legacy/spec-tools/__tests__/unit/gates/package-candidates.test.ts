import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTsTree } from '../../../lib/io/read-ts-tree.js';
import { candidateOf, candidateTableProblems, checkCandidates, dbGeneratorProblems } from '../../../lib/gates/candidate-check.js';
import type { CandidateTable } from '../../../lib/gates/candidate-check.js';
import { layerOf } from '../../../lib/gates/layer-check.js';
import type { LayerTable } from '../../../lib/gates/layer-check.js';
import { CLOSURE_BANS, EDGE_BANS, IO_MODULES, IO_ROWS, LAYER_ENTRANCES, LAYER_RANK, LAYER_ROWS, TARGET_BOUNDARIES } from '../../../lib/gates/lib-layers.js';
import { CANDIDATE_RANK, CANDIDATE_ROWS, DB_GENERATOR_FILES } from '../../../lib/gates/package-candidates.js';

/**
 * **パッケージの候補の間の依存の向き**を構造テストで見る(C28 の続き。設計メモ framework-modules §18・§21)。
 *
 * 層の表(`lib-layering.test.ts`)は 1 パッケージの中の層の向き、ここは将来の切れ目の候補(core-base / core-kinds / semantics / kit / db / check / gen / ops /
 * contract / targets / root)の間の向き。**基線も免除の口も持たない**: 下の候補が上の候補を読む辺(型だけの import も)は 1 本でも赤で、
 * 「候補の相互依存 0(DAG)」はこの順位の表が成り立つことそのもの。
 */

const LIB_DIR = fileURLToPath(new URL('../../../lib/', import.meta.url));
const CLI_DIR = fileURLToPath(new URL('../../../cli/', import.meta.url));

const TABLE: CandidateTable = { rank: CANDIDATE_RANK, rows: CANDIDATE_ROWS, rootPrefix: ['lib/', 'cli/'] };
const LAYER_TABLE: LayerTable = { rank: LAYER_RANK, rows: LAYER_ROWS, ioRows: IO_ROWS, ioModules: IO_MODULES, rootPrefix: ['lib/', 'cli/'], closureBans: CLOSURE_BANS, entrances: LAYER_ENTRANCES, targets: TARGET_BOUNDARIES, edgeBans: EDGE_BANS };

/** わざと壊す確認用の小さい表。 */
const MINI: CandidateTable = {
  rank: { low: 0, high: 1, left: 2, right: 2 },
  rows: [
    { pattern: /^lib\/low\//, candidate: 'low', reason: 'test' },
    { pattern: /^lib\/high\//, candidate: 'high', reason: 'test' },
    { pattern: /^lib\/left\//, candidate: 'left', reason: 'test' },
    { pattern: /^lib\/right\//, candidate: 'right', reason: 'test' },
  ],
  rootPrefix: 'lib/',
};

/** gen が db を読む辺(下向き。SQL を書き出さずに、SQL 側の語彙・型の分類を借りる 3 本)。 */
const GEN_TO_DB: readonly string[] = [
  'lib/generate/message-fragments.ts → lib/sql/framework-guards.ts',
  'lib/generate/message-fragments.ts → lib/sql/framework-tables.ts',
  'lib/generate/render/code-zod-field.ts → lib/sql/sql-types.ts',
];

function keysOf(files: Readonly<Record<string, string>>): readonly string[] {
  return checkCandidates(new Map(Object.entries(files)), MINI).violations.map((violation) => violation.key);
}

describe('lib と cli の実物(パッケージの候補の間の向き)', () => {
  const sources = new Map([...readTsTree(LIB_DIR, 'lib/'), ...readTsTree(CLI_DIR, 'cli/')]);
  const report = checkCandidates(sources, TABLE);
  const files = [...sources.keys()];

  it('走査の母集合が空でない・表が壊れていない', () => {
    expect(files.length).toBeGreaterThan(900);
    expect(candidateTableProblems(TABLE)).toEqual([]);
  });

  it('未割り付けのファイルは 0(新しいディレクトリは package-candidates.ts に 1 行足して候補を選ぶ)', () => {
    expect(report.unassigned).toEqual([]);
  });

  it('候補をまたぐ import に向きの逆流が 0(型だけの import も。基線も免除も持たない)= 候補の相互依存 0', () => {
    expect(report.violations.map((violation) => `${violation.key}  ${violation.detail}`)).toEqual([]);
  });

  it('どの候補にもファイルがある(表の行が空振りでない)', () => {
    for (const candidate of Object.keys(CANDIDATE_RANK)) expect(report.sizes.get(candidate) ?? 0, candidate).toBeGreaterThan(0);
    for (const row of CANDIDATE_ROWS) expect(files.some((file) => row.pattern.test(file)), String(row.pattern)).toBe(true);
  });

  it('SQL を書き出す生成器の名指しは全部実在し、db に数えられる(腐った名指しを残さない)', () => {
    for (const name of DB_GENERATOR_FILES) {
      const file = `lib/generate/render/${name}.ts`;
      expect(files, file).toContain(file);
      expect(candidateOf(file, TABLE), file).toBe('db');
    }
  });

  it('SQL を書き出す生成器の名指しは腐っていない: 各ファイルは lib/sql/** を値で読むか、それを読む名指しのファイルに値で読まれる', () => {
    expect(dbGeneratorProblems(sources, DB_GENERATOR_FILES, ['lib/', 'cli/'])).toEqual([]);
  });

  it('名指しの登録漏れは gen → db の辺で見える: gen が lib/sql/** を読む辺は名指しの 3 本だけ(増えたら新しい SQL の生成器を DB_GENERATOR_FILES に載せ忘れていないか確認する。減るのは歓迎)', () => {
    expect(report.crossingFiles.get('gen → db')).toEqual(GEN_TO_DB);
  });

  it('いま切れている 2 組: db は gen にも check にも依らず、土台と道具箱と意味の層だけを読む(db → gen 0・db → check 0)', () => {
    const reads = (from: string): string[] => [...report.crossings.keys()].filter((key) => key.startsWith(`${from} → `)).map((key) => key.slice(from.length + 3)).sort();
    expect(reads('db')).toEqual(['core-base', 'core-kinds', 'kit', 'semantics']);
    expect(reads('kit')).toEqual(['core-base', 'core-kinds', 'semantics']);
    expect(reads('semantics')).toEqual(['core-base', 'core-kinds']);
    expect(reads('core-kinds')).toEqual(['core-base']);
    expect(reads('core-base'), '土台は何の候補も読まない(葉)').toEqual([]);
    expect(reads('root'), '組み立ての根はどの候補も読む').toEqual(['check', 'contract', 'core-base', 'core-kinds', 'db', 'gen', 'kit', 'ops', 'semantics', 'targets']);
  });

  it('残る下向きの辺のうち check → db は名指しで固定する(拡張候補の台帳が DB の検査の理由の語を読む 2 本。減るのは歓迎・増えたら宿題の確認)', () => {
    expect(report.crossingFiles.get('check → db')).toEqual(['lib/extension/scope.ts → lib/data/check-reasons.ts', 'lib/extension/scope.ts → lib/data/index-reasons.ts']);
  });

  it('core を土台と種類に割る(P1): 共有の 3 ファイルは土台・種類側の型を置く 4 ファイルは種類・製品の根の宣言の検査は check・`model/product` は土台のまま', () => {
    const of = (file: string): string | null => candidateOf(file, TABLE);
    for (const file of ['lib/model/sql-fields.ts', 'lib/model/parse-test-case.ts', 'lib/model/parse-lint-exceptions.ts', 'lib/model/types.ts', 'lib/model/product/types.ts', 'lib/io/read-ts-tree.ts', 'lib/guard/ast.ts']) {
      expect(files, file).toContain(file);
      expect(of(file), file).toBe('core-base');
    }
    for (const file of ['lib/model/data/ceiling-plan.ts', 'lib/model/data/cross-check-shape.ts', 'lib/model/external/abuse-exposure.ts', 'lib/model/notification/effect-refs.ts', 'lib/model/screen/parse-screen.ts']) {
      expect(files, file).toContain(file);
      expect(of(file), file).toBe('core-kinds');
    }
    for (const file of files.filter((name) => name.startsWith('lib/product/'))) expect(of(file), file).toBe('check');
    expect(CANDIDATE_RANK['core-base']).toBeLessThan(CANDIDATE_RANK['core-kinds'] ?? -Infinity);
    expect(CANDIDATE_RANK['core-kinds']).toBeLessThan(CANDIDATE_RANK['semantics'] ?? -Infinity);
  });

  it('土台が種類を読むと赤(値でも型でも・直下の型ファイルでも `lib/guard` でも)・種類が土台を読むのは緑・種類どうしは緑', () => {
    const broken = (file: string, line: string): readonly string[] => {
      const next = new Map(sources);
      next.set(file, `${next.get(file) ?? ''}\n${line}\n`);
      return checkCandidates(next, TABLE).violations.map((violation) => violation.key);
    };
    expect(broken('lib/model/parse-entity.ts', "import { SQL_FIELD_NAMES } from './data/types.js';")).toContain('lib/model/parse-entity.ts → lib/model/data/types.ts');
    expect(broken('lib/model/types.ts', "import type { ExternalCatalogSpec } from './external/types.js';")).toContain('lib/model/types.ts → lib/model/external/types.ts');
    expect(broken('lib/model/sql-fields.ts', "export type { TraceModel } from './trace/types.js';")).toContain('lib/model/sql-fields.ts → lib/model/trace/types.ts');
    expect(broken('lib/guard/ast.ts', "import type { T } from '../model/screen/types.js';")).toContain('lib/guard/ast.ts → lib/model/screen/types.ts');
    expect(broken('lib/model/data/parse-data-table.ts', "import { x } from '../screen/parse-screen.js';")).toEqual([]);
    expect(broken('lib/model/screen/parse-screen.ts', "import type { SpecModel } from '../types.js';")).toEqual([]);
  });

  it('候補の見取り図が崩れていない: 道具箱 → 生成の向きはなく、生成・DB の生成器・ハンドブックが道具箱を読む(道具箱が空振りでない)', () => {
    expect(report.crossings.get('kit → gen')).toBeUndefined();
    expect(report.crossings.get('gen → kit') ?? 0).toBeGreaterThan(100);
    expect(report.crossings.get('db → kit') ?? 0).toBeGreaterThan(10);
  });

  it('入口(cli と lib/compose)はどの候補からも読まれない(根は葉)', () => {
    expect([...report.crossings.keys()].filter((key) => key.endsWith(' → root'))).toEqual([]);
    const intoRoot = [...sources.keys()].filter((file) => candidateOf(file, TABLE) !== 'root').flatMap((file) => [...(sources.get(file) ?? '').matchAll(/from '[^']*\/(compose|cli)\//g)]);
    expect(intoRoot).toEqual([]);
  });

  it('実木に逆流を足すと赤になる(わざと壊す: 道具箱が SQL の層を読む・SQL の層が生成器を読む・意味の層が検査を読む)', () => {
    const broken = (file: string, line: string): readonly string[] => {
      const next = new Map(sources);
      next.set(file, `${next.get(file) ?? ''}\n${line}\n`);
      return checkCandidates(next, TABLE).violations.map((violation) => violation.key);
    };
    expect(broken('lib/gen-kit/generator.ts', "import type { RpcBody } from '../sql/rpc-body.js';")).toContain('lib/gen-kit/generator.ts → lib/sql/rpc-body.ts');
    expect(broken('lib/sql/rpc-body.ts', "import type { DocGenerator } from '../generate/render/book/chapters.js';")).toContain('lib/sql/rpc-body.ts → lib/generate/render/book/chapters.ts');
    expect(broken('lib/semantics/domain-index.ts', "import type { Verifier } from '../check-api/contract.js';")).toContain('lib/semantics/domain-index.ts → lib/check-api/contract.ts');
  });

  it('道具箱 lib/gen-kit/ は独立の層: 上の候補(検査・DB・生成)を読む import を足すと赤・下の候補(意味の層)が道具箱を読むのも赤(値でも型でも)', () => {
    const broken = (file: string, line: string): readonly string[] => {
      const next = new Map(sources);
      next.set(file, `${next.get(file) ?? ''}\n${line}\n`);
      return checkCandidates(next, TABLE).violations.map((violation) => violation.key);
    };
    expect(broken('lib/gen-kit/code-emit.ts', "import type { Verifier } from '../check-api/contract.js';")).toContain('lib/gen-kit/code-emit.ts → lib/check-api/contract.ts');
    expect(broken('lib/gen-kit/code-emit.ts', "import { x } from '../generate/render/code-ddl.js';")).toContain('lib/gen-kit/code-emit.ts → lib/generate/render/code-ddl.ts');
    expect(broken('lib/gen-kit/generator.ts', "import type { Y } from '../generate/generate-context.js';")).toContain('lib/gen-kit/generator.ts → lib/generate/generate-context.ts');
    expect(broken('lib/gen-kit/generator.ts', "import '../data/check-reasons.js';")).toContain('lib/gen-kit/generator.ts → lib/data/check-reasons.ts');
    expect(broken('lib/semantics/domain-index.ts', "import type { G } from '../gen-kit/generator.js';")).toContain('lib/semantics/domain-index.ts → lib/gen-kit/generator.ts');
    expect(broken('lib/model/types.ts', "export { emit } from '../gen-kit/code-emit.js';")).toContain('lib/model/types.ts → lib/gen-kit/code-emit.ts');
  });

  it('候補の表と層の表が食い違わない: 道具箱の全ファイルは候補 kit かつ層 kit・新しい lib 直下のディレクトリは割り当てが無ければ赤(割り当ての漏れを防ぐ)', () => {
    const kitFiles = files.filter((file) => file.startsWith('lib/gen-kit/'));
    expect(kitFiles.length).toBeGreaterThan(3);
    expect(kitFiles.filter((file) => candidateOf(file, TABLE) !== 'kit' || layerOf(file, LAYER_TABLE) !== 'kit')).toEqual([]);
    expect(CANDIDATE_RANK['kit']).toBeGreaterThan(CANDIDATE_RANK['semantics'] ?? Infinity);
    expect(CANDIDATE_RANK['kit']).toBeLessThan(Math.min(...['db', 'check', 'gen'].map((name) => CANDIDATE_RANK[name] ?? -Infinity)));
    const withNewDir = new Map(sources);
    withNewDir.set('lib/brand-new-kind/a.ts', 'export const a = 1;');
    expect(checkCandidates(withNewDir, TABLE).unassigned).toEqual(['lib/brand-new-kind/a.ts']);
  });

  it('実木にわざと壊す(SQL を書き出す生成器の名指し): 載せ忘れた新しい SQL の生成器は gen → db の辺が増えて固定が破れる・名指しの本体を腐らせると赤', () => {
    const withNewGenerator = new Map(sources);
    withNewGenerator.set('lib/generate/render/code-new-sql.ts', "import { isNumeric } from '../../sql/sql-types.js';\nexport const n = isNumeric;");
    expect(checkCandidates(withNewGenerator, TABLE).crossingFiles.get('gen → db')).toEqual([...GEN_TO_DB, 'lib/generate/render/code-new-sql.ts → lib/sql/sql-types.ts'].sort());
    expect(dbGeneratorProblems(sources, [...DB_GENERATOR_FILES, 'code-zod-field'], ['lib/', 'cli/'])).toEqual([]);
    expect(dbGeneratorProblems(sources, [...DB_GENERATOR_FILES, 'code-bool-field'], ['lib/', 'cli/'])).toEqual(['lib/generate/render/code-bool-field.ts']);
    const rotted = new Map(sources);
    rotted.set('lib/generate/render/code-ddl.ts', 'export const x = 1;');
    expect(dbGeneratorProblems(rotted, DB_GENERATOR_FILES, ['lib/', 'cli/'])).toContain('lib/generate/render/code-ddl.ts');
  });
});

describe('わざと壊す確認: 候補の向き', () => {
  it('下の候補が上の候補を読むと赤(値でも型でも副作用でも)', () => {
    for (const line of ["import { b } from '../high/b.js';", "import type { b } from '../high/b.js';", "import '../high/b.js';", "export { b } from '../high/b.js';"]) {
      expect(keysOf({ 'lib/low/a.ts': line, 'lib/high/b.ts': 'export const b = 1;' }), line).toEqual(['lib/low/a.ts → lib/high/b.ts']);
    }
  });

  it('上の候補が下の候補を読むのは緑・同じ候補の中は何を読んでもよい', () => {
    expect(keysOf({ 'lib/high/a.ts': "import { b } from '../low/b.js';", 'lib/low/b.ts': "import { c } from './c.js';", 'lib/low/c.ts': 'export const c = 1;' })).toEqual([]);
  });

  it('同じ順位の別の候補は互いを読まない(左右どちらの向きも赤)', () => {
    expect(keysOf({ 'lib/left/a.ts': "import { b } from '../right/b.js';", 'lib/right/b.ts': 'export const b = 1;' })).toEqual(['lib/left/a.ts → lib/right/b.ts']);
    expect(keysOf({ 'lib/right/a.ts': "import { b } from '../left/b.js';", 'lib/left/b.ts': 'export const b = 1;' })).toEqual(['lib/right/a.ts → lib/left/b.ts']);
  });

  it('表に当たらないファイルは未割り付け・順位の無い候補を宣言する行は表の不備', () => {
    expect(checkCandidates(new Map([['lib/zz/a.ts', 'export const a = 1;']]), MINI).unassigned).toEqual(['lib/zz/a.ts']);
    expect(candidateTableProblems({ ...MINI, rows: [...MINI.rows, { pattern: /^lib\/x\//, candidate: 'nowhere', reason: 'test' }] })).toHaveLength(1);
  });

  it('候補をまたぐ辺の本数を数える(向きの正しい辺も)', () => {
    const report = checkCandidates(new Map(Object.entries({ 'lib/high/a.ts': "import { b } from '../low/b.js';\nimport { c } from '../low/c.js';", 'lib/low/b.ts': 'export const b = 1;', 'lib/low/c.ts': 'export const c = 1;' })), MINI);
    expect(report.crossings.get('high → low')).toBe(2);
    expect(report.sizes.get('low')).toBe(2);
  });
});

describe('わざと壊す確認: SQL を書き出す生成器の名指し', () => {
  const problems = (files: Readonly<Record<string, string>>, names: readonly string[]): readonly string[] => dbGeneratorProblems(new Map(Object.entries(files)), names, 'lib/');
  const SQL = { 'lib/sql/types.ts': 'export type T = 1;\nexport const t = 1;' };

  it('lib/sql/** を値で読む生成器・それに値で読まれる補助は緑', () => {
    expect(
      problems(
        {
          ...SQL,
          'lib/generate/render/code-a.ts': "import { t } from '../../sql/types.js';\nimport { h } from './code-a-types.js';\nexport const a = [t, h];",
          'lib/generate/render/code-a-types.ts': 'export const h = 1;',
        },
        ['code-a', 'code-a-types'],
      ),
    ).toEqual([]);
  });

  it('型だけの import は SQL を書き出す印にならない・補助を読むのが名指しの外のファイルなら補助にならない', () => {
    expect(problems({ ...SQL, 'lib/generate/render/code-a.ts': "import type { T } from '../../sql/types.js';\nexport type A = T;" }, ['code-a'])).toEqual(['lib/generate/render/code-a.ts']);
    expect(
      problems(
        { ...SQL, 'lib/generate/render/code-a.ts': "import { h } from './code-a-types.js';\nexport const a = h;", 'lib/generate/render/code-a-types.ts': 'export const h = 1;' },
        ['code-a-types'],
      ),
    ).toEqual(['lib/generate/render/code-a-types.ts']);
  });

  it('実在しない名指しも赤(昇順)', () => {
    expect(problems({ ...SQL, 'lib/generate/render/code-z.ts': "import { t } from '../../sql/types.js';\nexport const z = t;" }, ['code-z', 'code-b', 'code-a'])).toEqual([
      'lib/generate/render/code-a.ts',
      'lib/generate/render/code-b.ts',
    ]);
  });
});
