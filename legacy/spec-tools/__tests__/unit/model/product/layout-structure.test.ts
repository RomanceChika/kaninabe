/**
 * 層と土台ディレクトリの表(`source-root` の `structure`)の整合の検査(`layout-structure.ts`)のテスト。
 *
 * 合格側は本番の配置(Next.js)と架空の配置の両方。反例は、表の形(層の重なり・土台の重複・生成物の欄)と、
 * **表と役割の食い違い**(`placedBy`: 役割の置き場が名指した土台の外にある)を 1 つずつ。
 */

import { describe, expect, it } from 'vitest';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import { structureProblems } from '../../../../lib/model/product/layout-structure.js';
import type { BaseDirDecl, ProductLayout, RoleDecl, RoleStructure } from '../../../../lib/model/product/layout.js';
import { NEXTJS_LAYOUT, nextjsLayoutWith } from '../../../../lib/targets/nextjs/layout.js';
import { FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../helpers/platform.js';

const SOURCE: RoleDecl = NEXTJS_LAYOUT['source-root'] ?? failMissing();
const STRUCTURE: RoleStructure = SOURCE.structure ?? failMissing();

/** 元の値が足りないテストの書き間違いを知らせる。 */
function failMissing(): never {
  throw new Error('NEXTJS_LAYOUT に必要な宣言がありません');
}

/** 表を差し替えた配置。 */
function withStructure(change: (structure: RoleStructure) => Partial<RoleStructure>): ProductLayout {
  return { ...NEXTJS_LAYOUT, 'source-root': { ...SOURCE, structure: { ...STRUCTURE, ...change(STRUCTURE) } } };
}

/** 土台の 1 行を差し替えた配置(層と相対パスで指す)。 */
function withBaseDir(layer: string, dir: string, change: Partial<BaseDirDecl>): ProductLayout {
  return withStructure((structure) => ({
    baseDirs: structure.baseDirs.map((entry) => (entry.layer === layer && entry.dir === dir ? { ...entry, ...change } : entry)),
  }));
}

describe('structureProblems: 合格側', () => {
  it('本番の配置(Next.js)と架空の配置は、表の整合の検査を満たす(配置の定義の検査にも含まれる)', () => {
    expect(structureProblems(TEST_LAYOUT)).toEqual([]);
    expect(structureProblems(FOREIGN_LAYOUT)).toEqual([]);
    expect(layoutDefinitionProblems(TEST_LAYOUT)).toEqual([]);
    expect(layoutDefinitionProblems(FOREIGN_BODY_COMPATIBLE_LAYOUT)).toEqual([]);
  });

  it('source-root が無い配置(空の配置・役割の欠落)は、別の検査が先に言うのでここでは何も言わない', () => {
    expect(structureProblems({})).toEqual([]);
  });
});

describe('structureProblems: 表の宣言そのもの', () => {
  it('表を宣言できるのは source-root だけ', () => {
    const layout: ProductLayout = { ...NEXTJS_LAYOUT, 'http-entry': { ...(NEXTJS_LAYOUT['http-entry'] ?? failMissing()), structure: STRUCTURE } };

    expect(structureProblems(layout)).toEqual(['役割 http-entry: 層と土台の表(structure)を宣言できるのは source-root の役割だけです']);
  });

  it('source-root が表を宣言していないと、黙って空になる経路として指す', () => {
    const { structure: _structure, ...bare } = SOURCE;
    const problems = structureProblems({ ...NEXTJS_LAYOUT, 'source-root': bare });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('層と土台の表(structure)が宣言されていません');
  });

  it('足す層がコアの層の 4 名と重なる・足す層の名前が重複する・区切りを含む・説明が空', () => {
    const problems = structureProblems(
      withStructure((structure) => ({
        layers: [
          ...structure.layers,
          { name: 'operation', role: 'コアの名前', closedWorld: 'none' },
          { name: 'app', role: '重複', closedWorld: 'none' },
          { name: 'a/b', role: '区切り', closedWorld: 'none' },
          { name: 'empty_role', role: ' ', closedWorld: 'none' },
        ],
      })),
    );

    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('層 operation: コアの層の 4 名と重なっています'),
        expect.stringContaining('層 app: 層の名前が重複しています'),
        expect.stringContaining('層 a/b: 層の名前はソースの根の直下のディレクトリ名 1 つです'),
        expect.stringContaining('層 empty_role: 説明(role)が空です'),
      ]),
    );
  });

  it('土台: 層が無い・相対パスが不正・重複・説明が空・perSpec が生成物でない・生成物なのに走査する', () => {
    const base: BaseDirDecl = { root: 'product', layer: 'operation', dir: 'shared', role: 'x', generated: false, vocabularyScan: false, layout: 'flat', perSpec: false };
    const problems = structureProblems(
      withStructure((structure) => ({
        baseDirs: [
          ...structure.baseDirs,
          { ...base, layer: 'nowhere', dir: 'a' },
          { ...base, dir: '../escape' },
          { ...base, dir: 'shared' },
          { ...base, dir: 'blank', role: '' },
          { ...base, dir: 'per_spec_hand', perSpec: true },
          { ...base, dir: 'scanned_generated', generated: true, vocabularyScan: true },
        ],
      })),
    );

    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('土台 product nowhere/a: 属する層が'),
        expect.stringContaining('土台 product operation/../escape: 層の直下からの相対パスが不正です'),
        expect.stringContaining('土台 product operation/shared: 同じ土台が重複して宣言されています'),
        expect.stringContaining('土台 product operation/blank: 説明(role)が空です'),
        expect.stringContaining('土台 product operation/per_spec_hand: 仕様の量で決まる置き場(perSpec)は生成物(generated)だけです'),
        expect.stringContaining('土台 product operation/scanned_generated: 生成物の置き場は語彙漏れの走査に載せません'),
      ]),
    );
  });

  it('実行時パッケージの土台を宣言するのにソースの根が空', () => {
    const problems = structureProblems(withStructure(() => ({ runtimeSource: '' })));

    expect(problems).toEqual([expect.stringContaining('実行時パッケージのソースの根(runtimeSource)が不正です')]);
  });

  it('載せていない手書きの置き場: 層が無い・土台の表に載っているものと重なる・説明が空 / 補助ファイル: 層が無い・ファイル名が不正', () => {
    const problems = structureProblems(
      withStructure((structure) => ({
        unlistedDirs: [
          ...structure.unlistedDirs,
          { layer: 'nowhere', dir: 'a', role: 'x' },
          { layer: 'operation', dir: 'shared', role: '載っているものと重なる' },
          { layer: 'composition', dir: 'blank', role: '' },
        ],
        auxFiles: [...structure.auxFiles, { layer: 'nowhere', file: 'x.ts', role: 'x' }, { layer: 'operation', file: 'a/b.ts', role: 'x' }],
      })),
    );

    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('載せていない置き場 nowhere/a: 属する層がありません'),
        expect.stringContaining('載せていない置き場 operation/shared: 土台の表に載っている置き場と重なっています'),
        expect.stringContaining('載せていない置き場 composition/blank: 説明(role)が空です'),
        expect.stringContaining('補助ファイル nowhere/x.ts: 属する層がありません'),
        expect.stringContaining('補助ファイル operation/a/b.ts: ファイル名が不正です'),
      ]),
    );
  });
});

