/**
 * C23 の基点の決め方(`lib/gates/migration-diff.ts`)のテスト。
 *
 * ここで見るのは判定ではなく**結末の分かれ方**である —— 「検査対象が無い(通す)」と
 * 「git が答えなかった(赤)」を型で分けたのがこの層の役目で、畳むと
 * **無出力・exit 0 で黙って通る**(束 ㉒ の独立レビュー 1-A が `--head 存在しない ref` で
 * 実測した穴)。本番 DB に触る直前の関門なので、3 経路
 * (正常 / 存在しない ref / 壊れた git 環境)を実際に踏む。
 *
 * git は注入される口(`GitRunner`)なので、**使い捨てリポジトリに向けた本物の git** を
 * 渡す(偽の git を書くと「本当に git がそう答えるか」を確かめたことにならない)。
 * リポジトリ本体では git の書き込み系を一切使わない。
 */

import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitRunner } from '../../../lib/gates/migration-diff.js';
import { diffSourceOf, rangeDiff, stagedDiff } from '../../../lib/gates/migration-diff.js';
import { frozenViolations, parseNameStatus } from '../../../lib/gates/migration-immutability.js';
import { isolatedGit, spawnIsolatedGit } from '../../helpers/git-env.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** 使い捨てリポジトリの置き場(テストごとに作り直す)。 */
let repo = '';

/** 環境に依存させないための git 設定(フック・署名・作者)。 */
const GIT_CONFIG = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'user.email=t@example.com',
  '-c',
  'user.name=t',
];

/** 使い捨てリポジトリで git を回す(テストの準備用。失敗したら例外)。 */
function git(...args: string[]): string {
  return isolatedGit(repo, [...GIT_CONFIG, ...args]);
}

/** 本番の CLI と同じ形の git ランナー(cwd だけ使い捨てリポジトリに向ける)。 */
const runner: GitRunner = (args) => {
  const result = spawnIsolatedGit(repo, [...GIT_CONFIG, ...args]);
  if (result.status === 0) return { ok: true, stdout: result.stdout };
  return { ok: false, reason: result.stderr.trim() === '' ? String(result.error ?? result.status) : result.stderr.trim() };
};

/** 使い捨てリポジトリ内のファイルを書く(親ディレクトリは作る)。 */
function write(relative: string, body: string): void {
  const absolute = path.join(repo, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, 'utf-8');
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'migration-diff-'));
  git('init', '--quiet', '-b', 'main');
});

afterEach(() => {
  if (repo !== '') rmSync(repo, { recursive: true, force: true });
  repo = '';
});

