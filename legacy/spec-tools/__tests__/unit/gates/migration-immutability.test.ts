/**
 * 適用済み migration の不変性(C23)の検査のテスト。
 *
 * 判定は純粋関数(`frozenViolations`)だが、**本物の `git diff --name-status -z` の出力が
 * 読めること**まで見ないと意味が無い(改名の 3 レコード形式・状態文字の後ろに付く類似度の
 * 数字は、手で書いた文字列では再現したつもりになりやすい)。そこで一時ディレクトリに
 * 使い捨ての git リポジトリを作り、**4 形(変更 / 削除 / 追加 / 改名)を実際に git に作らせて**
 * 読む。リポジトリ本体では git の書き込み系を一切使わない。
 */

import { mkdtempSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatViolations,
  frozenViolations,
  parseNameStatus,
} from '../../../lib/gates/migration-immutability.js';
import { isolatedGit } from '../../helpers/git-env.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** 使い捨てリポジトリの置き場(テストごとに作り直す)。 */
let repo = '';

/** 使い捨てリポジトリで git を回す(フックも署名も無効にして環境に依存させない)。 */
function git(...args: string[]): string {
  return isolatedGit(repo, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args]);
}

/** 使い捨てリポジトリ内のファイルを書く(親ディレクトリは作る)。 */
function write(relative: string, body: string): void {
  const absolute = path.join(repo, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, 'utf-8');
}

/** ステージ(= pre-commit が見る位置)の name-status を取る。 */
function stagedNameStatus(): string {
  return git('diff', '--cached', '--name-status', '-M', '-z', 'HEAD', '--', 'supabase/migrations');
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'migration-gate-'));
  git('init', '--quiet', '-b', 'main');
  write('supabase/migrations/20260101000001_first.sql', 'create table t (id uuid primary key);\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'first');
});

afterEach(() => {
  if (repo !== '') rmSync(repo, { recursive: true, force: true });
  repo = '';
});

describe('適用済み migration の不変性(4 形)', () => {
  it('変更(コメントだけの修正も含む)は「変更」として赤', () => {
    write('supabase/migrations/20260101000001_first.sql', 'create table t (id uuid primary key); -- 追記\n');
    git('add', '.');

    const violations = frozenViolations(parseNameStatus(stagedNameStatus()), TEST_ROOTS);

    expect(violations).toEqual([{ file: 'supabase/migrations/20260101000001_first.sql', kind: '変更' }]);
  });

  it('削除は「削除」として赤', () => {
    unlinkSync(path.join(repo, 'supabase/migrations/20260101000001_first.sql'));
    git('add', '-A');

    const violations = frozenViolations(parseNameStatus(stagedNameStatus()), TEST_ROOTS);

    expect(violations).toEqual([{ file: 'supabase/migrations/20260101000001_first.sql', kind: '削除' }]);
  });

  it('追加(新しい番号のファイルに書く)は通る —— これが反例の形である', () => {
    write('supabase/migrations/20260101000002_second.sql', 'alter table t add column name text;\n');
    git('add', '.');

    expect(frozenViolations(parseNameStatus(stagedNameStatus()), TEST_ROOTS)).toEqual([]);
  });

  it('改名は「改名」として赤(改名先も示す)', () => {
    renameSync(
      path.join(repo, 'supabase/migrations/20260101000001_first.sql'),
      path.join(repo, 'supabase/migrations/20260101000003_renamed.sql'),
    );
    git('add', '-A');

    const violations = frozenViolations(parseNameStatus(stagedNameStatus()), TEST_ROOTS);

    expect(violations).toEqual([
      {
        file: 'supabase/migrations/20260101000001_first.sql',
        kind: '改名',
        renamedTo: 'supabase/migrations/20260101000003_renamed.sql',
      },
    ]);
  });

  it('未コミットのファイルは基点に無いので何度書き直しても通る(コミット前は自由)', () => {
    write('supabase/migrations/20260101000004_wip.sql', 'select 1;\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'wip');
    // ここから「コミット済み」になるので、同じファイルを触ると赤になる。
    write('supabase/migrations/20260101000004_wip.sql', 'select 2;\n');
    git('add', '.');

    expect(frozenViolations(parseNameStatus(stagedNameStatus()), TEST_ROOTS)).toHaveLength(1);
  });

  it('コミット間(CI の基点)でも同じ判定になる', () => {
    write('supabase/migrations/20260101000001_first.sql', 'create table t (id uuid primary key); -- 追記\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'rewrite');
    const raw = git('diff', '--name-status', '-M', '-z', 'HEAD~1...HEAD', '--', 'supabase/migrations');

    expect(frozenViolations(parseNameStatus(raw), TEST_ROOTS)).toEqual([
      { file: 'supabase/migrations/20260101000001_first.sql', kind: '変更' },
    ]);
  });
});

describe('検査対象の絞り込み', () => {
  it('supabase/migrations 以外の変更・削除は見ない', () => {
    const changes = parseNameStatus(['M', 'app/src/domain/x.ts', 'D', 'docs/specs/backend/jobs.md', ''].join('\0'));

    expect(frozenViolations(changes, TEST_ROOTS)).toEqual([]);
  });

  it('migrations 配下でも .sql 以外は見ない(README 等)', () => {
    const changes = parseNameStatus(['M', 'supabase/migrations/README.md', ''].join('\0'));

    expect(frozenViolations(changes, TEST_ROOTS)).toEqual([]);
  });

  it('複製(C)は旧ファイルが残るので通す', () => {
    const changes = parseNameStatus(
      ['C100', 'supabase/migrations/20260101000001_a.sql', 'supabase/migrations/20260101000009_b.sql', ''].join('\0'),
    );

    expect(frozenViolations(changes, TEST_ROOTS)).toEqual([]);
  });
});

describe('報告文', () => {
  it('違反が無ければ 1 行も出さない', () => {
    expect(formatViolations([], 'HEAD')).toEqual([]);
  });

  it('基点・破り方・直し方(新しい番号のファイルに書く)を示す', () => {
    const lines = formatViolations([{ file: 'supabase/migrations/20260101000001_a.sql', kind: '変更' }], 'abc1234');
    const text = lines.join('\n');

    expect(text).toContain('abc1234');
    expect(text).toContain('[変更] supabase/migrations/20260101000001_a.sql');
    expect(text).toContain('新しい番号の migration に書く');
    expect(text).toContain('migrations.md');
  });
});
