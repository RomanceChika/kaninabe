/**
 * 置き場の配置そのものの契約の検査(`layoutDefinitionProblems`)と、選んだ配置と製品の宣言の食い違いの検査(`layoutSelectionProblems`)。
 *
 * 配置の語彙と解決(`layout.ts`)を使う側の読み物ではなく、**後段が与えた配置の値が契約を満たすか**を、後段を選ぶ根の 1 回で確かめる責務である。
 * 検査・生成・後段のどれもが配置の型と解決を読むので、型と解決は `layout.ts` に置き、定義の検査はここへ分ける
 * (解決だけを使う側に検査の道具を道連れにしない)。純関数で throw しない(違反は理由の配列で返す)。
 * **配置を選ぶ入口は全部ここを通す**(全部入りの検査・生成の入口は `selectTargetSet` が、ハンドブックだけの入口と約束事のモデルの入口は
 * `cli/select-target-values.ts` が呼ぶ。通らない入口があると、定義の検査が緑のまま使い方の誤りが素通りする)。
 */

import { posix } from 'node:path';
import { LAYOUT_CLASSIFY_ROLES, LAYOUT_KEY_SHAPES, LAYOUT_MODULE_ROLES, LAYOUT_ROLE_MIN, LAYOUT_ROLES, layoutPath, layoutRoundTrips, pathWithin, sourceRootPath } from './layout.js';
import type { LayoutRole, ProductLayout, RoleDecl } from './layout.js';
import { LAYOUT_BODY_IMPORTS } from './layout-body-imports.js';
import { nestedPlaceProblems } from './layout-nesting.js';
import { structureProblems } from './layout-structure.js';

/**
 * 配置そのものの契約の違反(役割ごとの宣言の整合)。後段を選ぶ根の 1 回で確かめる。
 *
 * 見るのは: **逆引き(`classify`)を読む役割(`LAYOUT_CLASSIFY_ROLES`)が逆引きを持つこと**・多重度の形(`max: 1` はキーが `none`・`many` はキーが要る)・**下限(`LAYOUT_ROLE_MIN`)を下回らないことと、下限が 1 の役割が宣言されていること**・
 * 基準の循環・基準が宣言されていない・基準の役割がキーを持つ・持ち主と生成物か手書きかの食い違い・`place` の有無(製品の宣言が持ち主の役割だけが `null`)・
 * 書く側が持ち主の生成器に含まれること・読み書きの条件が空でないこと・**import される役割(`LAYOUT_MODULE_ROLES`)の `module` が必須で、
 * 基準の役割の `module` に自分の置き場(拡張子なし)を接いだ形と一致すること**・**生成テストとアダプタの本文が辿る相対の import(`layout-body-imports.ts`)の先が、
 * アダプタの役割の置き場と一致すること**・**ある役割の置き場が、別の役割の逆引きの走査の根の下に入って、その役割の逆引きに自分の実体と読まれないこと**
 * (`layout-nesting.ts`。同じファイルを 2 つの役割が自分のものと読む逆引きの衝突も同じ検査)・**層と土台ディレクトリの表(`source-root` の `structure`)の整合と、表と役割の食い違い**
 * (`layout-structure.ts`。部品化 ③-c5)。`access.readers` / `access.when` は文書の欄なので、空でないこと以外は見ない。
 *
 * @param layout 後段が与える配置
 * @returns 違反の説明(無ければ空)
 */
export function layoutDefinitionProblems(layout: ProductLayout): readonly string[] {
  const problems: string[] = [];
  for (const name of Object.keys(layout)) {
    if (!isVocabularyRole(name)) problems.push(`役割 ${name}: コアの語彙(${LAYOUT_ROLES.join(' / ')})に無い役割です`);
  }
  for (const role of LAYOUT_ROLES) {
    const decl = layout[role];
    if (decl === undefined) {
      if (LAYOUT_ROLE_MIN[role] === 1) problems.push(`役割 ${role}: 多重度の下限が 1 の役割なのに、配置に宣言がありません`);
      continue;
    }
    problems.push(...roleProblems(layout, role, decl));
  }
  problems.push(...bodyImportProblems(layout), ...nestedPlaceProblems(layout, SAMPLE_KEYS), ...structureProblems(layout));
  return problems;
}

/** コアの語彙の役割か。 */
function isVocabularyRole(name: string): name is LayoutRole {
  return (LAYOUT_ROLES as readonly string[]).includes(name);
}

