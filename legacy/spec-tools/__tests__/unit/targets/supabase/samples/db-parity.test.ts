/**
 * 構造の突合を**この題材で実行できるか**の判定の単体テスト(`lib/targets/supabase/samples/db-parity.ts`)。
 *
 * 見るのは 3 つである。
 *   - 題材の宣言(生成 migration の名前)から「この題材の名前」が引けること
 *   - 一時ツリーで解けない相対 import を持つテストは実行しないこと
 *   - ホストの名前を**本文で**名指すテストは実行しないこと(**散文は数えない**)
 *
 * どれも「実行しないものの一覧」を持たないための判定であり、ここが緑であることは
 * 「`*-parity.test.ts` が 1 本増えても黙って外れない」ことの根拠である。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyParityTest, hostDeclaredNames, sampleDeclaredNames } from '../../../../../lib/targets/supabase/samples/db-parity.js';
import { strippedSource } from '../../../../../lib/targets/supabase/samples/db-parity-source.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../../helpers/platform.js';

/** 判定に渡す「この題材の生成 migration」(依存順の `[パス, 内容]`)。 */
function migrations(): readonly (readonly [string, string])[] {
  return [
    ['supabase/migrations/20260911000000_api_base.sql', '-- api'],
    ['supabase/migrations/20260912120201_ddl_rooms.sql', '-- ddl'],
    ['supabase/migrations/20260912110001_helper_is_user.sql', '-- helper'],
    ['supabase/migrations/20260912110101_policies_rooms.sql', '-- policies'],
    ['supabase/migrations/20260912130101_api_view_rooms.sql', '-- view'],
    ['supabase/migrations/20260912100002_rpc_insert_room.sql', '-- rpc'],
  ];
}

/** テストのパス(リポジトリルート相対)。判定はこの位置を一時ツリーへ写して import を解く。 */
const TEST_FILE = 'app/src/infrastructure/__tests__/schema/sample-parity.test.ts';

let repoRoot: string;
let treeRoot: string;

/** ホストのリポジトリと一時ツリーの両方に、同じ位置の空の置き場を作る。 */
beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'db-parity-repo-'));
  treeRoot = mkdtempSync(path.join(tmpdir(), 'db-parity-tree-'));
  for (const root of [repoRoot, treeRoot]) mkdirSync(path.join(root, path.dirname(TEST_FILE)), { recursive: true });
  // 期待表は題材の生成物なので、一時ツリーの側にだけ在る(`@/` はそこを指す)。
  mkdirSync(path.join(treeRoot, 'app/src/domain/generated'), { recursive: true });
  writeFileSync(path.join(treeRoot, 'app/src/domain/generated/ddl-expectations.ts'), '');
});

afterEach(() => {
  for (const root of [repoRoot, treeRoot]) rmSync(root, { recursive: true, force: true });
});

/** ホスト側にテストの本文を置いて判定を 1 回回す。 */
function classify(source: string, hostNames: readonly string[] = ['members', 'update_member']) {
  writeFileSync(path.join(repoRoot, TEST_FILE), source);
  return classifyParityTest({
    file: TEST_FILE,
    repoRoot,
    treeRoot,
    hostNames: new Set(hostNames),
    sampleNames: sampleDeclaredNames(migrations()), roots: TEST_ROOTS, layout: TEST_LAYOUT });
}

describe('題材が宣言した名前', () => {
  it('生成 migration の印の後ろが表と関数の名前になる', () => {
    expect([...sampleDeclaredNames(migrations())].sort()).toEqual([
      'insert_room',
      'is_user',
      'rooms',
    ]);
  });

  it('印の後ろが空の土台(_api_base)は名前を持たない', () => {
    expect(sampleDeclaredNames([['supabase/migrations/20260911000000_api_base.sql', '']]).size).toBe(0);
  });
});

describe('コメントを落とした字面', () => {
  it('ブロックコメントと行コメントだけが消え、本文は残る', () => {
    const source = "/** members を見る */\nconst a = 1; // workshops の話\nconst b = 'rooms';";
    expect(strippedSource(source)).not.toContain('members');
    expect(strippedSource(source)).not.toContain('workshops');
    expect(strippedSource(source)).toContain('rooms');
  });

  it('URL の `//` を行コメントと読まない', () => {
    expect(strippedSource("const url = 'https://example.test/x';")).toContain('example.test');
  });
});

