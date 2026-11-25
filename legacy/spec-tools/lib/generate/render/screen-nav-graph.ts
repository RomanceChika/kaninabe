/**
 * ナビゲーショングラフ(specs/frontend/screens/README.md の `screen-nav-graph` ブロック)の生成器。
 *
 * S3(到達可能性)が機械的に見るのと同じグラフを、人間が一目で見る形にする。
 * 検証は「孤立している / していない」の真偽しか返さないが、図は**どう繋がっているか**を返す —
 * 「この遷移は業務としておかしい」という判断は人間にしかできず、その材料がこの図になる
 * (状態遷移図と同じ分担。domain-spec-writing.md §生成物の分担)。
 *
 * 入場条件(`on_fail`)の行き先は破線で描く。これは「その画面へ行く道」ではなく
 * 「入れなかった人の逃げ道」であり、S3 も入口として数えない。線種を分けて誤読を防ぐ。
 *
 * 辺の抽出(`collectNavEdges`)はここに 1 つだけ置く。ハンドブックの局所図・グループ図
 * (screen-flow-graphs.ts)は同じ辺データの**絞り込み違い**であり、図ごとに宣言を読み直さない。
 */

import { trustSnippet } from '../../kernel/trusted-html.js';
import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { ScreenSpec, ScreenSpecModel } from '../../model/screen/types.js';
import { headingSlug } from './html.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先。図は一覧と同じディレクトリガイドに置く。 */
function screensReadme(roots: ProductRoots): string {
  return specPath(roots, 'frontend/screens/README.md');
}

/** mermaid のインデント(生成物の見た目を揃えるため固定する)。 */
export const MERMAID_INDENT = '    ';

/** 置き場はあるが 0 件のときの表記。 */
const EMPTY = 'まだ screen_spec はありません(画面を仕様化すると、ここに遷移図が生成されます)。';

/** そもそも specs/frontend/screens を読めなかったときの表記。 */
const UNAVAILABLE =
  'specs/frontend/screens を読み込めなかったため、遷移図を生成していません(ディレクトリの有無を確認すること)。';

/** on_fail の辺に付ける固定ラベル(specs README・ハンドブックで共通)。 */
const FALLBACK_LABEL = '入場条件を満たさない';

/**
 * 遷移グラフの辺 1 本(宣言から機械的に写した中間形)。
 *
 * 全体図・グループ図・局所図はすべてこの並びの絞り込み違いであり、
 * 辺が宣言に無い情報を持つことはない。
 */
export interface NavEdge {
  /** 遷移元の画面。 */
  readonly from: ScreenSpec;
  /** 遷移先の画面(実在する画面に解決済み)。 */
  readonly to: ScreenSpec;
  /** 辺のラベル。遷移なら `on`(きっかけ)、逃げ道なら固定文言。 */
  readonly on: string;
  /** 'navigation' = 宣言された遷移(実線)/ 'fallback' = on_fail の逃げ道(破線)。 */
  readonly kind: 'navigation' | 'fallback';
  /** 共有クローム由来の遷移か(`viaChrome` 持ち)。 */
  readonly viaChrome: boolean;
}

/**
 * 画面仕様から遷移グラフの辺を抽出する(全図の唯一の辺データ源)。
 *
 * 実在しない遷移先は S2 が指摘済みなので落とす(存在しない節点を描かない)。
 * 並びは「画面の宣言順 × (navigations → on_fail)」で決定的。
 *
 * @param model 読み込み済みの画面仕様
 * @returns 解決済みの辺の並び
 */
export function collectNavEdges(model: ScreenSpecModel): readonly NavEdge[] {
  const byId = new Map(model.screens.map((screen) => [screen.id, screen]));
  const edges: NavEdge[] = [];
  for (const screen of model.screens) {
    for (const navigation of screen.navigations) {
      const target = byId.get(navigation.to);
      if (target === undefined) continue;
      edges.push({
        from: screen,
        to: target,
        on: navigation.on,
        kind: 'navigation',
        viaChrome: navigation.viaChrome !== undefined,
      });
    }
    const onFail = screen.onFail;
    const fallback = onFail === undefined ? undefined : byId.get(onFail.screen);
    if (fallback === undefined) continue;
    edges.push({ from: screen, to: fallback, on: FALLBACK_LABEL, kind: 'fallback', viaChrome: false });
  }
  return edges;
}

/**
 * 画面のグループ = 仕様の木の中のディレクトリ(`frontend/screens/{グループ}/`)。
 *
 * 分割の軸を発明しない — relPath の先頭セグメントをそのまま写す。
 * ディレクトリ直下に置かれた仕様(通常は無い)は '(未分類)' に寄せる。
 *
 * @param screen 画面仕様
 * @returns グループ名(ディレクトリ名)
 */
export function screenGroup(screen: ScreenSpec): string {
  const index = screen.relPath.indexOf('/');
  return index === -1 ? '(未分類)' : screen.relPath.slice(0, index);
}

/**
 * 遷移図の描き分けオプション。
 *
 * どちらも「宣言の部分集合を描く / 節点に既にある名前でリンクを張る」だけであり、
 * 図が宣言に無い情報を持つことはない。
 */
