/**
 * G1(実装の CSS に生値を書かない)のテスト。
 *
 * 規約(scripts-code-quality.md)の「規約網羅」に従い、styling.md の G1 が挙げる各種類
 * (色・色名・システム色・長さ・時間・無単位のマジック値・フォント族・装飾文字)と、
 * 通すべき値(0・% ・auto・flex 系の無単位数・var)に 1 つ以上のケースを置く。
 *
 * **許可リスト方式**(2026-09 反転)の要である 3 つの表(単位・色名・システム色。
 * `g1-tables.ts`)が実際に「表に無かったものを落とす」ことを、旧版では素通りしていた
 * 具体例(`cyan`・`ButtonText`・`dvh`)で確かめる。
 */

import { describe, expect, it } from 'vitest';
import { g1RawValues } from '../../../../lib/design/verifiers/g1-raw-values.js';
import { cssFile, designInput } from '../../../helpers/design-builder.js';

/** 1 枚の CSS に対して G1 を実行する。 */
function run(source: string, generated = false) {
  return g1RawValues.verify(designInput({ files: [cssFile('app/src/a.module.css', source, generated)] }));
}

describe('G1 生値の直書き', () => {
  it('トークンだけで書かれた CSS は通る', () => {
    const findings = run(`.card {
  padding: var(--space-4);
  border: var(--border-hairline) solid var(--color-border);
  background-color: var(--color-surface);
  font-family: var(--font-sans);
  opacity: var(--opacity-hover);
}`);

    expect(findings).toEqual([]);
  });

  it('hex の色を検出する', () => {
    const findings = run(`.a {
  color: #ccc;
}`);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('色を直接書いています');
    expect(findings[0]?.location.pointer).toBe('2 行目');
  });

  it('色関数を検出する', () => {
    const findings = run(`.a {
  background: rgba(0, 0, 0, 0.5);
}`);

    const kinds = findings.map((finding) => finding.message);
    expect(kinds.some((message) => message.includes('色を直接書いています'))).toBe(true);
    // rgba() の内部の数値(0 / 0.5)を「無単位のマジック値」として二重に報告しない。
    expect(findings).toHaveLength(1);
  });

  it('CSS の色名表に載っている色を検出する(旧表に有った white)', () => {
    const findings = run(`.a {
  border-color: white;
}`);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('色名を直接書いています');
  });

  it('旧表(24 語)に無かった色名も検出する ―― 許可リスト反転で塞いだ穴', () => {
    const findings = run(`.a {
  border-color: cyan;
}`);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('色名を直接書いています');
    expect(findings[0]?.counterexample?.['value']).toBe('cyan');
  });

  it('システム色(ButtonText 等)を検出する ―― 旧版は 1 語も見ていなかった', () => {
    const findings = run(`.a {
  color: ButtonText;
}`);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('システム色を直接書いています');
  });

  it('var(--color-canvas) のようなトークン参照を色名と誤検出しない(canvas はシステム色)', () => {
    const findings = run(`.a {
  background-color: var(--color-canvas);
}`);

    expect(findings).toEqual([]);
  });

  it('px / rem / ms の付いた値を検出する', () => {
    const findings = run(`.a {
  padding: 16px;
  margin: 1.5rem;
  transition-duration: 120ms;
}`);

    expect(findings).toHaveLength(3);
    expect(findings.every((finding) => finding.message.includes('長さ・時間'))).toBe(true);
  });

  it('単位表に無い新しい単位(dvh・cqw)も検出する ―― 許可リスト反転で塞いだ穴', () => {
    const findings = run(`.a {
  height: 100dvh;
  width: 4cqw;
}`);

    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.message.includes('長さ・時間'))).toBe(true);
  });

  it('% ・fr・vw・vh は単位表どおり通す', () => {
    const findings = run(`.a {
  width: 100%;
  grid-template-columns: 1fr 2fr;
  min-height: 100vh;
  max-width: 50vw;
}`);

    expect(findings).toEqual([]);
  });

  it('0・flex 系の無単位数・z-index は通す(対応するトークンが無いため)', () => {
    const findings = run(`.a {
  border: 0;
  margin: 0 auto;
  flex: 1 1 auto;
  order: 2;
  z-index: 100;
}`);

    expect(findings).toEqual([]);
  });

  it('font-size に無単位のマジック値(0 等)を書くと検出する ―― 無単位すり抜けの穴', () => {
    const findings = run(`.a {
  font-size: 0;
}`);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('無単位の値を直接書いています');
    expect(findings[0]?.suggestion).toContain('text-*');
  });

  it('opacity・line-height・letter-spacing・font-weight の無単位直書きを検出する(トークンが有るのに素通りしていた穴)', () => {
    const findings = run(`.a {
  opacity: 0.45;
  line-height: 1.7;
  letter-spacing: 0.02;
  font-weight: 700;
}`);

    expect(findings).toHaveLength(4);
    expect(findings.every((finding) => finding.message.includes('無単位の値を直接書いています'))).toBe(true);
  });

  it('トークンを持たない無単位プロパティに、flex/order/z-index 以外の値を書くと検出する', () => {
    const findings = run(`.a {
  tab-size: 4;
}`);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('無単位の値を直接書いています');
  });

  it('font-family の族の直接指定を検出する', () => {
    const findings = run(`.a {
  font-family: system-ui, sans-serif;
}`);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('フォント族を直接書いています');
  });

  it('font-family: inherit は通す(意匠の宣言ではない)', () => {
    const findings = run(`.a {
  font-family: inherit;
}`);

    expect(findings).toEqual([]);
  });

  it('content の装飾文字(文字・数字を含む文字列)を検出する ―― eyebrow 等の密輸', () => {
    const findings = run(`.a::before {
  content: "注目";
}`);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('装飾文字を直接書いています');
  });

  it('content: "" / 記号だけの区切り / attr() / counter() / var() は通す', () => {
    const findings = run(`.a::before {
  content: "";
}
.b::after {
  content: "/";
}
.c::before {
  content: attr(data-label);
}
.d::before {
  content: counter(item) ".";
}
.e::before {
  content: var(--separator);
}`);

    expect(findings).toEqual([]);
  });

  it('文字列リテラルの中身は色・単位として拾わない(content 以外)', () => {
    const findings = run(`.a {
  --debug: "12px white";
}`);

    expect(findings).toEqual([]);
  });

  it('コメントの中身は検査しない', () => {
    const findings = run(`/* 以前は #ccc と 16px を書いていた */
.a {
  color: var(--color-text);
}`);

    expect(findings).toEqual([]);
  });

  it('生成物は対象外(palette の実値はそこにしか置けない)', () => {
    const findings = run(`:root {
  --color-canvas: #faf6ef;
  --space-4: 16px;
}`, true);

    expect(findings).toEqual([]);
  });

  it('CSS を読めない環境では何も報告しない', () => {
    const findings = g1RawValues.verify(designInput({ cssAvailable: false }));

    expect(findings).toEqual([]);
  });
});
