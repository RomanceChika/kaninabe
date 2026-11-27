/**
 * `checkTestCaseTrace` が「実装の範囲の外」で**純粋な不在だけ**に印(`absentFor`)を付けることを見る。
 *
 * 印は「テストが無い」ことだけを範囲の外なら許すためのもので、**付けすぎると本物の誤りを消す**。だから付ける場面は 2 つに絞る:
 *   - テストファイルが実在せず、`@tc` がどこにも無い
 *   - テストファイルは実在するが、`@tc` がどこにも無い
 * `@tc` が 1 つでもあれば(別のファイル・名前の食い違い・`spec_ids` の食い違い)、範囲の外でも突合の全部を行い、印は付けない。
 * 持ち主が `null` の呼び出し(仕組み自身の見張りテストの台帳)は、いつでも印を付けない(免除されない)。
 *
 * `owner` は必須の引数で、全部の呼び手が明示する。
 */

import { describe, expect, it } from 'vitest';
import { checkTestCaseTrace } from '../../../lib/testcase/index.js';
import type { ScopeOwner } from '../../../lib/kernel/scope-owner.js';
import type { TcRegistryEntry, TestAnnotation } from '../../../lib/testcase/types.js';

/** 範囲の外にある持ち主(題材 rooms の操作)。 */
const OWNER: ScopeOwner = { kind: 'action', id: 'room-create-action' };

/** 台帳のエントリ 1 件。 */
const ENTRY: TcRegistryEntry = {
  tcId: 'TC-ROOM-CREATE-001',
  specKind: 'action_spec',
  specId: 'room-create-action',
  specIds: ['room-create'],
  implementation: {
    raw: 'app/src/operation/__tests__/room/create.test.ts::部屋を作る',
    file: 'app/src/operation/__tests__/room/create.test.ts',
    testName: '部屋を作る',
  },
  location: { file: 'docs/specs/backend/actions/room/create.md', pointer: 'test_cases.TC-ROOM-CREATE-001' },
  specFile: 'docs/specs/backend/actions/room/create.md',
};

/** アノテーション 1 件(既定は仕様どおりの形)。 */
function annotation(overrides: Partial<TestAnnotation> = {}): TestAnnotation {
  return {
    tcId: ENTRY.tcId,
    specIds: ['room-create'],
    testName: '部屋を作る',
    file: ENTRY.implementation.file,
    line: 7,
    ...overrides,
  };
}

/** 実在するテストファイルの集合(ENTRY の file を持つ / 持たない)。 */
const WITH_FILE: ReadonlySet<string> = new Set([ENTRY.implementation.file]);
const WITHOUT_FILE: ReadonlySet<string> = new Set();

describe('範囲の外(owner あり)で印を付ける場面 — 純粋な不在だけ', () => {
  it('テストファイルが無く、@tc もどこにも無い: 印を付ける', () => {
    const findings = checkTestCaseTrace(ENTRY, [], WITHOUT_FILE, 'A6', OWNER);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('implementation が指すテストファイルがありません');
    expect(findings[0]?.absentFor).toEqual(OWNER);
  });

  it('テストファイルは実在するが、@tc がどこにも無い: 印を付ける', () => {
    const findings = checkTestCaseTrace(ENTRY, [], WITH_FILE, 'A6', OWNER);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('に対応する "@tc TC-ROOM-CREATE-001" がテストコードにありません');
    expect(findings[0]?.absentFor).toEqual(OWNER);
  });

  it('印は検証器 ID に依らず付く(Q6 でも同じ)', () => {
    expect(checkTestCaseTrace(ENTRY, [], WITH_FILE, 'Q6', OWNER)[0]?.absentFor).toEqual(OWNER);
  });
});

describe('範囲の外(owner あり)でも印を付けない場面 — 不在ではなく食い違い', () => {
  it('@tc が別のファイルにある: 印を付けない(error のまま)', () => {
    const elsewhere = annotation({ file: 'app/src/operation/__tests__/room/other.test.ts' });

    const findings = checkTestCaseTrace(ENTRY, [elsewhere], WITH_FILE, 'A6', OWNER);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('は別のファイルにあります');
    expect(findings[0]?.absentFor).toBeUndefined();
  });

  it('テストファイルが無いが、@tc は別の場所にある: 印を付けない(ファイルの不在でも、アノテーションがあれば全部の突合)', () => {
    const elsewhere = annotation({ file: 'app/src/operation/__tests__/room/other.test.ts' });

    const findings = checkTestCaseTrace(ENTRY, [elsewhere], WITHOUT_FILE, 'A6', OWNER);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('implementation が指すテストファイルがありません');
    expect(findings[0]?.absentFor).toBeUndefined();
  });

  it('テスト名が食い違う: 印を付けない', () => {
    const findings = checkTestCaseTrace(ENTRY, [annotation({ testName: '別の名前' })], WITH_FILE, 'A6', OWNER);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('テスト名が implementation と一致しません');
    expect(findings[0]?.absentFor).toBeUndefined();
  });

  it('アノテーションが飾るテストを特定できない: 印を付けない', () => {
    const findings = checkTestCaseTrace(ENTRY, [annotation({ testName: null })], WITH_FILE, 'A6', OWNER);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.absentFor).toBeUndefined();
  });

  it('spec_ids が食い違う: 印を付けない(warning のまま)', () => {
    const findings = checkTestCaseTrace(ENTRY, [annotation({ specIds: ['room-update'] })], WITH_FILE, 'A6', OWNER);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.absentFor).toBeUndefined();
  });

  it('仕様どおりに突合できていれば何も出ない(範囲の外でも)', () => {
    expect(checkTestCaseTrace(ENTRY, [annotation()], WITH_FILE, 'A6', OWNER)).toEqual([]);
  });
});

describe('owner が null の呼び出し(仕組み自身の台帳)は免除されない', () => {
  it.each([
    ['テストファイルが無い', [], WITHOUT_FILE],
    ['@tc がどこにも無い', [], WITH_FILE],
    ['@tc が別のファイルにある', [annotation({ file: 'app/src/operation/__tests__/room/other.test.ts' })], WITH_FILE],
    ['テスト名が食い違う', [annotation({ testName: '別の名前' })], WITH_FILE],
  ] as const)('%s: 印を付けない', (_label, annotations, files) => {
    const findings = checkTestCaseTrace(ENTRY, annotations, files, 'Z3', null);

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(finding.absentFor).toBeUndefined();
  });
});
