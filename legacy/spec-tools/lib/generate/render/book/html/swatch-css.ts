/**
 * デザインの章の色見本(`span.bf-swatch[data-token]`)の塗りを決める CSS を、トークンの名前から組む。
 *
 * 出力の口(`markup.ts`)は `style` 属性を書けないので、色見本の塗りは本文に置かず、HTML の本の資材(`assets/face.css`)の末尾にこの規則を足す。
 * 値はトークンそのもの(`var(--{名前})`)で、ここに色の値は持たない。名前は小文字・数字・ハイフンの形だけを通す(CSS の文脈に仕様の文字列をそのまま置かない)。
 */

import type { DesignTokenSpec } from '../../../../model/design/types.js';
import { tokenFacts } from '../../token-tables.js';

/** CSS の識別子として置いてよいトークンの名前の形。 */
const TOKEN_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * 色のトークンごとの色見本の規則。
 *
 * @param spec 読み込み済みのデザイントークン仕様(無ければ空)
 */
export function swatchCss(spec: DesignTokenSpec | null | undefined): string {
  if (spec === null || spec === undefined) return '';
  const rules = tokenFacts(spec)
    .filter((token) => token.group === 'color' && TOKEN_NAME.test(token.name))
    .map((token) => `.bf-swatch[data-token="${token.name}"] { background: var(--${token.name}); }`);
  return rules.length === 0 ? '' : `\n/* 色見本(デザインの章。トークンの名前から生成) */\n${rules.join('\n')}\n`;
}
