/**
 * 仕組みの土台(層と土台ディレクトリ)の宣言を app 側の生成物に写す部分。
 *
 * `code-structure-expectations.ts` が操作ごとのファイルの期待を出すのに対し、ここは仕組みの
 * 土台の宣言を写す。正は置き場の配置の `source-root` が宣言する層と土台の表(`RoleStructure`。コアの層の 4 名は `lib/model/framework-dirs.ts`)であり、ここはその機械的な写像である
 * (`lib/model/framework-base-dirs.ts` の口が配置から解く)。
 *
 * **同じ宣言を 2 つの形で出す。** 消費者の読み方が 2 種類あるためで、どちらも生成物なので
 * 版ズレは `generate:check` が差分で捕まえる。
 *   - TypeScript(`structure-expectations.ts` に相乗り): 構造テストが型つきで読む。
 *   - JSON(`framework-structure.json`): ESLint の設定と ローカルルール(Node が直に実行する
 *     `.mjs`)が `import ... with { type: 'json' }` で読む —— TypeScript を経由できない消費者。
 *     `lint-exceptions.json` と同じ理由の JSON である。
 */

import { foundationPackagesOf, frameworkAuxFiles, frameworkBaseDirs, frameworkLayers } from '../../model/framework-base-dirs.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { GeneratedSection } from '../../gen-kit/generator.js';
import { generatedFile, docComment, renderLiteral } from '../../gen-kit/code-emit.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { frozen } from '../../gen-kit/frozen-constants.js';

/** JSON 側の出力先(リポジトリルート相対)。app 側は `src/domain/generated/framework-structure.json`。 */
const jsonOutputFile = (roots: ProductRoots): string => generatedFile(roots, 'framework-structure.json');

/** 層の宣言をリテラルに写す。 */
function layersLiteral(layout: ProductLayout): LiteralValue {
  return frameworkLayers(layout).map((layer) => ({
    name: layer.name,
    role: layer.role,
    closedWorld: layer.closedWorld,
  }));
}

/** 土台ディレクトリの宣言をリテラルに写す。 */
function baseDirsLiteral(layout: ProductLayout): LiteralValue {
  return frameworkBaseDirs(layout).map((entry) => ({
    root: entry.root,
    path: entry.path,
    role: entry.role,
    generated: entry.generated,
    vocabularyScan: entry.vocabularyScan,
    layout: entry.layout,
    perSpec: entry.perSpec,
    sdkPackages: [...entry.sdkPackages],
  }));
}

/** 補助ファイルの宣言をリテラルに写す。 */
function auxFilesLiteral(layout: ProductLayout): LiteralValue {
  return frameworkAuxFiles(layout).map((entry) => ({ layer: entry.layer, file: entry.file, role: entry.role }));
}

/**
 * TypeScript 側の行(`structure-expectations.ts` の末尾に足す)。
 *
 * @param layout 置き場の配置(層と土台の表の宣言元)
 * @returns 型宣言と 3 つの定数
 */
