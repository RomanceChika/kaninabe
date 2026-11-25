/**
 * 配置が宣言する**層と土台ディレクトリの表**(`source-root` の `structure`)の整合の検査(`structureProblems`)。
 *
 * 表は役割の置き場(`place`)とは別に書かれる —— 役割は「このキーのファイルはどこか」、表は「層の直下で集約ではないディレクトリは何か」を言う。別々に書かれた 2 つが食い違うと、
 * 逆引きは土台を操作と読み、閉世界の検査は役割の置き場を「宣言されていないディレクトリ」と読む。ここは、表そのものの形(層の重なり・土台の重複・生成物の欄の整合)と、
 * **表と役割の食い違い**(`placedBy`: 役割の置き場が名指した土台の中にあること)を、後段を選ぶ根の 1 回で確かめる。純関数で throw しない(違反は理由の配列で返す)。
 * 呼ぶのは `layoutDefinitionProblems`(`layout-definition.ts`)。
 */

import { CORE_LAYERS, CORE_REQUIRED_BASE_DIRS } from '../framework-dirs.js';
import { LAYOUT_CLASSIFIED_ROLES, LAYOUT_ROLES, layoutKeyFits, layoutPath, layoutScan } from './layout.js';
import type { LayoutRole, ProductLayout, RoleStructure } from './layout.js';

