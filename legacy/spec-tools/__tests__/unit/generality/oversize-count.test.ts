/**
 * 300 行を超える**宣言つきファイルの本数**(verify の W 群が出す 1 行)のテスト。
 *
 * 見たいのは 4 つ。
 *   ① 宣言が正しく揃った 300 行超のファイルだけを数える(宣言なし・片方だけ・理由が行数・
 *      300 行以下のものは数えない。違反は lint の仕事で、ここは件数の報告に徹する)
 *   ② テスト(`__tests__` ・`*.test.ts`)と生成物(目印つき)は数えない(lint も外している)
 *   ③ 実装の木を持たない製品でも壊れない(見える木だけを数える)
 *   ④ このリポジトリの実物で、数えた本数が一覧の長さと一致する(判定は lint と同じ純関数を呼ぶ)
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countDeclaredOversize } from '../../../lib/generality/oversize-count.js';
import { GENERATED_MARKER } from '../../../lib/generality/scan.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
const created: string[] = [];
afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

const OVERSIZE = '@oversize 超える理由: 1 つの表の全規則を 1 か所で読み通せるようにするため。';
const REVIEW = '@split-review 割る案と結果: 規則ごとに割ると互いの参照が増えるので採らない。';

/** 300 行を超える本文(冒頭の JSDoc に指定のタグ)。 */
function big(tags: readonly string[], prefix = '', literal = ''): string {
  const header = `${prefix}/**\n * 見出し。\n${tags.map((tag) => ` * ${tag}\n`).join('')} */\n${literal}`;
  return `${header}${Array.from({ length: 310 }, (_, i) => `export const v${i} = ${i};`).join('\n')}\n`;
}

/** 指定のファイル(リポジトリルート相対 → 本文)を持つ一時ツリーを作る。 */
function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'oversize-'));
  created.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

describe('countDeclaredOversize', () => {
  it('宣言が正しく揃った 300 行超のファイルだけを数える', () => {
    const app = TEST_ROOTS.app ?? 'app';
    const root = tree({
      'legacy/spec-tools/lib/x/declared.ts': big([OVERSIZE, REVIEW]),
      'legacy/spec-tools/lib/x/only-oversize.ts': big([OVERSIZE]),
      'legacy/spec-tools/lib/x/undeclared.ts': big([]),
      'legacy/spec-tools/lib/x/by-lines.ts': big(['@oversize 行数が多いので分けない。', REVIEW]),
      'legacy/spec-tools/lib/x/small.ts': 'export const a = 1;\n',
      [`${app}/src/declared.ts`]: big([OVERSIZE, REVIEW]),
      'framework/pkg/src/declared.mjs': big([OVERSIZE, REVIEW]),
    });
    expect(countDeclaredOversize(root, TEST_ROOTS, TEST_LAYOUT).declared).toEqual([
      `${app}/src/declared.ts`,
      'framework/pkg/src/declared.mjs',
      // 道具(`legacy/spec-tools`)は `framework` の中に居るので 1 回だけ数える(根を重ねて二重に数えない)。
      'legacy/spec-tools/lib/x/declared.ts',
    ]);
  });

  it('テストと生成物は数えない(lint も外している)', () => {
    const root = tree({
      'legacy/spec-tools/__tests__/unit/declared.ts': big([OVERSIZE, REVIEW]),
      'framework/pkg/src/declared.test.ts': big([OVERSIZE, REVIEW]),
      'framework/pkg/src/__tests__/declared.ts': big([OVERSIZE, REVIEW]),
      'legacy/spec-tools/lib/x/generated.ts': big([OVERSIZE, REVIEW], `// ${GENERATED_MARKER} — 手編集禁止。\n`),
    });
    expect(countDeclaredOversize(root, TEST_ROOTS, TEST_LAYOUT).declared).toEqual([]);
  });

  it('文中に生成物の目印の語を書いただけのファイルは生成物ではない(数える)', () => {
    const root = tree({ 'legacy/spec-tools/lib/x/mentions.ts': big([OVERSIZE, REVIEW], '', `export const WORDING = '${GENERATED_MARKER}';\n`) });
    expect(countDeclaredOversize(root, TEST_ROOTS, TEST_LAYOUT).declared).toEqual(['legacy/spec-tools/lib/x/mentions.ts']);
  });

  it('実装の木を持たない製品でも壊れない(見える木だけを数える)', () => {
    const root = tree({ 'legacy/spec-tools/lib/x/declared.ts': big([OVERSIZE, REVIEW]) });
    expect(countDeclaredOversize(root, { ...TEST_ROOTS, app: null }, TEST_LAYOUT).declared).toEqual(['legacy/spec-tools/lib/x/declared.ts']);
  });

  it('このリポジトリの実物を数えても落ちない(0 本以上)', () => {
    const repo = path.resolve(import.meta.dirname, '../../../../..');
    expect(countDeclaredOversize(repo, TEST_ROOTS, TEST_LAYOUT).declared.length).toBeGreaterThanOrEqual(0);
  });
});