/** 1 コミット積む(基点になる歴史を作る)。 */
function commitFirst(): void {
  write('supabase/migrations/20260101000001_first.sql', 'create table t (id uuid primary key);\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'first');
}

describe('正常な経路', () => {
  it('コミット間: 基点が実在すれば diff を返し、判定まで届く', () => {
    commitFirst();
    write('supabase/migrations/20260101000001_first.sql', 'create table t (id uuid primary key); -- 追記\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'rewrite');

    const source = rangeDiff(runner, 'HEAD~1', 'HEAD', TEST_ROOTS);

    expect(source.kind).toBe('diff');
    if (source.kind !== 'diff') return;
    expect(source.base).toBe('HEAD~1');
    expect(source.notes).toEqual([]);
    expect(frozenViolations(parseNameStatus(source.raw), TEST_ROOTS)).toEqual([
      { file: 'supabase/migrations/20260101000001_first.sql', kind: '変更' },
    ]);
  });

  it('ステージ: 基点 HEAD の diff を返す', () => {
    commitFirst();
    write('supabase/migrations/20260101000001_first.sql', 'create table t (id uuid primary key); -- 追記\n');
    git('add', '.');

    const source = stagedDiff(runner, TEST_ROOTS);

    expect(source.kind).toBe('diff');
    if (source.kind !== 'diff') return;
    expect(source.base).toBe('HEAD');
    expect(frozenViolations(parseNameStatus(source.raw), TEST_ROOTS)).toHaveLength(1);
  });

  it('コミット間: migration を触っていなければ diff は空(違反 0 件)', () => {
    commitFirst();
    write('docs/handoff/runbook.md', '# runbook\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'docs only');

    const source = rangeDiff(runner, 'HEAD~1', 'HEAD', TEST_ROOTS);

    expect(source.kind).toBe('diff');
    if (source.kind !== 'diff') return;
    expect(frozenViolations(parseNameStatus(source.raw), TEST_ROOTS)).toEqual([]);
  });
});

describe('存在しない ref', () => {
  it('比較先が存在しなければ unavailable(= 赤。黙って通さない)', () => {
    commitFirst();
    git('commit', '--quiet', '--allow-empty', '-m', 'second');

    const source = rangeDiff(runner, 'HEAD~1', 'nosuchref', TEST_ROOTS);

    expect(source.kind).toBe('unavailable');
    if (source.kind !== 'unavailable') return;
    expect(source.reason).toContain('git diff が失敗しました');
    expect(source.reason).toContain('HEAD~1');
  });

  it('負例 A6-1・A6-4: 基点が存在しなければ HEAD~1 に倒さずに unavailable(= 赤)', () => {
    commitFirst();
    git('commit', '--quiet', '--allow-empty', '-m', 'second');

    const source = rangeDiff(runner, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'HEAD', TEST_ROOTS);

    expect(source.kind).toBe('unavailable');
    expect(source.kind === 'unavailable' ? source.reason : '').toContain('deadbeef');
  });

  it('負例 A6-1・A6-4: 基点の欠落・空文字・40 桁ゼロも HEAD~1 に切り替えず unavailable、未指定は「(未指定)」と名指す', () => {
    commitFirst();
    git('commit', '--quiet', '--allow-empty', '-m', 'second');

    for (const base of [undefined, '', '0'.repeat(40)]) {
      const source = rangeDiff(runner, base, 'HEAD', TEST_ROOTS);
      expect(source.kind).toBe('unavailable');
      expect(source.kind === 'unavailable' ? source.reason : '').toContain('倒しません');
    }
    const unspecified = rangeDiff(runner, undefined, 'HEAD', TEST_ROOTS);
    expect(unspecified.kind === 'unavailable' ? unspecified.reason : '').toContain('(未指定)');
  });
});

describe('CLI の口(diffSourceOf。基点は呼び手が渡す)', () => {
  it('負例 A6-1: --staged も --base も無い呼び出し(目録の以前の merge-check の形)は unavailable(= 赤)', () => {
    commitFirst();
    git('commit', '--quiet', '--allow-empty', '-m', 'second');

    for (const args of [[], ['--base'], ['--base', '--head', 'HEAD'], ['--base', 'HEAD~1', '--head']]) {
      expect(diffSourceOf(args, runner, TEST_ROOTS).kind, JSON.stringify(args)).toBe('unavailable');
    }
  });

  it('負例 mig-probe: pre-commit を通らないコミットで適用済みの migration を書き換え、台帳のコミットを続けても、分岐点を渡せば違反 1 件', () => {
    commitFirst();
    const branchPoint = git('rev-parse', 'HEAD').trim();
    // 置き場の綴りを試験に増やさない: 適用済みの 1 本は版の一覧から読む(commitFirst が置いた唯一のファイル)。
    const [applied = ''] = git('ls-files').trim().split('\n');
    write(applied, 'create table t (id uuid primary key);\nselect 2;\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'A: 適用済みを書き換える(core.hooksPath=/dev/null = pre-commit を通らない)');
    write('ledger.txt', 'x\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'B: 台帳の代わりのコミット(migration に触れない)');

    const source = diffSourceOf(['--base', branchPoint, '--head', 'HEAD'], runner, TEST_ROOTS);
    expect(source.kind).toBe('diff');
    expect(source.kind === 'diff' ? frozenViolations(parseNameStatus(source.raw), TEST_ROOTS) : []).toHaveLength(1);
    expect(diffSourceOf([], runner, TEST_ROOTS).kind).toBe('unavailable');
  });

  it('--staged はステージ・--base は既定の先端 HEAD', () => {
    commitFirst();
    git('commit', '--quiet', '--allow-empty', '-m', 'second');
    expect(diffSourceOf(['--staged'], runner, TEST_ROOTS).kind).toBe('diff');
    const range = diffSourceOf(['--base', 'HEAD~1'], runner, TEST_ROOTS);
    expect(range.kind === 'diff' ? range.base : '').toBe('HEAD~1');
  });
});

describe('検査対象が無い経路(通すが声は出す)', () => {
  it('負例: 歴史が 1 コミットだけで基点の無い呼び出しも skip にせず unavailable(以前は「比較できる歴史がありません」で通した)', () => {
    commitFirst();

    expect(rangeDiff(runner, undefined, 'HEAD', TEST_ROOTS).kind).toBe('unavailable');
  });

  it('HEAD が無い(最初のコミット)なら --staged は skip', () => {
    write('supabase/migrations/20260101000001_first.sql', 'select 1;\n');
    git('add', '.');

    const source = stagedDiff(runner, TEST_ROOTS);

    expect(source.kind).toBe('skip');
    if (source.kind !== 'skip') return;
    expect(source.notes.join('\n')).toContain('HEAD がありません');
  });
});

describe('壊れた git 環境', () => {
  it('リポジトリが読めなければ unavailable —— 「歴史が無い」になって黙って通ることはない', () => {
    commitFirst();
    renameSync(path.join(repo, '.git'), path.join(repo, '.git-moved'));

    const range = rangeDiff(runner, 'HEAD~1', 'HEAD', TEST_ROOTS);
    const staged = stagedDiff(runner, TEST_ROOTS);

    expect(range.kind).toBe('unavailable');
    expect(staged.kind).toBe('unavailable');
    expect(range.kind === 'unavailable' ? range.reason : '').toContain('git が答えませんでした');
  });
});