/** 層の直下の相対パスとして不正か(空・先頭末尾の区切り・`.` / `..` のセグメント・空のセグメント)。 */
function badRelativePath(value: string): boolean {
  return value === '' || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

/** 語彙の役割か。 */
function isVocabularyRole(name: string): name is LayoutRole {
  return (LAYOUT_ROLES as readonly string[]).includes(name);
}

/** コアの層の 4 名の集合。 */
function coreLayerNames(): ReadonlySet<string> {
  return new Set(CORE_LAYERS.map((layer) => layer.name));
}

/** 層の宣言(足す層)の整合。 */
function layerProblems(structure: RoleStructure): string[] {
  const problems: string[] = [];
  const core = new Set(CORE_LAYERS.map((layer) => layer.name));
  const seen = new Set<string>();
  for (const layer of structure.layers) {
    const say = (text: string): void => void problems.push(`層 ${layer.name}: ${text}`);
    if (badRelativePath(layer.name) || layer.name.includes('/')) say('層の名前はソースの根の直下のディレクトリ名 1 つです(区切り・空・`.` / `..` は不可)');
    if (core.has(layer.name)) say('コアの層の 4 名と重なっています(足せるのはスタックが足す層だけ)');
    if (seen.has(layer.name)) say('層の名前が重複しています');
    seen.add(layer.name);
    if (layer.role.trim() === '') say('説明(role)が空です');
  }
  return problems;
}

/** 土台ディレクトリの宣言の整合(層の所属・重複・生成物の欄の整合)。 */
function baseDirProblems(structure: RoleStructure): string[] {
  const problems: string[] = [];
  const layers = new Set([...CORE_LAYERS.map((layer) => layer.name), ...structure.layers.map((layer) => layer.name)]);
  const seen = new Set<string>();
  for (const entry of structure.baseDirs) {
    const name = `${entry.root} ${entry.layer}/${entry.dir}`;
    const say = (text: string): void => void problems.push(`土台 ${name}: ${text}`);
    if (!layers.has(entry.layer)) say('属する層が、コアの層の 4 名にも足した層にもありません');
    if (badRelativePath(entry.dir)) say('層の直下からの相対パスが不正です(空・区切り・`.` / `..` は不可)');
    if (seen.has(name)) say('同じ土台が重複して宣言されています');
    seen.add(name);
    if (entry.role.trim() === '') say('説明(role)が空です');
    if (entry.perSpec && !entry.generated) say('仕様の量で決まる置き場(perSpec)は生成物(generated)だけです');
    if (entry.generated && entry.vocabularyScan) say('生成物の置き場は語彙漏れの走査に載せません(生成器が正なので二重に見ない)');
    // 仕様の量で決まる生成物の置き場は、書き込む役割を名指す(名指さないと、役割の置き場との食い違いを誰も見ない)。実行時パッケージの土台は役割の相手ではない。
    if (entry.root === 'product' && entry.generated && entry.perSpec && entry.placedBy === undefined) {
      say('仕様の量で決まる生成物の置き場(perSpec)は、書き込む役割を placedBy で名指します(役割の置き場との食い違いを検査が見るため)');
    }
    if (entry.root === 'framework' && entry.placedBy !== undefined) say('実行時パッケージの土台は、製品の木の役割の置き場の相手ではありません(placedBy を書けるのは製品の木の土台だけです)');
    if (entry.root === 'product' && coreLayerNames().has(entry.layer) && entry.dir.includes('/')) {
      say('コアの層の土台は、層の直下の 1 段のディレクトリです(入れ子にすると、X1 の閉世界は全パスで・逆引きの除外は先頭の 1 段で見て食い違います)');
    }
  }
  if (structure.baseDirs.some((entry) => entry.root === 'framework') && badRelativePath(structure.runtimeSource)) {
    problems.push('実行時パッケージのソースの根(runtimeSource)が不正です(実行時パッケージの土台を宣言するなら、空でない相対パスが要ります)');
  }
  return problems;
}

/** 土台の表に載せていない手書きの置き場・補助ファイルの宣言の整合。 */
function extraProblems(structure: RoleStructure): string[] {
  const problems: string[] = [];
  const layers = new Set([...CORE_LAYERS.map((layer) => layer.name), ...structure.layers.map((layer) => layer.name)]);
  const listed = new Set(structure.baseDirs.filter((entry) => entry.root === 'product').map((entry) => `${entry.layer}/${entry.dir}`));
  for (const entry of structure.unlistedDirs) {
    const name = `${entry.layer}/${entry.dir}`;
    if (!layers.has(entry.layer)) problems.push(`載せていない置き場 ${name}: 属する層がありません`);
    if (badRelativePath(entry.dir)) problems.push(`載せていない置き場 ${name}: 層の直下からの相対パスが不正です`);
    if (coreLayerNames().has(entry.layer) && entry.dir.includes('/')) problems.push(`載せていない置き場 ${name}: コアの層の土台は、層の直下の 1 段のディレクトリです(入れ子は逆引きの除外と X1 の閉世界が食い違う)`);
    if (listed.has(name)) problems.push(`載せていない置き場 ${name}: 土台の表に載っている置き場と重なっています(載せていないはずのものが載っています)`);
    if (entry.role.trim() === '') problems.push(`載せていない置き場 ${name}: 説明(role)が空です`);
  }
  for (const entry of structure.auxFiles) {
    if (!layers.has(entry.layer)) problems.push(`補助ファイル ${entry.layer}/${entry.file}: 属する層がありません`);
    if (entry.file.trim() === '' || entry.file.includes('/')) problems.push(`補助ファイル ${entry.layer}/${entry.file}: ファイル名が不正です`);
    if (entry.role.trim() === '') problems.push(`補助ファイル ${entry.layer}/${entry.file}: 説明(role)が空です`);
  }
  return problems;
}

/**
 * 表と役割の食い違い(`placedBy`)。土台が名指した役割の置き場(キーの見本を `place` に通したパス)が、その土台の中にあること。
 * 名指された役割が配置に無い・キーが形に合わない・置き場を決められないときは、その理由を言う。
 */
function placedByProblems(layout: ProductLayout, structure: RoleStructure): string[] {
  const problems: string[] = [];
  const source = layoutPath(layout, '', 'source-root');
  for (const entry of structure.baseDirs) {
    if (entry.placedBy === undefined || entry.root !== 'product') continue;
    const { role, key } = entry.placedBy;
    const name = `${entry.layer}/${entry.dir}`;
    const home = source === null ? undefined : [source, entry.layer, entry.dir].filter((segment) => segment !== '').join('/');
    // 語彙の役割が配置に無いときは、下限(`LAYOUT_ROLE_MIN`)の検査が既に言う(同じ欠落を 2 度言わない)。語彙に無い名前は、ここだけが言う。
    if (isVocabularyRole(role) && layout[role] === undefined) continue;
    if (!isVocabularyRole(role)) {
      problems.push(`土台 ${name}: 書き込む役割 ${role} が、コアの語彙の役割ではありません`);
      continue;
    }
    if (!layoutKeyFits(layout, role, key)) {
      problems.push(`土台 ${name}: 書き込む役割 ${role} のキーの見本 ${key} が、役割のキーの形に合いません`);
      continue;
    }
    const placed = layoutPath(layout, '', role, key);
    if (placed === null || home === undefined) {
      problems.push(`土台 ${name}: 書き込む役割 ${role} の置き場を決められません`);
      continue;
    }
    if (!placed.startsWith(`${home}/`)) {
      problems.push(
        `土台 ${name}: 書き込む役割 ${role} の置き場 ${placed} が、土台の置き場 ${home} の外にあります(役割の表と土台の表が食い違います — 土台の置き場か、役割の置き場をそろえる)`,
      );
    }
  }
  return problems;
}

/** コアが前提にする土台(`CORE_REQUIRED_BASE_DIRS`)が、製品の木の土台(または載せていない手書きの置き場)として宣言されていること。 */
function coreRequiredProblems(structure: RoleStructure): string[] {
  const declared = new Set([...structure.baseDirs.filter((entry) => entry.root === 'product'), ...structure.unlistedDirs].map((entry) => `${entry.layer}/${entry.dir}`));
  return Object.values(CORE_REQUIRED_BASE_DIRS)
    .filter((required) => !declared.has(`${required.layer}/${required.dir}`))
    .map((required) => `土台 ${required.layer}/${required.dir}: コアが前提にする土台なのに、宣言がありません(${required.usedBy}がここを読みます — 無いと生成が止まるか、検査が別の場所を見ます)`);
}

/**
 * 逆引きと表の一致: 各土台の下のファイル(平らな土台は `x.ts`・入れ子の土台は `sample/x.ts`)を、**書き込む役割以外**の逆引きに通すと null(= 操作・集約などの実体と読まれない)。
 * 逆引きが土台を除く規則と、表が別々に書かれて食い違うと、土台の下の手書きのファイルが操作として突合に出る。
 */
function reverseLookupProblems(layout: ProductLayout, structure: RoleStructure): string[] {
  const source = layoutPath(layout, '', 'source-root');
  if (source === null) return [];
  const problems: string[] = [];
  const homes = [
    ...structure.baseDirs.filter((entry) => entry.root === 'product').map((entry) => ({ ...entry, owner: entry.placedBy?.role, nested: entry.layout === 'nested' })),
    ...structure.unlistedDirs.map((entry) => ({ ...entry, owner: undefined, nested: false })),
  ];
  for (const entry of homes) {
    const home = [source, entry.layer, entry.dir].filter((segment) => segment !== '').join('/');
    const probe = entry.nested ? 'sample/x.ts' : 'x.ts';
    for (const role of LAYOUT_CLASSIFIED_ROLES) {
      if (role === entry.owner || layout[role] === undefined) continue;
      const scan = layoutScan(layout, '', role);
      if (scan === null || (home !== scan.dir && !home.startsWith(`${scan.dir}/`))) continue;
      const relative = home === scan.dir ? probe : `${home.slice(scan.dir.length + 1)}/${probe}`;
      const key = scan.keyOf(relative);
      if (key !== null) {
        problems.push(`土台 ${entry.layer}/${entry.dir}: 下のファイル ${relative} が、役割 ${role} の実体(キー ${key})と読まれます(その役割の逆引きが、この土台を除いていません — 表と逆引きの食い違い)`);
      }
    }
  }
  return problems;
}

/**
 * 層と土台ディレクトリの表の整合を返す。
 *
 * 見るのは: **表を宣言できるのは `source-root` の役割だけ**・`source-root` が表を宣言していること(無いと、土台の閉世界・語彙漏れの走査・逆引きの除外・生成物の構造の期待が黙って空になる)・
 * 足す層がコアの 4 名と重ならないこと・土台の層の所属と重複と生成物の欄の整合・載せていない手書きの置き場と補助ファイルの整合・
 * **`placedBy` で名指した役割の置き場が、その土台の中にあること**(仕様の量で決まる生成物の置き場は名指しが必須・実行時パッケージの土台は名指せない)・
 * **コアが前提にする土台(`CORE_REQUIRED_BASE_DIRS`)の宣言**・**各土台の下のファイルが、書き込む役割以外の逆引きに実体と読まれないこと**・コアの層の土台が入れ子でないこと。
 *
 * @param layout 後段が与える配置
 * @returns 違反の説明(無ければ空)
 */
export function structureProblems(layout: ProductLayout): readonly string[] {
  const problems: string[] = [];
  for (const [name, decl] of Object.entries(layout)) {
    if (name !== 'source-root' && decl?.structure !== undefined) problems.push(`役割 ${name}: 層と土台の表(structure)を宣言できるのは source-root の役割だけです`);
  }
  const source = layout['source-root'];
  if (source === undefined) return problems;
  const structure = source.structure;
  if (structure === undefined) {
    return [...problems, '役割 source-root: 層と土台の表(structure)が宣言されていません(無いと、土台の閉世界・語彙漏れの走査・逆引きの除外・生成物の構造の期待が黙って空になります)'];
  }
  return [
    ...problems,
    ...layerProblems(structure),
    ...baseDirProblems(structure),
    ...extraProblems(structure),
    ...coreRequiredProblems(structure),
    ...placedByProblems(layout, structure),
    ...reverseLookupProblems(layout, structure),
  ];
}