/** 役割 1 つの宣言の整合。 */
function roleProblems(layout: ProductLayout, role: LayoutRole, decl: RoleDecl): string[] {
  const problems: string[] = [];
  const say = (text: string): void => void problems.push(`役割 ${role}: ${text}`);
  const { max, key } = decl.multiplicity;
  if (LAYOUT_CLASSIFY_ROLES.includes(role) && decl.classify === undefined) {
    say('検査が逆引き(実在のファイル → キー)を読む役割なのに、逆引き(classify)がありません(無いと検査は実装の木を走査できず、黙って全部スキップする)');
  }
  if (!(LAYOUT_KEY_SHAPES as readonly string[]).includes(key)) say(`キーの形 ${key} が、コアの語彙(${LAYOUT_KEY_SHAPES.join(' / ')})に無い形です`);
  if (max === 1 && key !== 'none') say(`多重度が 1 つだけなのにキーの形(${key})を持っています`);
  if (max === 'many' && key === 'none') say('キーごとに複数なのに、キーの形がありません');
  if (decl.multiplicity.min < LAYOUT_ROLE_MIN[role]) say(`多重度の下限(min: ${decl.multiplicity.min})がコアの定める下限(${LAYOUT_ROLE_MIN[role]})を下回っています`);
  if (decl.owners.length === 0) say('持ち主がありません');
  const generators = decl.owners.filter((owner) => owner.kind === 'generator');
  const hasHand = decl.owners.some((owner) => owner.kind !== 'generator');
  if (decl.origin === 'generated' && hasHand) say('生成物(generated)なのに、生成器以外の持ち主がいます');
  if (decl.origin === 'handwritten' && generators.length > 0) say('手書き(handwritten)なのに、生成器の持ち主がいます');
  if (decl.origin === 'mixed' && (generators.length === 0 || !hasHand)) say('混在(mixed)なのに、生成器と手書きの両方の持ち主がいません');
  const declaration = decl.owners.some((owner) => owner.kind === 'product_declaration');
  if (declaration !== (decl.place === null)) say('製品の宣言が持ち主の役割だけが `place` を持たず(null)、それ以外は `place` が要ります');
  if (decl.place === null && decl.base !== null) say('製品の宣言が決める役割は、基準を持てません(リポジトリルートからの相対)');
  for (const writer of decl.access.writers) {
    if (!generators.some((owner) => owner.id === writer)) say(`書く側 ${writer} が、持ち主の生成器に含まれていません`);
  }
  if (decl.access.when.trim() === '') say('読み書きの条件が空です');
  problems.push(...baseProblems(layout, role, decl), ...moduleProblems(layout, role, decl), ...classifyProblems(layout, role, decl));
  return problems;
}

/** 検証に使うキーの見本(キーの形ごと。`place` / `module` を 1 回ずつ呼んで突き合わせる)。 */
const SAMPLE_KEYS: Readonly<Record<string, string>> = {
  none: '',
  url_path: '/sample/path',
  integration_id: 'sample_id',
  file_name: 'sample.file',
  operation_id: 'sample_aggregate.sample_event',
  spec_name: 'sample_name',
  save_id: 'sample_usecase.sample_save',
  relative_path: 'sample_dir/sample.file',
};

/** 拡張子を除く(最後の区切りの後ろの `.xxx` だけ)。 */
function withoutExtension(place: string): string {
  return place.replace(/\.[^./]+$/, '');
}

/** `module` の契約(import される役割は `module` が必須で、基準の役割の `module` に自分の置き場を接いだ形と一致する)。 */
function moduleProblems(layout: ProductLayout, role: LayoutRole, decl: RoleDecl): string[] {
  if (!LAYOUT_MODULE_ROLES.includes(role)) return [];
  if (decl.module === null) return [`役割 ${role}: 生成物から import される役割なのに、module がありません`];
  if (decl.place === null || decl.base === null) return [];
  const baseModule = layout[decl.base]?.module;
  if (baseModule === undefined || baseModule === null) return [`役割 ${role}: 基準の役割 ${decl.base} に module が無く、この役割の module の正しさを確かめられません`];
  const key = SAMPLE_KEYS[decl.multiplicity.key] ?? '';
  const expected = `${baseModule('')}/${withoutExtension(decl.place(key))}`;
  const actual = decl.module(key);
  return actual === expected
    ? []
    : [`役割 ${role}: module(${actual})が、基準の役割 ${decl.base} の module に置き場(拡張子なし)を接いだ形(${expected})と一致しません`];
}

/**
 * 逆引き(`classify`)の整合。置き場(`place`)が走査の根(`dir`)の下にあり、**キーの見本が往復で同じキーに戻る**(置き場と逆引きが別々に書かれて食い違うのを止める。
 * `module` の契約と同じ形)。逆引きは `place` を持つ役割のためのもの(製品の宣言が決める役割は逆引きを持てない)。
 */
function classifyProblems(layout: ProductLayout, role: LayoutRole, decl: RoleDecl): string[] {
  if (decl.classify === undefined) return [];
  if (decl.place === null) return [`役割 ${role}: 製品の宣言が決める役割は、逆引き(classify)を持てません`];
  if (decl.classify.dir.trim() === '') return [`役割 ${role}: 逆引きの走査の根(dir)が空です`];
  const sample = SAMPLE_KEYS[decl.multiplicity.key] ?? '';
  return layoutRoundTrips(layout, role, sample)
    ? []
    : [`役割 ${role}: 置き場(place)と逆引き(classify)が食い違います(キーの見本 ${sample === '' ? '(なし)' : sample} が、置き場 → 逆引きで同じキーに戻りません)`];
}

