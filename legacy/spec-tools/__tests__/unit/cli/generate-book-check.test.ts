/**
 * ハンドブックだけを出す本物の CLI(`cli/generate-book.ts`)の `--check`(入口の出力が全部入りの `generate` の生成物と、検証・変異に依る部分を除いて
 * バイト同一か)を、別プロセスで見る。
 *
 *   1. **合格** — 全部入りの `generate` を回した題材の写しで、`--check` は 0 で終わる(同一と、検証・変異に依る部分だけ違う章)。**何も書かない**(題材の木は 1 バイトも変わらない)。
 *      実装の木(`app`)を宣言する製品でも `--out` は要らない(書かないので書き先を決めない)
 *   2. **不合格** — 切り出した後にも違いがある章は食い違いとして名指し、全部入りの生成物に無い章は「比べる相手が無い」と名指して、1 で終わる
 *   3. **阻害の注意** — 阻害した種類があるときは、読めた分だけの章を比べていることを先頭で言う
 *
 * 使い捨ての製品の写しに対して実行する(題材の fixture は触らない)。全部入りの `generate` の実行を含むので、起動は 5 回に絞る。
 */

import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliRun } from '../../helpers/run-tool-cli.js';
import { cleanupTemps, cliPath, copiedSample, editFile, fingerprintOf, read, runBook, SLOW } from '../../helpers/book-entry-fixture.js';
import { runToolCli, TOOL_TREE } from '../../helpers/run-tool-cli.js';

afterAll(cleanupTemps);

/** 比べる章(全部入りの `generate` が書く)。 */
const CHAPTER = 'docs/book/screens.html';
const README = 'docs/book/index.html';

describe('--check: 入口の出力と全部入りの生成物の比較', () => {
  let root: string;
  let before: ReadonlyMap<string, string>;
  let ok: CliRun;
  let bad: CliRun;
  let blocked: CliRun;

  beforeAll(() => {
    root = copiedSample('check');
    // 全部入りの generate を 2 回回す: 1 回目が書く生成テストを 2 回目の「テストの件数」が数えるので、2 回目で出力が落ち着く(コミット済みの木と同じ状態)。
    for (const round of [1, 2]) {
      const full = runToolCli(cliPath('generate-docs.ts'), TOOL_TREE, ['--root', root]);
      if (full.status !== 0) throw new Error(`全部入りの generate が失敗(${round} 回目): ${full.stderr}`);
    }
    before = fingerprintOf(root);
    ok = runBook(root, '--check');
    const afterOk = fingerprintOf(root);
    if (afterOk.size !== before.size) throw new Error('--check が木を書き換えた');

    // 切り出した後にも違う章と、全部入りの生成物に無い章。違いは 2 か所: 検証に依らない段落を 1 つ足す + 目次の画面の数(検証に依らない)を 1 つ増やす
    // (検証に依る要素 = `data-dep="verify"` は丸ごと切り出すので、その中の差は食い違いに数えない。依らない側の差だけが残る)。
    editFile(root, CHAPTER, (text) => `${text.replace(/<span>画面\((\d+)\)<\/span>/, (_whole, count: string) => `<span>画面(${Number(count) + 1})</span>`).replace('</main>', '<p>検証と関係の無い 1 行</p></main>')}`);
    rmSync(path.join(root, README));
    bad = runBook(root, '--check');

    // 阻害した種類(壊れた jobs.md)があるときの注意。比べる相手が無い章が多いので不合格だが、先頭の注意を見る。
    writeFileSync(path.join(root, 'docs/specs/backend/jobs.md'), 'frontmatter が無い\n');
    blocked = runBook(root, '--check');
  }, SLOW);

  it('合格: 0 で終わり、同一の章と検証・変異に依る部分だけ違う章を数える。何も書かず、実装の木を宣言する製品でも --out は要らない', () => {
    expect(ok.status).toBe(0);
    expect(ok.stderr.trim()).toBe('');
    expect(ok.stdout).toMatch(/入口の出力と全部入りの生成物の比較: \d+ 本\(同一 \d+ \/ 検証・変異に依る部分だけ違う [1-9]\d* \/ 食い違い 0 \/ 比べる相手が無い 0\)/);
    expect(ok.stdout).not.toContain('生成:');
    // 切り出した断片の数を、断片のある章ごとに言う(行ごと捨てた量が見えるように)。
    expect(ok.stdout).toMatch(/切り出した断片: docs\/book\/[^\n]+\(入口 \d+ \/ 全部入り \d+\)/);
    expect(fingerprintOf(root).size, '章の追加・削除が無い').toBeGreaterThan(0);
  });

  it('不合格: 切り出した後にも違う章は食い違いとして名指し(入口と全部入りの行つき)、全部入りの生成物に無い章は「比べる相手が無い」と名指して、1 で終わる', () => {
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain(`食い違い: ${CHAPTER}(検証・変異に依る部分を除いても 1 バイト違う塊 2 件)`);
    expect(bad.stdout).toContain(`食い違い: ${CHAPTER}(検証・変異に依る部分を除いても 1 バイト違う塊`);
    expect(bad.stdout).toContain('全部 | <p>検証と関係の無い 1 行</p>');
    expect(bad.stdout).toContain(`比べる相手が無い: ${README}(全部入りの生成物にこの章が無い。`);
    expect(bad.stdout).toMatch(/食い違い 1 \/ 比べる相手が無い 1\)/);
  });

  it('阻害した種類があるときは、読めた分だけの章を比べていることを先頭で言う', () => {
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain('注意: 阻害した種類(jobs)があるので、読めた分だけの章を全部入りと比べている');
  });

  it('入口の通常の実行(--check なし)は、実装の木を宣言する製品に --out が無ければ従来どおり書かずに止まる(--check だけが書き先を要らない)', () => {
    const refused = runBook(root);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('--out');
    expect(read(root, CHAPTER)).toContain('検証と関係の無い 1 行');
  });
});
