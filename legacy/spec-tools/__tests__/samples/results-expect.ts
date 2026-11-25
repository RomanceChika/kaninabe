/**
 * 4 題材の通し実行が**結果表**(束 ⑳-5b)について確かめること。
 *
 * 題材ごとに書くのは 1 行(`expectResultTables(run)`)だけにする —— 確かめる中身は題材に依らず
 * 同じであり、題材ごとに書き分けると「どの題材で何を見ていないか」が読めなくなる。
 *
 * 見るのは 4 つである。
 *   1. **元データが出ている**(`docs/book/assets/results/*.json`)。中の組み合わせの数が、
 *      設計図が宣言した直積の大きさ(`count`)と一致する —— 表とテストが別の列挙から出ない
 *   2. **人が読む表が出ている**(操作の章の折り畳み)。代表のマス(✅ / 番号つきの ❌)がある
 *   3. world を宣言から作れない集約・保存点は**理由を報告する**(T11 と同じ構え)
 *   4. **表が横に広がりすぎない**(`READABLE_COLUMNS`)—— 結末が同じ列をまとめても超えるなら、
 *      それは「畳み方の穴」であり、読み手が横スクロールで読む表になっている(束 ⑳-5b-b)
 */

import { expect } from 'vitest';
import { RESULT_ALLOWED, RESULT_WORDS } from '../../lib/messages/messages-results.js';
import { resultsDir } from '../../lib/generate/render/book/results-section.js';
import { READABLE_COLUMNS } from '../../lib/results/table.js';
import type { SampleRun } from './harness.js';

/** 操作の章(結果表が畳まれる場所)。 */
const ACTIONS_PAGE = 'docs/book/actions.html';

/** タスクの章(保存点の結果表が畳まれる場所)。 */
const USECASES_PAGE = 'docs/book/usecases.html';

/** 元データの 1 ファイル(単発の操作か保存点)。 */
interface ResultsFile {
  readonly operations?: readonly { readonly op: string; readonly count: number; readonly cases: readonly unknown[] }[];
  readonly saves?: readonly { readonly key: string; readonly count: number; readonly cases: readonly unknown[] }[];
}

/**
 * その題材で結果表が生成されていることを確かめる。
 *
 * @param run 通し実行の結果
 */
export function expectResultTables(run: SampleRun): void {
  const files = [...run.generatedFiles.keys()].filter(
    (file) => file.startsWith(`${resultsDir(run.roots)}/`) && file.endsWith('.json'),
  );
  expect(files.length, '結果表の元データが 1 つも生成されていない').toBeGreaterThan(0);
  let total = 0;
  for (const file of files) {
    const parsed = JSON.parse(run.generatedFiles.get(file) ?? '{}') as ResultsFile;
    for (const operation of parsed.operations ?? []) {
      expect(operation.cases.length, `${operation.op} の組み合わせの数`).toBe(operation.count);
      total += operation.cases.length;
    }
    for (const save of parsed.saves ?? []) {
      expect(save.cases.length, `${save.key} の組み合わせの数`).toBe(save.count);
      total += save.cases.length;
    }
  }
  expect(total, '結果表に組み合わせが 1 つも無い').toBeGreaterThan(0);
  const page = run.generatedFiles.get(ACTIONS_PAGE) ?? '';
  expect(page).toContain('の結果表(全');
  expect(page).toContain(RESULT_ALLOWED);
  expect(page).toContain(RESULT_WORDS.actorHeader);
  expect(expectReadableWidth(run, ACTIONS_PAGE), '操作の章に結果表の見出しが 1 本も無い').toBeGreaterThan(0);
  expectReadableWidth(run, USECASES_PAGE);
}

/**
 * 結果表の見出し行が `READABLE_COLUMNS` を超えないことを確かめる。
 *
 * @param run 通し実行の結果
 * @param page 表が載るページ
 * @returns 見た結果表の本数
 */
function expectReadableWidth(run: SampleRun, page: string): number {
  const heads = (run.generatedFiles.get(page) ?? '').matchAll(/<thead><tr>(<th scope="col">.*?)<\/tr><\/thead>/gs);
  let seen = 0;
  for (const head of heads) {
    const cells = head[1] ?? '';
    if (!cells.startsWith(`<th scope="col">${RESULT_WORDS.actorHeader}</th>`)) continue;
    seen += 1;
    const columns = cells.split('<th ').length - 1;
    expect(columns, `${page} の結果表が ${String(READABLE_COLUMNS)} 列を超える: ${cells}`).toBeLessThanOrEqual(READABLE_COLUMNS);
  }
  return seen;
}

/**
 * world を宣言から作れない集約・保存点が、表の代わりに理由を報告していることを確かめる。
 *
 * @param run 通し実行の結果
 * @param page 理由が出るページ(操作の章 / タスクの章)
 */
export function expectNoProofNoted(run: SampleRun, page: string): void {
  const content = run.generatedFiles.get(page) ?? '';
  expect(content, `${page} に「一致の証明が無い」の行が無い`).toContain(RESULT_WORDS.noProof(''));
}

/**
 * そのページの**全部**が結果表を持っていることを確かめる(理由の行に落ちたものが 1 つも無い)。
 *
 * 「表がある」だけでは足りない —— 一部が表を持ち、残りが理由の行に落ちていても通ってしまう。
 * 理由の行が**1 本も無い**ことを併せて主張して、はじめて「全部が実行できた」の記録になる。
 *
 * @param run 通し実行の結果
 * @param page 表が出るページ(操作の章 / タスクの章)
 */
export function expectAllProved(run: SampleRun, page: string): void {
  const content = run.generatedFiles.get(page) ?? '';
  // 見出しの綴りは章の描き方で 2 つある: 操作の章は折りたたみの題が「… の結果表(全 N 通り)」、
  // タスクの章は題が「… の結果表」で本数は隣の欄(`bf-fold-n`)に「全 N 通り」。どちらでも「表が出ている」と読む。
  expect(content, `${page} に結果表が 1 つも無い`).toMatch(/の結果表(?:\(全 |<\/span><span class="bf-fold-n">全 )/);
  expect(content, `${page} に「一致の証明が無い」の行が残っている`).not.toContain(RESULT_WORDS.noProof(''));
}
