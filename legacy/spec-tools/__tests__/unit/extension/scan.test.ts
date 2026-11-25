/**
 * 検査 ID の走査(I/O 境界)のテスト。一時ツリーの `.ts` から ID を集め、起点が無ければ null を返す。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultLibDir, scanKnownVerifierIds } from '../../helpers/verifier-id-scan.js';

let root = '';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'extension-scan-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scanKnownVerifierIds', () => {
  it('起点の下の .ts から検査 ID の綴りを集める(ほかの拡張子は読まない)', () => {
    mkdirSync(path.join(root, 'sub'));
    writeFileSync(path.join(root, 'a.ts'), "const VERIFIER_ID = 'T8';\n");
    writeFileSync(path.join(root, 'sub', 'b.ts'), 'const id = "K3";\n');
    writeFileSync(path.join(root, 'c.md'), "'Z9'\n");

    expect([...(scanKnownVerifierIds(root) ?? [])].sort()).toEqual(['K3', 'T8']);
  });

  it('起点が無い構成では null(実在しないと断じない)', () => {
    expect(scanKnownVerifierIds(path.join(root, 'missing'))).toBeNull();
  });

  it('既定の起点は実行している検査器の lib で、実在の検査 ID を含む', () => {
    const ids = scanKnownVerifierIds(defaultLibDir());

    expect(ids?.has('T8')).toBe(true);
    expect(ids?.has('W5')).toBe(true);
  });
});
