/**
 * 層と土台ディレクトリの**配置からの引き口**(部品化 ③-c5。以前は土台の表そのものがここにあった)。
 *
 * 土台の表(層の直下の「集約でないディレクトリ」の全数)は、アプリの枠の後段が与える置き場の配置の `source-root` の役割が宣言する(`RoleStructure`。
 * 値は `lib/targets/<後段>/layout.ts`)。ここは、その宣言を**解く**だけの純関数である —— 層の 4 名(コアの語。`CORE_LAYERS`)に配置が足す層を並べ、
 * 土台の置き場を `{ソースの根}/{層}/{dir}`(`root: 'framework'` は実行時パッケージのソースの根から)に解き、検査・生成・走査が使う形(パスの集合・走査の入力・
 * 解決した表)にして返す。**スタックの綴り(`_actions` ・`components` ほか)は 1 つも持たない**(配置の値だけが持つ)。
 *
 * 配置が無い構成(アプリの枠の後段を選ばない = 実装の木を持たない製品)・配置が `structure` を宣言していない構成は、層はコアの 4 名だけ・土台は 0 件になる
 * (配置が `structure` を宣言していないことは配置の定義の検査が止めるので、実物の構成では起きない)。
 */

import { CORE_LAYERS } from './framework-dirs.js';
import type { FrameworkAuxFile, FrameworkBaseDir, FrameworkLayer } from './framework-dirs.js';
import { layoutPath } from './product/layout.js';
import type { ProductLayout, RoleStructure } from './product/layout.js';

/**
 * 配置が宣言した層と土台の表(`source-root` の役割が持つ)。
 *
 * @param layout アプリの枠の後段が与える配置
 * @returns 宣言された表。配置が `source-root` を宣言していない・表を宣言していないときは null
 */
export function structureOf(layout: ProductLayout): RoleStructure | null {
  return layout['source-root']?.structure ?? null;
}

/**
 * 層の宣言の全数 —— コアの 4 名のあとに、配置が足す層が宣言順に並ぶ。
 *
 * @param layout アプリの枠の後段が与える配置
 * @returns 層(名前・説明・閉世界の見張り役)。配置が足す層の走査の拡張子は含めない(生成物の形を変えない)
 */
export function frameworkLayers(layout: ProductLayout): readonly FrameworkLayer[] {
  const added = (structureOf(layout)?.layers ?? []).map(({ name, role, closedWorld }): FrameworkLayer => ({ name, role, closedWorld }));
  return [...CORE_LAYERS, ...added];
}

/**
 * 層の名前の集合(閉世界の判定に使う)。
 *
 * @param layout アプリの枠の後段が与える配置
 */
export function frameworkLayerNames(layout: ProductLayout): ReadonlySet<string> {
  return new Set(frameworkLayers(layout).map((layer) => layer.name));
}

/**
 * 補助ファイル(集約ディレクトリの直下にあって、ドメインイベントに対応しないファイル)の宣言の全数。「1 ドメインイベント = 1 ファイル」の例外はこれだけである。
 *
 * @param layout アプリの枠の後段が与える配置
 * @returns 宣言順の補助ファイル
 */
export function frameworkAuxFiles(layout: ProductLayout): readonly FrameworkAuxFile[] {
  return (structureOf(layout)?.auxFiles ?? []).map(({ layer, file, role }) => ({ layer, file, role }));
}

/** 区切りで連結する(空の断片は落とす)。 */
function joinPath(...segments: readonly string[]): string {
  return segments.filter((segment) => segment !== '').join('/');
}

/**
 * 土台ディレクトリの全数(生成物 `framework-structure.json` に写る表)—— 宣言順に、置き場を解いた形で返す。
 *
 * 置き場は `{根のソースの根}/{層}/{dir}` である。製品の木の行(`root: 'product'`)は配置の `source-root` の置き場から、実行時パッケージの行(`root: 'framework'`)は
 * 配置が宣言する実行時パッケージのソースの根(`runtimeSource`)から解く。製品の木の行は `source-root` を決められないとき返さない。
 *
 * @param layout アプリの枠の後段が与える配置
 * @returns 解いた土台(パスは根からの相対)
 */
export function frameworkBaseDirs(layout: ProductLayout): readonly FrameworkBaseDir[] {
  const structure = structureOf(layout);
  if (structure === null) return [];
  const source = layoutPath(layout, '', 'source-root');
  const resolved: FrameworkBaseDir[] = [];
  for (const entry of structure.baseDirs) {
    const home = entry.root === 'product' ? source : structure.runtimeSource;
    if (home === null) continue;
    resolved.push({
      root: entry.root,
      path: joinPath(home, entry.layer, entry.dir),
      role: entry.role,
      generated: entry.generated,
      vocabularyScan: entry.vocabularyScan,
      layout: entry.layout,
      perSpec: entry.perSpec,
      sdkPackages: entry.sdkPackages ?? [],
    });
  }
  return resolved;
}

/**
 * 枠の基盤のパッケージ(配置の `foundationPackages`。宣言が無ければ空)。
 *
 * @param layout アプリの枠の後段が与える配置
 * @returns 包みの名前の並び
 */
export function foundationPackagesOf(layout: ProductLayout): readonly string[] {
  return structureOf(layout)?.foundationPackages ?? [];
}

