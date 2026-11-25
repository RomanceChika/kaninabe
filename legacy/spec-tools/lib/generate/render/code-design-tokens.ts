/**
 * デザイントークンの実装側生成(`tokens.css` / `tokens.ts`)。
 *
 * 同じ 1 つの仕様から 2 つの形を吐く:
 *   - CSS custom property … 部品の CSS Modules が `var(--…)` で引く既定の経路
 *   - TS 定数            … CSS を持てない場所(将来の React Native・テスト)から同じ値を引く経路
 *
 * どちらも `app/src/domain/generated/` に置く。トークンは「実行環境に依存しない値の集合」
 * であり、依存ゼロの層に置ける唯一の意匠である(色を持つのはドメインではないが、
 * **生成物の置き場が 1 つである**ことのほうが、鮮度チェック C1 の観点で価値が大きい)。
 */

import type { DesignGroup, DesignTokenSpec } from '../../model/design/types.js';
import type { DocGenerator, GenerateContext, GeneratedSection } from '../../gen-kit/generator.js';
import { blockCommentText } from '../../kernel/safe-text.js';
import type { SpecModel } from '../../model/types.js';
import { docComment, generatedFile, generatedHeader, tsString } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';

/** CSS の出力先(リポジトリルート相対)。 */
const cssFile = (roots: ProductRoots): string => generatedFile(roots, 'tokens.css');

/** TS の出力先(リポジトリルート相対)。 */
const tsFile = (roots: ProductRoots): string => generatedFile(roots, 'tokens.ts');

/** デザイントークンの生成器。 */
export const designTokensGenerator: DocGenerator = {
  id: 'code-design-tokens',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const spec = ctx.design?.spec;
    if (spec === undefined || spec === null) return [];
    return [
      { file: cssFile(ctx.roots), content: renderTokensCss(spec), wholeFile: true },
      { file: tsFile(ctx.roots), content: renderTs(spec), wholeFile: true },
    ];
  },
};

/** CSS のヘッダ(JSDoc 形式は CSS コメントとしても妥当なので、TS 側と同じ文面を使う)。 */
function cssHeader(spec: DesignTokenSpec): string {
  return generatedHeader([spec.file]);
}

/**
 * `:root` に全トークンを並べた CSS を作る。
 *
 * 実装側(app/src/domain/generated/tokens.css)とハンドブックの資材
 * (docs/book/assets/tokens.css — render/book/book-assets.ts)が同じ写像を使う。
 *
 * @param spec 読み込み済みのトークン仕様
 * @returns CSS ファイル全体(ヘッダつき)
 */
export function renderTokensCss(spec: DesignTokenSpec): string {
  const blocks = spec.groups.map((group) => cssGroup(group));
  const externals = spec.externals.length === 0 ? [] : [cssExternalNote(spec), ''];
  return [cssHeader(spec), '', ...externals, ':root {', blocks.join('\n\n'), '}', ''].join('\n');
}

/** 1 グループ分の CSS 変数。 */
function cssGroup(group: DesignGroup): string {
  const lines = group.tokens.map((token) => {
    const note = token.note === null ? '' : ` /* ${blockCommentText(token.note)} */`;
    return `  --${token.name}: ${token.value};${note}`;
  });
  return [`  /* ${blockCommentText(group.group)} — ${blockCommentText(group.purpose)} */`, ...lines].join('\n');
}

/** 外部供給の変数を CSS のコメントとして残す(値はここでは決められない)。 */
function cssExternalNote(spec: DesignTokenSpec): string {
  const lines = spec.externals.map((external) => ` *   --${external.name} … ${blockCommentText(external.from)}`);
  return ['/*', ' * 次の変数はトークン層の外(next/font 等)から供給される。', ...lines, ' */'].join('\n');
}

/**
 * `{ 'キー': '値' }` の定数表を作る。
 *
 * `renderLiteral` を使わないのは、トークン名がハイフンを含み TS の識別子にならないためで、
 * キーを必ず引用符で囲む必要がある(testids.ts の定数表と同じ形)。
 */
function renderTable(name: string, entries: readonly (readonly [string, string])[]): string {
  const lines = entries.map(([key, value]) => `  ${tsString(key)}: ${tsString(value)},`);
  return [`export const ${name} = {`, ...lines, '} as const;'].join('\n');
}

/** TS 定数を作る。 */
function renderTs(spec: DesignTokenSpec): string {
  const values = spec.tokens.map((token) => [token.name, token.value] as const);
  const vars = spec.tokens.map((token) => [token.name, `var(--${token.name})`] as const);
  return [
    generatedHeader([spec.file]),
    '',
    docComment([`テーマ名(トークン仕様の \`theme\`)。`]),
    `export const designTheme = ${tsString(spec.theme)};`,
    '',
    docComment([
      'トークンの実値。`ref` を持つ色は palette の hex に解決済み。',
      '',
      'CSS を持てない場所(将来の React Native・生成器のテスト)から同じ意匠を引くための口である。',
      '**画面のスタイルはここではなく CSS Modules から `var(--…)` で引く** —— TS で色を渡し始めると、',
      'スタイルが再びコンポーネントの内側に戻り、生値の直書き検査(G1)の視界から外れる。',
    ]),
    renderTable('designTokenValues', values),
    '',
    docComment([
      'トークンを `var(--…)` の形にしたもの。CSS custom property を式として渡したいときに使う。',
    ]),
    renderTable('designTokenVars', vars),
    '',
    docComment(['トークン名の値域。綴りの誤りを型で落とすために使う。']),
    'export type DesignTokenName = keyof typeof designTokenValues;',
    '',
  ].join('\n');
}
