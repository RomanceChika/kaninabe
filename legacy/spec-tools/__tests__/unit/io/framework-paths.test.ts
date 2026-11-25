/**
 * 仕組み自身の住所(`framework-paths.ts`)のテスト。
 *
 * 仕組みの根は検査器の自分の位置から引く(製品の宣言からは来ない)。置き場の判定は、仕組みの台帳の
 * `implementation.file` と、製品の台帳が仕組みの置き場を指すエントリの振り分け(Z1)が共有する。
 */

import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FRAMEWORK_GUARANTEES_FILE,
  FRAMEWORK_TEST_ROOTS,
  frameworkHostRoot,
  isUnderFrameworkTestRoots,
} from '../../../lib/io/framework-paths.js';
import { isFile } from '../../../lib/io/paths.js';

describe('frameworkHostRoot', () => {
  it('検査器のパッケージ(legacy/spec-tools)の 2 つ上で、作業ディレクトリに依らない', () => {
    const before = frameworkHostRoot();
    vi.spyOn(process, 'cwd').mockReturnValue(path.parse(before).root);
    const root = frameworkHostRoot();
    vi.restoreAllMocks();

    expect(root).toBe(before);
    expect(path.isAbsolute(root)).toBe(true);
    expect(root.endsWith(path.sep)).toBe(false);
    expect(isFile(path.join(root, 'legacy/spec-tools/package.json'))).toBe(true);
  });
});

describe('仕組みの見張りテストの置き場', () => {
  it('台帳の住所と置き場の綴りは仕組みの根からの相対である', () => {
    expect(FRAMEWORK_GUARANTEES_FILE).toBe('framework/guarantees.md');
    expect(FRAMEWORK_TEST_ROOTS).toEqual(['framework/runtime/src', 'legacy/spec-tools/__tests__/guarantees']);
  });

  it('置き場の下のパスだけが当たる(前方一致の取り違えや製品の木は当たらない)', () => {
    expect(isUnderFrameworkTestRoots('framework/runtime/src/domain/a.test.ts')).toBe(true);
    expect(isUnderFrameworkTestRoots('legacy/spec-tools/__tests__/guarantees/b.test.ts')).toBe(true);
    expect(isUnderFrameworkTestRoots('framework/runtime/src')).toBe(true);
    expect(isUnderFrameworkTestRoots('framework/runtime/srcs/a.test.ts')).toBe(false);
    expect(isUnderFrameworkTestRoots('legacy/spec-tools/__tests__/unit/c.test.ts')).toBe(false);
    expect(isUnderFrameworkTestRoots('app/src/operation/d.test.ts')).toBe(false);
  });
});
