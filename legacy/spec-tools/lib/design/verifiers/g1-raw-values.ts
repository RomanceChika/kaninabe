/**
 * G1 — 実装の CSS に生値を書いていないこと。
 *
 * 「状態名を手書きしない」の視覚層版。色と寸法を実装が直に書けると、トークン仕様は
 * 「参考にしてもよい一覧」に落ち、意匠の値域という前提が消える。
 *
 * **許可リスト方式**(2026-09 反転)。「通ってよい形」を閉じた集合として持ち、そこに無い
 * ものは種類を問わず落とす ―― 3 つの表(単位・色名・システム色)は `g1-tables.ts` にあり、
 * 表を足す・削るのがそのままこの検査の対象を変える。無単位の数値も同様に、
 * 「トークン化されているので無単位のままでは書けないプロパティ」と「対応するトークンが
 * 無く CSS の仕様上そもそも無単位のプロパティ」の 2 つの値域で扱う。
 *
 * 対象は `app/src` の CSS のうち**生成物でないもの**。生成物(tokens.css)は palette の
 * 実値をそこにしか置けないので、当然ここでは見ない。
 */

import type { Finding } from '../../kernel/finding.js';
import { scanDeclarations, stripStrings } from '../css-scan.js';
import type { DesignInput } from '../../model/design/types.js';
import { designFinding, type DesignVerifier } from '../verifier.js';
import {
  ALLOWED_UNITS,
  CSS_NAMED_COLORS,
  governedPropertyHint,
  SYSTEM_COLORS,
  TOKEN_GOVERNED_UNITLESS_PROPERTIES,
  UNITLESS_OK_PROPERTIES,
} from './g1-tables.js';
import { bareWord, isZero, maskColorSpans, scanDimensions, scanIdentifiers } from './g1-scan.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 検証器 ID。 */
const ID = 'G1';

/** 生値として禁じる色の書き方(hex・色関数)。閉じた形なので反転の対象外。 */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/g;

/** 族を直接指定させないプロパティ。 */
const FONT_FAMILY_PROPS = new Set(['font-family', 'font']);

/** 装飾文字の密輸を見るプロパティ(既知の穴の解消。styling.md「装飾的な文字」)。 */
const CONTENT_PROPERTY = 'content';

/** 族の値として唯一許す形(トークン 1 つだけ)。 */
const ONLY_VAR = /^var\(--[a-z0-9-]+\)$/;