/** 製品の木の SDK の置き場 1 つ(土台の `sdkPackages`)。 */
export interface ProductSdkHome {
  /** 置き場(`productRoot` を接いだ形)。 */
  readonly path: string;
  /** 何の置き場か(人が読む説明)。 */
  readonly role: string;
  /** この置き場の下でだけ引けるパッケージの綴り。 */
  readonly packages: readonly string[];
}

/**
 * 製品の木の土台のうち、SDK のパッケージを宣言したもの(X1 の (d) と ESLint の SDK の置き場の表が読む)。
 *
 * @param layout アプリの枠の後段が与える配置
 * @param productRoot 製品の根(`roots.app`)。null = 実装の木を持たない(空)。空文字 `''` は「製品の根からの相対」
 * @returns 宣言順の置き場
 */
export function productSdkHomes(layout: ProductLayout, productRoot: string | null): readonly ProductSdkHome[] {
  const structure = structureOf(layout);
  const source = layoutPath(layout, productRoot, 'source-root');
  if (structure === null || source === null) return [];
  return structure.baseDirs
    .filter((entry) => entry.root === 'product' && (entry.sdkPackages ?? []).length > 0)
    .map((entry) => ({ path: joinPath(source, entry.layer, entry.dir), role: entry.role, packages: entry.sdkPackages ?? [] }));
}

/**
 * 製品の木に住む「集約でないディレクトリ」の置き場の集合(土台の表に載せていない手書きの置き場を含む)。逆引き・閉世界の検査が、直下のディレクトリが
 * 土台かどうかを**パスで**判定するのに使う(層の名前の綴りに依らない)。
 *
 * @param layout アプリの枠の後段が与える配置
 * @param productRoot 製品の根(`roots.app`)。null = 実装の木を持たない(空集合)。空文字 `''` は「製品の根からの相対」
 * @returns パスの集合(区切りは `/`。`productRoot` を接いだ形)
 */
export function productBaseDirPaths(layout: ProductLayout, productRoot: string | null): ReadonlySet<string> {
  const structure = structureOf(layout);
  const source = layoutPath(layout, productRoot, 'source-root');
  if (structure === null || source === null) return new Set();
  const listed = structure.baseDirs.filter((entry) => entry.root === 'product');
  return new Set([...listed, ...structure.unlistedDirs].map((entry) => joinPath(source, entry.layer, entry.dir)));
}

/**
 * 製品の木の土台 1 つの置き場(層と、層の直下からの相対パスで指す)。
 *
 * @param layout アプリの枠の後段が与える配置
 * @param productRoot 製品の根(`roots.app`)。null = 実装の木を持たない(null)。空文字 `''` は「製品の根からの相対」
 * @param layer 層の名前(例: `operation`)
 * @param dir 層の直下からの相対パス(例: `usecase`)
 * @returns 置き場(区切りは `/`)。配置が宣言していない土台・実装の木が無いときは null
 */
export function layoutBaseDirPath(layout: ProductLayout, productRoot: string | null, layer: string, dir: string): string | null {
  const structure = structureOf(layout);
  const source = layoutPath(layout, productRoot, 'source-root');
  if (structure === null || source === null) return null;
  const declared = [...structure.baseDirs.filter((entry) => entry.root === 'product'), ...structure.unlistedDirs].some((entry) => entry.layer === layer && entry.dir === dir);
  return declared ? joinPath(source, layer, dir) : null;
}

/** 語彙漏れの走査に載せる土台 1 つ(どちらの根から解くかを添えて返す)。 */
export interface VocabularyScanDir {
  /** 根からの相対パス。 */
  readonly path: string;
  /** どちらの根から解くか。 */
  readonly root: FrameworkBaseDir['root'];
}

/**
 * 語彙漏れの走査に載せる土台ディレクトリ。
 *
 * **パスだけでは足りない** —— 表は 2 つの根にまたがるので(束 ①-b)、解く先(製品の実装の木か実行時パッケージか)を呼び側に渡す。
 * 潰して 1 本にすると、パッケージ側の土台を製品の木の下に探して黙って 0 件になる(走査範囲が縮んだことに誰も気づかない)。
 *
 * @param layout アプリの枠の後段が与える配置
 * @returns 宣言順の土台(パスと根)
 */
export function vocabularyScanDirs(layout: ProductLayout): readonly VocabularyScanDir[] {
  return frameworkBaseDirs(layout)
    .filter((entry) => entry.vocabularyScan)
    .map((entry) => ({ path: entry.path, root: entry.root }));
}

/** 層ぜんたいを語彙漏れの走査に載せる根 1 つ。 */
export interface VocabularyScanLayer {
  /** 走査する層のディレクトリ(`productRoot` を接いだ形)。 */
  readonly dir: string;
  /** 対象にする拡張子(ドット込み)。 */
  readonly extensions: readonly string[];
}

/**
 * 層ぜんたいを語彙漏れの走査に載せる根(配置が足した層のうち、走査の拡張子を宣言したもの。共有の部品の層など、直下が集約で並ばない層)。
 *
 * @param layout アプリの枠の後段が与える配置
 * @param productRoot 製品の根(`roots.app`)。null = 実装の木を持たない(空)
 * @returns 層の宣言順の走査の根
 */
export function vocabularyScanLayers(layout: ProductLayout, productRoot: string | null): readonly VocabularyScanLayer[] {
  const source = layoutPath(layout, productRoot, 'source-root');
  if (source === null) return [];
  return (structureOf(layout)?.layers ?? []).flatMap((layer) =>
    layer.scanExtensions === undefined ? [] : [{ dir: joinPath(source, layer.name), extensions: layer.scanExtensions }],
  );
}