export function renderFrameworkLines(layout: ProductLayout): readonly string[] {
  return [
    docComment(['層 1 つの宣言(ARCH-BE-0001 の層構造)。']),
    'export interface FrameworkLayerDecl {',
    '  /** `src/` 直下のディレクトリ名(= 層の名前)。 */',
    '  readonly name: string;',
    '  /** 何の層か(人が読む説明)。 */',
    '  readonly role: string;',
    '  /** 直下の閉世界を誰が見るか(structure_test = 構造テスト / verifier = docs 側の検証器 / none = 見ていない)。 */',
    "  readonly closedWorld: 'structure_test' | 'verifier' | 'none';",
    '}',
    '',
    docComment(['層の直下にある「集約でないディレクトリ」1 つの宣言。']),
    'export interface FrameworkBaseDirDecl {',
    '  /**',
    '   * どちらの根に住んでいるか。',
    '   *',
    '   * product = 製品の実装の木からの相対 / framework = 実行時パッケージ @kaninabe/runtime からの相対。',
    '   * **製品側の検査が見るのは product だけ**である —— framework の土台は製品の src/ に',
    '   * 存在しないので、期待に混ぜると「あるはずのディレクトリが無い」と嘘を言う(ADR-0013)。',
    '   */',
    "  readonly root: 'product' | 'framework';",
    '  /** 根からの相対パス(例: "src/operation/usecase")。 */',
    '  readonly path: string;',
    '  /** 何の置き場か(人が読む説明)。 */',
    '  readonly role: string;',
    '  /** 配下が生成物か(ヘッダ必須・手書きの品質規則の対象外)。 */',
    '  readonly generated: boolean;',
    '  /** 仕組みの手書きコードとして語彙漏れの走査(W1)に載せるか。 */',
    '  readonly vocabularyScan: boolean;',
    '  /** 中身の並び方(flat = 直下にファイル / nested = 1 段のサブディレクトリの下)。 */',
    "  readonly layout: 'flat' | 'nested';",
    '  /**',
    '   * 中身がそのアプリの仕様の量で決まるか(生成物の置き場だけが true になりうる)。',
    '   * true の置き場は、期待ファイル木がそこに 1 件も名指ししていないアプリでは**存在しない**',
    '   * (空のディレクトリを置かない)。',
    '   */',
    '  readonly perSpec: boolean;',
    '  /** この土台の下でだけ値として import してよい外部の SDK のパッケージ(`@scope/*` の綴りを含む。無ければ空)。 */',
    '  readonly sdkPackages: readonly string[];',
    '}',
    '',
    docComment([
      '層の宣言(`src/` 直下の閉世界)。正は legacy/spec-tools/lib/model/framework-dirs.ts。',
      '',
      'ここに無い名前のディレクトリが `src/` 直下に現れたら、それはどの層にも属さないコードで',
      'あり、層境界の ESLint の検査の範囲外に落ちる —— 構造テストが閉世界で見る。',
    ]),
    `export const frameworkLayers: readonly FrameworkLayerDecl[] = ${frozen(renderLiteral(layersLiteral(layout)))};`,
    '',
    docComment([
      '土台ディレクトリの宣言(層の直下の閉世界)。正は legacy/spec-tools/lib/model/framework-dirs.ts。',
      '',
      '集約でないディレクトリ(定型・共有物・ジョブ基盤・接続層・保存点・生成物・テスト支援)は',
      '**フレームワークが形として決めているもの**であり、各検査・lint が免除リストとして別々に',
      '持つのではなく、この 1 つの宣言を読む。',
    ]),
    `export const frameworkBaseDirs: readonly FrameworkBaseDirDecl[] = ${frozen(renderLiteral(baseDirsLiteral(layout)))};`,
    '',
    docComment(['集約ディレクトリの直下にあって、ドメインイベントに対応しないファイル 1 つの宣言。']),
    'export interface FrameworkAuxFileDecl {',
    '  /** どの層の集約ディレクトリの直下か。 */',
    '  readonly layer: string;',
    '  /** ファイル名(拡張子込み)。 */',
    '  readonly file: string;',
    '  /** 何のファイルか(人が読む説明)。 */',
    '  readonly role: string;',
    '}',
    '',
    docComment([
      '補助ファイルの宣言(集約ディレクトリの中の閉世界)。正は framework-dirs.ts。',
      '',
      '「1 ドメインイベント = 1 ファイル」の例外はこれだけである。',
    ]),
    `export const frameworkAuxFiles: readonly FrameworkAuxFileDecl[] = ${frozen(renderLiteral(auxFilesLiteral(layout)))};`,
    '',
  ];
}

/**
 * JSON 側の生成物(ESLint の設定とローカルルールが読む)。
 *
 * JSON はコメントを持てないため、鮮度と由来は `"$generated"` キーに埋め込む
 * (`lint-exceptions.json` と同じ形)。
 *
 * @param roots 製品が宣言した根(生成物の置き場)
 * @param layout 置き場の配置(層と土台の表の宣言元)
 * @returns 生成セクション 1 件
 */
export function frameworkStructureJsonSection(roots: ProductRoots, layout: ProductLayout): GeneratedSection {
  const body = {
    $generated:
      'AUTO-GENERATED by `npm run generate` — 手編集禁止。正は legacy/spec-tools/lib/model/framework-dirs.ts。',
    layers: layersLiteral(layout),
    baseDirs: baseDirsLiteral(layout),
    auxFiles: auxFilesLiteral(layout),
    // 枠の基盤のパッケージ(どの層も値として引ける外部パッケージ)。ESLint の許可表と同じ綴りであることを app 側のテストが見る。
    foundationPackages: [...foundationPackagesOf(layout)],
  };
  return { file: jsonOutputFile(roots), content: `${JSON.stringify(body, null, 2)}\n`, wholeFile: true };
}