/** 族を「継承する」と書くのは意匠の宣言ではないので通す(`font-family: inherit` 等)。 */
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/** `content` に書いてよい関数呼び出しの先頭(引用符の中身を検査しない形)。 */
const CONTENT_FUNCTION = /^(?:attr|counter|counters|url|var)\(/;

/** `content` に書いてよいキーワード。 */
const CONTENT_KEYWORDS = new Set(['normal', 'none', 'open-quote', 'close-quote', 'no-open-quote', 'no-close-quote']);

/** 文字・数字を 1 文字も含まない(記号だけの区切り)かどうか。 */
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** 1 つの違反の材料。 */
interface RawHit {
  readonly kind: string;
  readonly text: string;
  readonly suggestion: string;
}

/** G1 検証器。 */
export const g1RawValues: DesignVerifier = {
  id: ID,
  title: '実装の CSS に生値(色・長さ・フォント族・装飾文字)を書いていない',

  verify(input: DesignInput): Finding[] {
    if (!input.css.available) return [];
    const findings: Finding[] = [];
    for (const file of input.css.files) {
      if (file.generated) continue;
      for (const declaration of scanDeclarations(file.file, file.source)) {
        for (const hit of rawHits(declaration.property, declaration.value, input.roots)) {
          findings.push(
            designFinding(ID, {
              message: `${hit.kind}を直接書いています: ${declaration.property}: ${declaration.value}`,
              file: declaration.file,
              pointer: `${declaration.line} 行目`,
              suggestion: hit.suggestion,
              counterexample: { property: declaration.property, value: hit.text },
            }),
          );
        }
      }
    }
    return findings;
  },
};

/** 1 つの宣言から違反を取り出す。 */
function rawHits(property: string, value: string, roots: ProductRoots): readonly RawHit[] {
  if (FONT_FAMILY_PROPS.has(property)) return fontFamilyHits(property, value);
  if (property === CONTENT_PROPERTY) return contentHits(value);
  const naked = stripStrings(value);
  return [...colorHits(naked, roots), ...dimensionHits(property, naked)];
}

/** 色(hex・色関数・色名表・システム色表)の違反を取り出す。 */
function colorHits(naked: string, roots: ProductRoots): readonly RawHit[] {
  const suggestion = `${specPath(roots, 'frontend/design/tokens.md')} の palette に名前を付け、color グループのトークン経由で var(--color-…) を引く`;
  const hits: RawHit[] = [...match(naked, RAW_COLOR, '色', suggestion)];

  const masked = maskColorSpans(naked);
  for (const identifier of scanIdentifiers(masked)) {
    const word = bareWord(identifier);
    if (CSS_NAMED_COLORS.has(word)) {
      hits.push({ kind: '色名', text: identifier, suggestion });
    } else if (SYSTEM_COLORS.has(word)) {
      hits.push({
        kind: 'システム色',
        text: identifier,
        suggestion: 'システム色(OS/ブラウザのテーマ色)はこのリポジトリの単一テーマ前提と両立しない。palette に名前を付けてトークン経由で引く',
      });
    }
  }
  return hits;
}

/** 長さ・時間(単位表)と無単位の値(governed / unitless-ok の 2 表)の違反を取り出す。 */
function dimensionHits(property: string, naked: string): readonly RawHit[] {
  const masked = maskColorSpans(naked);
  const hits: RawHit[] = [];
  for (const { text, number, unit } of scanDimensions(masked)) {
    if (unit !== '') {
      if (ALLOWED_UNITS.has(unit.toLowerCase())) continue;
      hits.push({
        kind: '長さ・時間',
        text,
        suggestion: 'space / radius / text / border / motion / size のトークンを使う(4px 刻みに無い値が要るなら、まず仕様側に足すか設計を揃える)',
      });
      continue;
    }
    if (TOKEN_GOVERNED_UNITLESS_PROPERTIES.has(property)) {
      hits.push({ kind: '無単位の値', text, suggestion: governedPropertyHint(property) });
      continue;
    }
    if (isZero(number)) continue;
    if (UNITLESS_OK_PROPERTIES.has(property)) continue;
    hits.push({
      kind: '無単位の値',
      text,
      suggestion: `${property} に無単位の数を書ける根拠が無い(flex 系のような比率でなければ、対応するトークングループを足すか設計を見直す)`,
    });
  }
  return hits;
}

/** フォント族の宣言を検査する。 */
function fontFamilyHits(property: string, value: string): readonly RawHit[] {
  const trimmed = value.trim();
  if (ONLY_VAR.test(trimmed) || CSS_WIDE_KEYWORDS.has(trimmed)) return [];
  return [
    {
      kind: 'フォント族',
      text: value,
      suggestion: `${property} には var(--font-serif) / var(--font-sans) / var(--font-mono) だけを書く(フォールバック列の正はトークン仕様側にある)`,
    },
  ];
}

/**
 * `content` の装飾文字の密輸を検査する。
 *
 * 空文字・`attr()` / `counter()` / `url()` / `var()`・記号だけの区切り(`"/"` 等)は通す。
 * 文字や数字を含む文字列は、screen_spec を経由しない装飾ラベル(eyebrow 等)の疑いがある
 * ―― 翻訳できず、スクリーンリーダーの読み上げも曖昧になる(styling.md「装飾的な文字」)。
 */
function contentHits(value: string): readonly RawHit[] {
  const trimmed = value.trim();
  if (CSS_WIDE_KEYWORDS.has(trimmed) || CONTENT_KEYWORDS.has(trimmed) || CONTENT_FUNCTION.test(trimmed)) return [];
  const strings = [...trimmed.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? '');
  if (strings.length === 0) return [];
  if (!strings.some((text) => HAS_LETTER_OR_DIGIT.test(text))) return [];
  return [
    {
      kind: '装飾文字',
      text: value,
      suggestion:
        '`content` に文字・数字を持つ文字列を書かない(翻訳不可・SR 曖昧・全検査の外)。' +
        '画面に必要な文言なら screen_spec の部品として宣言し、DOM に実テキストとして出す',
    },
  ];
}

/** 正規表現に当たった箇所を違反にする。 */
function match(value: string, pattern: RegExp, kind: string, suggestion: string): readonly RawHit[] {
  pattern.lastIndex = 0;
  return [...value.matchAll(pattern)].map((hit) => ({ kind, text: hit[0], suggestion }));
}