describe('structureProblems: 表と役割の食い違い(placedBy)', () => {
  it('役割の置き場が、名指した土台の中にあれば合格(Next.js の生成物の置き場 8 行は全部 placedBy を持つ)', () => {
    const placed = STRUCTURE.baseDirs.filter((entry) => entry.placedBy !== undefined).map((entry) => `${entry.layer}/${entry.dir}`);

    const routing = 'app';
    expect(placed.sort()).toEqual([`${routing}/_actions/platform`, 'app/_actions/usecase', 'app/_screens/generated', 'app/api/inbound', 'components/usecase/generated', 'composition/inbound', 'composition/platform', 'composition/usecase']);
  });

  it('土台の置き場を動かして、役割の置き場が外に出ると指す(役割の表と土台の表が別々に書かれて食い違う)', () => {
    const problems = structureProblems(withBaseDir('app', '_actions/usecase', { dir: '_moved/usecase' }));

    expect(problems).toEqual([expect.stringContaining('書き込む役割 save-entry の置き場 src/app/_actions/usecase/sample_usecase/sample_save.ts が、土台の置き場 src/app/_moved/usecase の外にあります')]);
  });

  it('名指した役割が語彙に無い・キーの見本が形に合わない・語彙の役割の欠落は下限の検査が言う', () => {
    const noRole = structureProblems(withBaseDir('app', '_actions/usecase', { placedBy: { role: 'no-such-role', key: 'a.b' } }));
    const badKey = structureProblems(withBaseDir('app', '_actions/usecase', { placedBy: { role: 'save-entry', key: 'no dot' } }));
    const { 'save-entry': _removed, ...withoutSaveEntry } = NEXTJS_LAYOUT;
    const missing = structureProblems(withoutSaveEntry);

    expect(noRole).toContainEqual(expect.stringContaining('書き込む役割 no-such-role が、コアの語彙の役割ではありません'));
    expect(badKey).toContainEqual(expect.stringContaining('キーの見本 no dot が、役割のキーの形に合いません'));
    // 語彙の役割の欠落は、下限の検査が言う(表の検査は同じ欠落を 2 度言わない)。
    expect(missing).toEqual([]);
    expect(layoutDefinitionProblems(withoutSaveEntry)).toEqual(['役割 save-entry: 多重度の下限が 1 の役割なのに、配置に宣言がありません']);
  });

  it('source-root の置き場が決められない配置では、名指した役割の置き場を決められないと言う', () => {
    const broken: ProductLayout = { ...NEXTJS_LAYOUT, 'source-root': { ...SOURCE, base: 'no-such-base' } };

    expect(structureProblems(broken).some((problem) => problem.includes('置き場を決められません'))).toBe(true);
  });
});

