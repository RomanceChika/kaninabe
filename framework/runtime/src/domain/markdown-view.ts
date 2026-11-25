/**
 * 書式つきの本文(`format: markdown` の欄)を画面に載せる部品。
 *
 * **`dangerouslySetInnerHTML` を使ってよい唯一の場所**(実装の木では ESLint の `layer/no-raw-html` が止める)。
 * 載せる HTML は `renderMarkdown`(`@kaninabe/runtime/markdown`)の出力だけで、許可リストを通っていない文字列は受け取れない
 * (引数は Markdown の元の文字列で、HTML ではない)。生成する画面は `format: markdown` の欄をこの部品でだけ描く(ASVS V1.3.1・V1.3.5)。
 */

import { createElement, type ReactElement } from 'react';
import { renderMarkdown } from './markdown.js';

/** `MarkdownView` の引数。 */
export interface MarkdownViewProps {
  /** Markdown の元の文字列(`format: markdown` の欄の値。HTML ではない)。無ければ何も描かない。 */
  readonly value: string | null | undefined;
  /** 包みの `div` の class(見た目は製品の CSS が持つ)。 */
  readonly className?: string | undefined;
}

/**
 * Markdown の本文を、サニタイズ済みの HTML として描く。
 *
 * @param props - 本文と包みの class
 * @returns 包みの `div`。本文が無い・空なら `null`
 */
export function MarkdownView(props: MarkdownViewProps): ReactElement | null {
  if (props.value === null || props.value === undefined || props.value === '') return null;
  const html = renderMarkdown(props.value);
  return createElement('div', {
    ...(props.className === undefined ? {} : { className: props.className }),
    dangerouslySetInnerHTML: { __html: html },
  });
}
