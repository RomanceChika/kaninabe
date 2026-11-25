/**
 * 注釈付きテストブロックの中身の切り出し(A16 の材料)のユニットテスト。
 *
 * 網羅する形:
 *   - `it('…', async () => { … })` の本体を切り出せること
 *   - **分割代入の引数**(`async ({ page }) => {`)を本体と取り違えないこと
 *   - コメント・文字列の中の波括弧を数えないこと
 *   - assert がループの中にしか無いことを見分けること
 *   - assert を含むヘルパの名前を集められること
 */

import { describe, expect, it } from 'vitest';
import { collectAssertionHelpers, extractTestBlocks } from '../../../../lib/model/trace/extract-assertions.js';

/** 注釈 1 件(1 行目のコメントを想定)。 */
const TAGS = [{ tcId: 'TC-X-001', line: 1 }];

describe('extractTestBlocks: 注釈付きブロックの中身', () => {
  it('矢印関数の本体を切り出して assert を数える', () => {
    const source = ["// @tc TC-X-001", "it('a', () => {", '  expect(1).toBe(1);', '});'].join('\n');

    const [block] = extractTestBlocks(source, TAGS);

    expect(block?.readable).toBe(true);
    expect(block?.directAssertions).toBe(1);
    expect(block?.directAssertionsOutsideLoop).toBe(1);
  });

  it('分割代入の引数を本体と取り違えない(E2E の `async ({ page }) => {`)', () => {
    const source = [
      '// @tc TC-X-001',
      "test('a', async ({",
      '  page,',
      '}) => {',
      '  await expect(page).toBeTruthy();',
      '});',
    ].join('\n');

    const [block] = extractTestBlocks(source, TAGS);

    expect(block?.directAssertions).toBe(1);
  });

  it('コメントと文字列の中の波括弧は数えない', () => {
    const source = [
      '// @tc TC-X-001',
      "it('a', () => {",
      "  const s = '} {';",
      '  // }',
      '  expect(s).toBe(s);',
      '});',
    ].join('\n');

    const [block] = extractTestBlocks(source, TAGS);

    expect(block?.directAssertions).toBe(1);
  });

  it('assert がループの中にしか無いことを見分ける', () => {
    const source = [
      '// @tc TC-X-001',
      "it('a', () => {",
      '  for (const x of items) {',
      '    expect(x).toBe(1);',
      '  }',
      '});',
    ].join('\n');

    const [block] = extractTestBlocks(source, TAGS);

    expect(block?.directAssertions).toBe(1);
    expect(block?.directAssertionsOutsideLoop).toBe(0);
  });

  it('ループの外にも assert があればループだけではない', () => {
    const source = [
      '// @tc TC-X-001',
      "it('a', () => {",
      '  expect(items).not.toHaveLength(0);',
      '  for (const x of items) {',
      '    expect(x).toBe(1);',
      '  }',
      '});',
    ].join('\n');

    const [block] = extractTestBlocks(source, TAGS);

    expect(block?.directAssertionsOutsideLoop).toBe(1);
  });

  it('matcher の無い expect(...) は assert に数えない(網の穴探し M31)', () => {
    const source = [
      '// @tc TC-X-001',
      "it('a', () => {",
      "  expect(isCronAuthorized(undefined, 'Bearer undefined'));",
      '});',
    ].join('\n');

    const [block] = extractTestBlocks(source, TAGS);

    expect(block?.readable).toBe(true);
    expect(block?.directAssertions).toBe(0);
    expect(block?.directAssertionsOutsideLoop).toBe(0);
  });

  it('呼び出している識別子を集める(ヘルパ判定の材料)', () => {
    const source = ['// @tc TC-X-001', "it('a', () => {", '  expectRejected(result);', '});'].join('\n');

    const [block] = extractTestBlocks(source, TAGS);

    expect(block?.calls.map((call) => call.name)).toContain('expectRejected');
    expect(block?.directAssertions).toBe(0);
  });

  it('ヘルパ呼び出しがループの中にあることを見分ける(2 段のどちらにも掛からない空白を塞ぐ)', () => {
    const source = [
      '// @tc TC-X-001',
      "it('a', () => {",
      '  for (const x of items) {',
      '    expectCalls(x);',
      '  }',
      '});',
    ].join('\n');

    const [block] = extractTestBlocks(source, TAGS);
    const call = block?.calls.find((candidate) => candidate.name === 'expectCalls');

    expect(call?.inLoop).toBe(true);
  });

  it('テスト宣言が遠すぎれば読めないものとして扱う', () => {
    const source = ['// @tc TC-X-001', '', '', '', '', '', "it('a', () => {", '});'].join('\n');

    const [block] = extractTestBlocks(source, TAGS);

    expect(block?.readable).toBe(false);
  });
});

describe('collectAssertionHelpers: assert を含むヘルパ', () => {
  it('関数宣言と定数宣言の両方から集める', () => {
    const source = [
      'export function expectRejected(result) {',
      '  expect(result.ok).toBe(false);',
      '}',
      'const plain = (x) => {',
      '  return x;',
      '};',
      'export const expectOk = (result) => {',
      '  expect(result.ok).toBe(true);',
      '};',
    ].join('\n');

    const names = collectAssertionHelpers(source);

    expect(names).toContain('expectRejected');
    expect(names).toContain('expectOk');
    expect(names).not.toContain('plain');
  });

  it('値の定数は後続のブロックを本体と取り違えない(免除の母集合が膨らむ形)', () => {
    const source = [
      'const UNRELATED_LIMIT = 3;',
      "describe('x', () => {",
      '  expect(1).toBe(1);',
      '});',
    ].join('\n');

    expect(collectAssertionHelpers(source)).not.toContain('UNRELATED_LIMIT');
  });

  it('オブジェクト・配列の定数もヘルパにしない', () => {
    const source = [
      'const TABLE = { a: 1 };',
      'const ROWS = [1, 2].map((x) => x);',
      "it('x', () => {",
      '  expect(1).toBe(1);',
      '});',
    ].join('\n');

    const names = collectAssertionHelpers(source);

    expect(names).not.toContain('TABLE');
    expect(names).not.toContain('ROWS');
  });

  it('matcher を呼ばない expect(...) だけの関数はヘルパにしない(呼んでも何も主張しない)', () => {
    const source = [
      'function expectNothing(value: unknown): void {',
      '  expect(value);',
      '}',
    ].join('\n');

    expect(collectAssertionHelpers(source)).not.toContain('expectNothing');
  });

  it('戻り値の型注釈を挟む関数宣言は拾う(下限を狭めすぎない)', () => {
    const source = [
      'function expectCalls(name: string, guard: string): void {',
      '  expect(name).toBe(guard);',
      '}',
    ].join('\n');

    expect(collectAssertionHelpers(source)).toContain('expectCalls');
  });
});