describe('structureProblems: コアが前提にする土台・perSpec の名指し・コアの層の入れ子・逆引きとの一致(部品化 ③-c6)', () => {
  /** 土台の行を取り除いた配置。 */
  function withoutBaseDir(layer: string, dir: string): ProductLayout {
    return withStructure((structure) => ({ baseDirs: structure.baseDirs.filter((entry) => !(entry.layer === layer && entry.dir === dir)) }));
  }

  it('コアが前提にする土台(保存点の hooks・操作と基盤のテスト支援)の宣言が無いと、使う側を名指して止める', () => {
    for (const [layer, dir, usedBy] of [
      ['operation', 'usecase', '保存点の hooks'],
      ['operation', '__tests__', '認証の期待表'],
      ['infrastructure', '__tests__', 'T3'],
    ] as const) {
      const problems = structureProblems(withoutBaseDir(layer, dir));

      expect(problems, `${layer}/${dir}`).toContainEqual(expect.stringContaining(`土台 ${layer}/${dir}: コアが前提にする土台なのに、宣言がありません(${usedBy}`));
      expect(layoutDefinitionProblems(withoutBaseDir(layer, dir)), `${layer}/${dir}(定義の検査にも含まれる)`).toContainEqual(expect.stringContaining('コアが前提にする土台'));
    }
  });

  it('載せていない手書きの置き場として宣言しても、前提を満たす(`layoutBaseDirPath` が引ける範囲)', () => {
    const layout = withStructure((structure) => ({
      baseDirs: structure.baseDirs.filter((entry) => !(entry.layer === 'operation' && entry.dir === 'usecase')),
      unlistedDirs: [...structure.unlistedDirs, { layer: 'operation', dir: 'usecase', role: '手書きの hooks' }],
    }));

    expect(structureProblems(layout).filter((problem) => problem.includes('コアが前提にする土台'))).toEqual([]);
  });

  it('仕様の量で決まる生成物の置き場(perSpec)は placedBy が必須・実行時パッケージの土台は placedBy を書けない', () => {
    const noName = structureProblems(
      withStructure((structure) => ({
        baseDirs: structure.baseDirs.map((entry) => {
          const { placedBy: _placedBy, ...rest } = entry;
          return entry.layer === 'composition' && entry.dir === 'inbound' ? rest : entry;
        }),
      })),
    );
    const onRuntime = structureProblems(withBaseDir('domain', 'engine', { placedBy: { role: 'save-entry', key: 'a.b' } }));

    expect(noName).toContainEqual(expect.stringContaining('土台 product composition/inbound: 仕様の量で決まる生成物の置き場(perSpec)は、書き込む役割を placedBy で名指します'));
    expect(onRuntime).toContainEqual(expect.stringContaining('土台 framework domain/engine: 実行時パッケージの土台は、製品の木の役割の置き場の相手ではありません'));
  });

  it('コアの層の土台が入れ子(dir に区切り)だと、X1 の全パス一致と逆引きの先頭 1 段が食い違うので指す(足した層は入れ子でよい)', () => {
    const base: BaseDirDecl = { root: 'product', layer: 'operation', dir: 'a/b', role: 'x', generated: false, vocabularyScan: false, layout: 'flat', perSpec: false };
    const nestedCore = structureProblems(withStructure((structure) => ({ baseDirs: [...structure.baseDirs, base] })));
    const nestedUnlisted = structureProblems(withStructure((structure) => ({ unlistedDirs: [...structure.unlistedDirs, { layer: 'composition', dir: 'a/b', role: 'x' }] })));
    const nestedAdded = structureProblems(withStructure((structure) => ({ baseDirs: [...structure.baseDirs, { ...base, layer: 'app', dir: 'a/b' }] })));

    expect(nestedCore).toContainEqual(expect.stringContaining('土台 product operation/a/b: コアの層の土台は、層の直下の 1 段のディレクトリです'));
    expect(nestedUnlisted).toContainEqual(expect.stringContaining('載せていない置き場 composition/a/b: コアの層の土台は、層の直下の 1 段のディレクトリです'));
    expect(nestedAdded.filter((problem) => problem.includes('1 段のディレクトリ'))).toEqual([]);
  });

  it('逆引きと表の一致: 逆引きが除いていない土台(表だけに足した)は、その下のファイルが操作などと読まれるので指す', () => {
    // 逆引きの除外は元の表で作られたまま、表だけに土台を足した配置(別々に書かれて食い違う形)。
    const drifted = withStructure((structure) => ({
      unlistedDirs: [
        ...structure.unlistedDirs,
        { layer: 'operation', dir: 'extra', role: '足した置き場' },
        { layer: 'infrastructure', dir: 'extra', role: '足した置き場' },
        { layer: 'composition', dir: 'extra', role: '足した置き場' },
      ],
    }));
    const problems = structureProblems(drifted);

    for (const role of ['operation-logic', 'operation-composition', 'infrastructure']) {
      expect(problems, role).toContainEqual(expect.stringContaining(`が、役割 ${role} の実体`));
    }
    // 表から作り直した配置では一致する。
    expect(structureProblems(nextjsLayoutWith(drifted['source-root']?.structure ?? failMissing()))).toEqual([]);
  });

  it('逆引きは書き込む役割の相手には掛けない(土台を書く役割自身の実体は、その土台の下に居てよい)', () => {
    // 実物の配置では、保存点の入口の土台 app/_actions/usecase の下を操作の入口の逆引きが読んでも null で、書き込む役割 save-entry 自身は実体として読む。
    expect(structureProblems(NEXTJS_LAYOUT)).toEqual([]);
  });
});
