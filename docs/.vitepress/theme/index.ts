/**
 * VitePress テーマ。手書きの文書(`docs/` の rules / specs ほか)は既定のテーマのまま描く。
 *
 * ハンドブック(`docs/book/`)は VitePress では描かない(HTML を spec-tools が直接生成し、`npm run book:open` で開く)。
 * このディレクトリの `book-face/` はハンドブックの CSS の写し元(`book-inputs-loader` が読む)で、VitePress は読まない。
 * `index.ts` は、`theme/` があると VitePress が入口を要求するため置く。
 */

import DefaultTheme from 'vitepress/theme';

export default DefaultTheme;
