/**
 * 差分の入口の I/O(`cli/diff-io.ts`)のテスト —— 基点つきの生成(章の「今回変わった」)の配線と、警告の行。
 *
 * `readingBaseFrom` は git から基点側の生成物を読み、公理の側の読みに渡す。見るのは**配線**である:
 * 比較先で読めなかった要素(`headRead`)が計算の例を「消えた」に数えないこと、基点側の壊れた源が
 * 「消えた」「増えた」に化けず読めなかったと報告されること、git が答えないときは判定できないと返すこと。
 * git は**使い捨てリポジトリに向けた本物**を使う(偽の git では配線を確かめたことにならない)。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASE_WITHOUT_VALUE_WARNING, baseWarnings, readingBaseFrom } from '../../../cli/diff-io.js';
import { generatedStatementsPath, generatedSummariesPath } from '../../../lib/diff/axiom-sources.js';
import { isolatedGit } from '../../helpers/git-env.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** 使い捨てリポジトリの置き場(テストごとに作り直す)。 */
let repo = '';

/** 環境に依存させないための git 設定(フック・署名・作者)。 */
const GIT_CONFIG = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.email=t@example.com', '-c', 'user.name=t'];

/** 使い捨てリポジトリで git を回す(テストの準備用。失敗したら例外)。 */
function git(...args: string[]): string {
  return isolatedGit(repo, [...GIT_CONFIG, ...args]);
}

/** 使い捨てリポジトリ内のファイルを書く(親ディレクトリは作る)。 */
function write(relative: string, body: string): void {
  const absolute = path.join(repo, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, 'utf-8');
}

/** 基点にする版を 1 つ積む。 */
function commit(files: Readonly<Record<string, string>>): void {
  for (const [relative, body] of Object.entries(files)) write(relative, body);
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
}

const STATEMENTS = `export const invariantStatements = {\n  'INV-X-001': '数は上限を超えない',\n} as const;\n`;
const EXAMPLES = JSON.stringify({ entity: {}, machine: {}, state: {}, example: { 'line.edit/totalOf/二つ買う': '{"input":{"qty":2}} → 200' } });

/** 比較先(仕様モデルから作った事実の表)。言明は同じ、計算の例は 1 行も無い。 */
const HEAD = new Map([['invariant:INV-X-001', '数は上限を超えない']]);

beforeEach(() => {
  // 調べる側(`readingBaseFrom`)は親の環境のまま git を回す。親の `GIT_` は setupFiles の先頭の止め(`@kaninabe/runtime/testing/git/setup-without-git-env`)が
  // ワーカーの環境から先に全部消すので、ここで外す手は要らない(点検 24 回目 O24-3)。
  repo = mkdtempSync(path.join(tmpdir(), 'diff-io-'));
  git('init', '--quiet', '-b', 'main');
});

afterEach(() => {
  if (repo !== '') rmSync(repo, { recursive: true, force: true });
});

describe('readingBaseFrom — 比較先で読めた要素(headRead)の配線', () => {
  it('action_spec を読めたときは、基点の計算の例が比較先に無ければ「消えた」として差分に出し、報告は空', () => {
    commit({ [generatedStatementsPath(TEST_ROOTS)]: STATEMENTS, [generatedSummariesPath(TEST_ROOTS)]: EXAMPLES });

    const read = readingBaseFrom(repo, TEST_ROOTS, 'HEAD', HEAD, { actions: true });

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.base.ref).toBe('HEAD');
    expect(read.base.changes.map((change) => [change.element, change.kind])).toEqual([['computes.example', 'removed']]);
    expect(read.notRead).toEqual([]);
  });

  it('action_spec を読めなかったときは、計算の例を「消えた」に数えず、比べなかったことを報告する', () => {
    commit({ [generatedStatementsPath(TEST_ROOTS)]: STATEMENTS, [generatedSummariesPath(TEST_ROOTS)]: EXAMPLES });

    const read = readingBaseFrom(repo, TEST_ROOTS, 'HEAD', HEAD, { actions: false });

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.base.changes).toEqual([]);
    expect(read.notRead).toHaveLength(1);
    expect(read.notRead[0]).toContain('計算の例の表は比較先の action_spec を読めなかった');
  });
});

describe('readingBaseFrom — 基点側の壊れた源は「消えた」と数えず、読めなかったと報告する', () => {
  it('invariants.ts がファイルはあるが読めない版を基点にしたら、言明は「増えた」にならず、報告に載る', () => {
    commit({ [generatedStatementsPath(TEST_ROOTS)]: 'export const invariantStatements = {', [generatedSummariesPath(TEST_ROOTS)]: EXAMPLES });

    const read = readingBaseFrom(repo, TEST_ROOTS, 'HEAD', HEAD, { actions: true });

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.base.changes.map((change) => change.element)).toEqual(['computes.example']);
    expect(read.notRead).toHaveLength(1);
    expect(read.notRead[0]).toContain(generatedStatementsPath(TEST_ROOTS));
    expect(read.notRead[0]).toContain('基点で読めなかった');
  });
});

describe('readingBaseFrom — 判定できないときは理由つきで止める', () => {
  it('基点がこのクローンに無ければ、その旨を返す', () => {
    commit({ [generatedStatementsPath(TEST_ROOTS)]: STATEMENTS });

    const read = readingBaseFrom(repo, TEST_ROOTS, 'no-such-ref', HEAD, { actions: true });

    expect(read).toEqual({ ok: false, reason: '基点 no-such-ref がこのクローンにありません' });
  });

  it('git が答えない場所(リポジトリでない)では、答えなかった旨を返す', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'diff-io-nogit-'));
    try {
      const read = readingBaseFrom(outside, TEST_ROOTS, 'HEAD', HEAD, { actions: true });

      expect(read.ok).toBe(false);
      expect(!read.ok && read.reason).toContain('git が答えませんでした');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('基点つきの generate の警告の行', () => {
  it('比べなかったものを先に「警告: 」つきで並べ、最後に基点つきの生成物はコミットしない旨を添える', () => {
    expect(baseWarnings('HEAD~1', ['計算の例は比べていません', '別の源は読めませんでした'])).toEqual([
      '警告: 計算の例は比べていません',
      '警告: 別の源は読めませんでした',
      '警告: 基点 HEAD~1 つきの生成物はコミットしない(基点なしの npm run generate で元に戻る)',
    ]);
  });

  it('比べなかったものが無くても、コミットしない旨は必ず出す', () => {
    expect(baseWarnings('abc123', [])).toEqual(['警告: 基点 abc123 つきの生成物はコミットしない(基点なしの npm run generate で元に戻る)']);
  });

  it('値の無い --base は、今回変わった分を数えない理由を残す', () => {
    expect(BASE_WITHOUT_VALUE_WARNING).toContain('--base に値が無い');
    expect(BASE_WITHOUT_VALUE_WARNING).toContain('今回変わった分は数えません');
  });
});
