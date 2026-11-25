/**
 * CSS 走査(宣言と var() の取り出し)のテスト。
 *
 * G1 / G2 の入力を作る層なので、**読める書き方と読めない書き方の境目**を固定する。
 * 読めない書き方は「検査されない」のであって「通った」のではない —— その事実を
 * テストとして残しておかないと、既知の穴が黙って忘れられる（styling.md §既知の穴）。
 */

import { describe, expect, it } from 'vitest';
import { scanDeclarations, scanVarUses, stripComments, stripStrings } from '../../../lib/design/css-scan.js';

describe('css-scan', () => {
  it('1 行 1 宣言を行番号つきで取り出す', () => {
    const found = scanDeclarations('a.css', `.card {\n  padding: var(--space-4);\n  color: red;\n}`);

    expect(found).toEqual([
      { file: 'a.css', line: 2, property: 'padding', value: 'var(--space-4)' },
      { file: 'a.css', line: 3, property: 'color', value: 'red' },
    ]);
  });

  it('カスタムプロパティの定義も宣言として読む', () => {
    const found = scanDeclarations('a.css', `:root {\n  --color-canvas: #faf6ef;\n}`);

    expect(found[0]).toMatchObject({ property: '--color-canvas', value: '#faf6ef' });
  });

  it('セレクタ行は宣言にしない', () => {
    expect(scanDeclarations('a.css', `.a,\n.b {\n}`)).toEqual([]);
  });

  it('@media の条件は宣言として読む(そこに書かれた px も生値である)', () => {
    const found = scanDeclarations('a.css', `@media (min-width: 900px) {`);

    expect(found[0]).toMatchObject({ property: 'min-width', value: '900px' });
  });

  it('コメントは行数を保ったまま潰す', () => {
    const stripped = stripComments(`/* a\nb */\n.x {}`);

    expect(stripped.split('\n')).toHaveLength(3);
    expect(stripped).not.toContain('a');
  });

  it('1 行に 2 つ書いた宣言は読み落とす(既知の穴)', () => {
    const found = scanDeclarations('a.css', `.a { color: #ccc; padding: 4px; }`);

    expect(found).toEqual([]);
  });

  it('var() の参照を名前と行番号で取り出す', () => {
    const found = scanVarUses('a.css', `.a {\n  color: var(--color-text);\n  gap: var( --space-2 );\n}`);

    expect(found.map((use) => use.name)).toEqual(['color-text', 'space-2']);
    expect(found[1]?.line).toBe(3);
  });

  it('1 行に複数の var() があればすべて取り出す', () => {
    const found = scanVarUses('a.css', `  border: var(--border-hairline) solid var(--color-border);`);

    expect(found.map((use) => use.name)).toEqual(['border-hairline', 'color-border']);
  });

  it('文字列リテラルを空にする', () => {
    expect(stripStrings(`"12px" and '16px'`)).toBe(`"" and ''`);
  });
});