/**
 * 生成物の本文が辿る相対の import(`LAYOUT_BODY_IMPORTS`)の整合。本文の起点(本文を書く役割の置き場のディレクトリ)に相対の指定を接いだ先が、
 * 行き先の役割の置き場(拡張子なし)と一致すること。置き場と本文の相対の指定は別々に書かれる(本文を配置から組むのは P5 / P6)ので、配置が置き場の深さを変えると
 * 生成物は書けるのに、書いたテストが import を解決できなくなる。そのとき黙らずに、どの役割の置き場がどこへ動くべきかを言う。
 * どちらかの役割が配置に無い・置き場を決められないときは、その理由を別の検査(下限・基準・キーの形)が言うので、ここは見ない。
 */
function bodyImportProblems(layout: ProductLayout): string[] {
  const problems: string[] = [];
  for (const entry of LAYOUT_BODY_IMPORTS) {
    const fromDecl = layout[entry.from];
    if (fromDecl === undefined || layout[entry.to] === undefined) continue;
    const from = layoutPath(layout, '', entry.from, SAMPLE_KEYS[fromDecl.multiplicity.key] ?? '');
    const to = layoutPath(layout, '', entry.to, entry.name);
    if (from === null || to === null) continue;
    const reached = posix.join(posix.dirname(from), entry.specifier);
    const placed = entry.sibling === true ? posix.join(posix.dirname(to), posix.basename(reached)) : withoutExtension(to);
    if (reached !== placed) {
      problems.push(
        `役割 ${entry.from}: 生成物の本文は相対の指定 ${entry.specifier} で ${entry.name} を import します(置き場 ${from} から辿り着く先は ${reached})が、` +
          `役割 ${entry.to} の ${entry.name} の置き場は ${placed} です(本文の相対の指定は置き場の深さの写しで、配置が置き場の深さを変えると食い違います — 置き場をそろえる。本文を配置から組むのは P5 以降)`,
      );
    }
  }
  return problems;
}

/** 基準の役割の整合(宣言があること・キーを持たないこと・循環しないこと)。 */
function baseProblems(layout: ProductLayout, role: LayoutRole, decl: RoleDecl): string[] {
  if (decl.base === null) return [];
  const base = layout[decl.base];
  if (base === undefined) return [`役割 ${role}: 基準の役割 ${decl.base} が宣言されていません`];
  const problems: string[] = [];
  if (base.multiplicity.key !== 'none') problems.push(`役割 ${role}: 基準の役割 ${decl.base} がキーを持っています(基準はキーを持たない 1 つだけの役割)`);
  const walked = new Set<string>([role]);
  for (let next: string | null = decl.base; next !== null; next = layout[next]?.base ?? null) {
    if (walked.has(next)) {
      problems.push(`役割 ${role}: 基準をたどると循環します(${[...walked, next].join(' → ')})`);
      break;
    }
    walked.add(next);
  }
  return problems;
}

/**
 * 製品の `roots.generated`(生成物の総置き場)が、配置の `source-root` の中にあるか(根の宣言と配置の二重の定義の食い違い)。
 * 包含は**パスを正規化したあとで**比べる(`./app/src` と `app/src/`・`app//src/x` は同じ)。
 *
 * @param layout 選んだ配置(アプリの枠の後段の値)
 * @param roots 製品の根(`app` と `generated`)
 * @param owner 違反の説明に出す持ち主(例: `後段 nextjs の`。省略は「配置の」)
 * @returns 違反の説明(無ければ空)。`source-root` を決められない(実装の木を宣言していない・配置に無い)ときは、見る相手が無いので空
 */
export function layoutRootsProblems(layout: ProductLayout, roots: { readonly app: string | null; readonly generated: string }, owner = '配置の'): readonly string[] {
  const source = sourceRootPath(layout, roots);
  if (source === null) return [];
  if (pathWithin(source, roots.generated) !== null) return [];
  return [`製品の roots.generated(${roots.generated})が、${owner} source-root(${source})の外にあります(生成物の置き場は実装のソースの根の中)`];
}

/**
 * 選んだ配置と製品の宣言の食い違い(選ぶ根の 1 回)。**配置そのものの契約(`layoutDefinitionProblems`)と、`roots.generated` が `source-root` の中にあること
 * (`layoutRootsProblems`)**を 1 本にした形で、後段の登録を通らずに配置の値を選ぶ入口(ハンドブックだけの入口・約束事のモデルの入口 =
 * `cli/select-target-values.ts`)が通る(全部入りの入口の `selectTargetSet` は、同じ 2 つに加えて、配置が持ち主として名指す生成器の実在も、後段の登録の検査と一緒に見る。この入口は生成器の一覧を作れないので、3 つ目は見ない)。
 *
 * @param layout 選んだ配置(アプリの枠の後段の値)
 * @param roots 製品の根(`app` と `generated`)
 * @returns 違反の説明(無ければ空)
 */
export function layoutSelectionProblems(layout: ProductLayout, roots: { readonly app: string | null; readonly generated: string }): readonly string[] {
  return [...layoutDefinitionProblems(layout), ...layoutRootsProblems(layout, roots)];
}