export interface NavGraphOptions {
  /**
   * 共有クローム由来の遷移(`viaChrome` 持ち)を描かない。
   *
   * chrome の遷移は全画面へ同じ形で展開されるため、全部描くと画面固有の動線が
   * 網目に埋もれる。ハンドブックは「画面固有の図」と「全遷移の図」を並べて使う。
   */
  readonly omitChromeNavigations?: boolean;
  /**
   * 各節点から画面カード(ハンドブックの `### {画面名}` 見出し)へのリンクを張る
   * (mermaid の click 指令。アンカーは見出しのスラッグ = 画面名)。
   */
  readonly cardLinks?: boolean;
}

/**
 * 画面遷移を mermaid の flowchart にする。
 *
 * @param model 読み込み済みの画面仕様
 * @param options 描き分け(省略時は全遷移・リンク無し = specs README 側の従来の形)
 * @returns ```mermaid フェンスで囲んだ Markdown 断片(末尾に改行を含まない)
 */
export function renderNavGraph(model: ScreenSpecModel, options: NavGraphOptions = {}): string {
  const lines: string[] = ['```mermaid', 'flowchart LR'];
  for (const screen of model.screens) {
    lines.push(nodeLine(screen));
    if (screen.entryPoint) lines.push(entryLine(screen));
  }
  for (const edge of collectNavEdges(model)) {
    if (options.omitChromeNavigations === true && edge.viaChrome) continue;
    lines.push(edgeLine(edge.from, edge.to, edge.kind, escapeMermaid(edge.on)));
  }
  if (options.cardLinks === true) {
    for (const screen of model.screens) lines.push(clickLine(screen));
  }
  lines.push('```');
  return trustSnippet(lines.join('\n'));
}

/**
 * 節点の宣言行(画面名 → 日本語名 → ルートを 3 行で併記する)。
 *
 * 日本語名(`label`)は宣言があるときだけ挟む。無い画面に空行を入れると節点の高さが
 * 揃わないうえ、「表示名を書いていない」という事実が図から読めなくなる。
 */
export function nodeLine(screen: ScreenSpec): string {
  const label = screen.label === undefined ? '' : `${escapeMermaid(screen.label)}<br/>`;
  return `${MERMAID_INDENT}${nodeId(screen)}["${escapeMermaid(screen.name)}<br/>${label}${escapeMermaid(screen.route)}"]`;
}

/** 入口の印の行(entry_point の画面に付ける)。 */
export function entryLine(screen: ScreenSpec): string {
  return `${MERMAID_INDENT}start((入口)) --> ${nodeId(screen)}`;
}

/** 辺 1 本の行。遷移は実線、on_fail の逃げ道は破線。ラベルはエスケープ済みを渡す。 */
export function edgeLine(
  from: ScreenSpec,
  to: ScreenSpec,
  kind: NavEdge['kind'],
  label: string,
): string {
  const arrow = kind === 'fallback' ? '-.->' : '-->';
  return `${MERMAID_INDENT}${nodeId(from)} ${arrow}|${label}| ${nodeId(to)}`;
}

/** 節点から画面カード(`### {画面名}` 見出し)への click 指令の行。 */
export function clickLine(screen: ScreenSpec): string {
  return `${MERMAID_INDENT}click ${nodeId(screen)} "#${headingSlug(screen.name)}" "${nodeId(screen)} のカードへ"`;
}

/** mermaid の節点 ID(ハイフンを含む画面 id をそのまま使えるようにアンダースコアへ寄せる)。 */
function nodeId(screen: ScreenSpec): string {
  return screen.name;
}

/**
 * mermaid のラベルを壊す記号を逃がす。
 *
 * 角括弧はラベル(画面の表示名・遷移の名前)に現れうるが、mermaid では節点の形を表す記号でもある。
 * 引用符の中でも解釈が処理系依存なので、実体コード(`#91;` / `#93;`)に置き換える。
 * 仕様の文字列が図の文を破る・HTML や指令を差し込む記号(`"` `|` バッククォート `;` `%` 改行 `<` `>` `{` `}`)も、取り除くか実体コードにする。
 */
export function escapeMermaid(text: string): string {
  return text
    .replace(/["|`;%]/g, '')
    .replace(/\r\n|[\n\r]/g, ' ')
    .replace(/\[/g, '#91;')
    .replace(/\]/g, '#93;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\{/g, '#123;')
    .replace(/\}/g, '#125;');
}

/**
 * 読み込み済みの screen_spec から遷移図を生成するジェネレーター。
 * 出力は screens/README.md の `screen-nav-graph` マーカー 1 か所。
 */
export const screenNavGraphGenerator: DocGenerator = {
  id: 'screen-nav-graph',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const model = ctx.screens;
    if (model === undefined || !model.available) {
      return [{ file: screensReadme(ctx.roots), marker: 'screen-nav-graph', content: UNAVAILABLE }];
    }
    const content = model.screens.length === 0 ? EMPTY : renderNavGraph(model);
    return [{ file: screensReadme(ctx.roots), marker: 'screen-nav-graph', content }];
  },
};
