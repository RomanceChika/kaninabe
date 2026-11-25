/**
 * ハンドブックの人向けの表示の CSS(`docs/.vitepress/theme/book-face/`)を、実装の CSS と同じ規約で
 * 検査する配線のテスト(G1 生値 / G2 実在 / G7 死語彙に渡る)。
 *
 * トークンを足すと、使う側が実装の CSS だけでは G7 が「死語彙」と言う。ブックの CSS も走査に入れることで、
 * 足したトークンをブックの部品が引いていれば緑になり、引かなくなれば落ちる。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBookFaceCss } from '../../../lib/model/design/loader.js';
import { g1RawValues } from '../../../lib/design/verifiers/g1-raw-values.js';
import { g7DeadTokens } from '../../../lib/design/verifiers/g7-dead-tokens.js';
import { FRAMEWORK_BOOK_FACE_DIR } from '../../../lib/io/paths.js';
import { colorToken, cssFile, designInput, group, tokenSpec } from '../../helpers/design-builder.js';

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'book-face-css-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 置き場にファイルを書く。 */
function write(name: string, source: string): void {
  const dir = path.join(root, FRAMEWORK_BOOK_FACE_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), source);
}

describe('loadBookFaceCss', () => {
  it('置き場の .css を、リポジトリルート相対のパスで、生成物でないものとして読む', () => {
    write('face.css', '.a { color: var(--color-ink); }\n');
    write('notes.txt', '読まない');

    const files = loadBookFaceCss(root);

    expect(files).toEqual([{ file: `${FRAMEWORK_BOOK_FACE_DIR}/face.css`, source: '.a { color: var(--color-ink); }\n', generated: false }]);
  });

  it('置き場が無ければ空(仕組みだけのリポジトリでも壊れない)', () => {
    expect(loadBookFaceCss(root)).toEqual([]);
  });
});

describe('ブックの CSS を G1・G7 に渡す', () => {
  const spec = tokenSpec({ groups: [group('color', [colorToken('color-ink', '#111111'), colorToken('color-mark', '#222222')])] });
  const face = (source: string): ReturnType<typeof designInput> =>
    designInput({ spec, files: [cssFile(`${FRAMEWORK_BOOK_FACE_DIR}/face.css`, source)] });

  it('ブックの CSS が引いているトークンは死語彙ではない。引いていなければ死語彙として落ちる', () => {
    expect(g7DeadTokens.verify(face('.a { color: var(--color-ink); background: var(--color-mark); }'))).toEqual([]);
    expect(g7DeadTokens.verify(face('.a { color: var(--color-ink); }')).map((finding) => finding.message)).toEqual([
      expect.stringContaining('--color-mark'),
    ]);
  });

  it('ブックの CSS に生の色・長さを書くと G1 が落とす(トークンから引く)', () => {
    expect(g1RawValues.verify(face('.a {\n  color: #ff0000;\n  margin: 10px;\n}')).length).toBeGreaterThanOrEqual(2);
  });
});