describe('この題材で実行できるかの判定', () => {
  it('期待表と実 DB だけを読むテストは実行する', () => {
    const verdict = classify(
      "import { Client } from 'pg';\nimport { rooms } from '@/domain/generated/ddl-expectations';\n",
    );
    expect(verdict).toEqual({ file: TEST_FILE, fit: true, reason: null, carries: [] });
  });

  it('一時ツリーで解けない相対 import を持つテストは実行しない', () => {
    const verdict = classify("import { withPg } from '../seed-members';\n");
    expect(verdict.fit).toBe(false);
    expect(verdict.reason).toBe(`${TEST_FILE}: ../seed-members が一時ツリーに無い`);
  });

  it('一時ツリーに実在する相対 import は実行する妨げにならない', () => {
    writeFileSync(path.join(treeRoot, 'app/src/infrastructure/__tests__/seed.ts'), '');
    expect(classify("import { withPg } from '../seed';\n").fit).toBe(true);
  });

  it('一時ツリーに無い期待表(@/)を import するテストは実行しない', () => {
    const verdict = classify("import { x } from '@/domain/generated/rpc-expectations';\n");
    expect(verdict.fit).toBe(false);
    expect(verdict.reason).toBe(`${TEST_FILE}: @/domain/generated/rpc-expectations が一時ツリーに無い`);
  });

  it('リポジトリにしか無い同じ置き場の部品は持ち込む(実行できる)', () => {
    writeFileSync(path.join(repoRoot, 'app/src/infrastructure/__tests__/schema/pg-type-names.ts'), 'export const a = 1;\n');
    const verdict = classify("import { a } from './pg-type-names';\n");
    expect(verdict.fit).toBe(true);
    expect(verdict.carries).toEqual(['app/src/infrastructure/__tests__/schema/pg-type-names.ts']);
  });

  it('持ち込む部品がアプリの名前を持っていれば、それを import した突合ごと実行しない', () => {
    writeFileSync(
      path.join(repoRoot, 'app/src/infrastructure/__tests__/schema/host-helper.ts'),
      "export const t = 'members';\n",
    );
    expect(classify("import { t } from './host-helper';\n").fit).toBe(false);
  });

  it('この題材が宣言していない名前を本文が名指すテストは実行しない', () => {
    const verdict = classify("it('members', () => expectParity('members'));\n");
    expect(verdict.fit).toBe(false);
    expect(verdict.reason).toBe('この題材が宣言していない名前を本文が名指している(members)');
  });

  it('散文(コメント)に出るだけの名前では実行しない判定にならない', () => {
    expect(classify('/** members の話をする散文。 */\nconst a = 1;\n').fit).toBe(true);
  });

  it('属性名として出るだけの語(Object.entries)では実行しない判定にならない', () => {
    expect(classify('const a = Object.entries({});\n', ['entries']).fit).toBe(true);
  });

  it('この題材も宣言している名前なら名指していても実行する', () => {
    expect(classify("const t = 'rooms';\n", ['rooms']).fit).toBe(true);
  });

  it('名前が 4 つ以上なら頭の 3 つと総数を報告する', () => {
    const verdict = classify('const a = [members, workshops, venues, entries];\n', [
      'members',
      'workshops',
      'venues',
      'entries',
    ]);
    expect(verdict.reason).toBe(
      'この題材が宣言していない名前を本文が名指している(entries / members / venues ほか 1 件)',
    );
  });
});

describe('hostDeclaredNames: 読めずに落とした表の名前も、ホストが宣言する名前に数える', () => {
  it('フロントマターが読めない表のファイルでも、表の名前(置き場のファイル名)は名前の母集合に残る', () => {
    const tables = path.join(repoRoot, TEST_ROOTS.specs, 'backend/data/tables');
    mkdirSync(tables, { recursive: true });
    writeFileSync(path.join(tables, 'shelves.md'), 'フロントマターの無い、壊れた表\n');

    expect([...hostDeclaredNames(repoRoot, TEST_ROOTS)]).toEqual(['shelves']);
  });
});

