/**
 * 注釈付きテストブロックの**中身**の判定(assert があるか・母集合が空でも緑にならないか)。
 *
 * 製品の木の注釈は A16、仕組みの根の注釈は Z3 が、**同じ判定**を下すために共有する純関数である(判定を 2 本に書き分けると、
 * 片方だけが緩む)。違いは指摘に付ける検証器 ID だけ。どの種類のモデルも読まない(走査の事実・台帳の外の型・kernel の `Finding` だけ)ので、
 * 種類に属さない `testcase/` に置く(A16 が trace、Z3 が guarantee に居て、種類のディレクトリが互いを読む形にしないため)。
 *
 * 判定の考え方(2 段・ヘルパ呼び出しも assert に数える・読めなかったブロックは黙らずに件数を言う)の説明は A16 の冒頭が正である。
 */

import { makeFinding, type Finding } from '../kernel/finding.js';
import type { TestBlockRef } from './types.js';

/**
 * 注釈付きテストブロックの中身(assert の有無・ループの中だけの assert・切り出せなかったブロック)を判定する純関数。
 *
 * 製品の木の注釈は A16、仕組みの根の注釈は Z3 が、**同じ判定**を下すために共有する(判定を 2 本に書き分けると、
 * 片方だけが緩む)。違いは指摘に付ける検証器 ID だけである。
 *
 * @param blocks 注釈付きテストブロックの事実
 * @param helperNames assert を含むヘルパの名前(許容)
 * @param verifier 指摘に付ける検証器 ID("A16" / "Z3")
 * @returns 違反のリスト
 */
export function assertionFindings(
  blocks: readonly TestBlockRef[],
  helperNames: readonly string[],
  verifier: string,
): Finding[] {
  const helpers = new Set(helperNames);
  return [
    ...blocks.flatMap((block) => checkBlock(block, helpers, verifier)),
    ...unreadableFinding(blocks.filter((block) => !block.readable), verifier),
  ];
}

/** ブロック 1 件を見る。 */
function checkBlock(block: TestBlockRef, helpers: ReadonlySet<string>, verifier: string): Finding[] {
  if (!block.readable) return [];
  const helperCalls = block.calls.filter((call) => helpers.has(call.name));
  const assertions = block.directAssertions + helperCalls.length;
  if (assertions === 0) return [noAssertionFinding(block, verifier)];
  const outside =
    block.directAssertionsOutsideLoop + helperCalls.filter((call) => !call.inLoop).length;
  return outside === 0 ? [loopOnlyFinding(block, verifier)] : [];
}

/** 切り出せなかったブロックの Finding(warning。件数を 1 件にまとめる)。 */
function unreadableFinding(blocks: readonly TestBlockRef[], verifier: string): Finding[] {
  const first = blocks[0];
  if (first === undefined) return [];
  return [
    makeFinding(verifier, {
      severity: 'warning',
      message: `${verifier} が中身を読めなかった注釈が ${blocks.length} 件あります(assert の有無を判定していません)`,
      location: { file: first.file, pointer: `L${first.line}` },
      suggestion:
        '注釈は `it` / `test` の宣言の直前の行に置く(A12 が執行する)。' +
        'それでも読めないなら、テストの書き方が切り出しの下限(波括弧の対応)から外れている',
      counterexample: {
        count: String(blocks.length),
        at: blocks.map((block) => `${block.file}:${block.line}`).join(', '),
      },
    }),
  ];
}

/** assert が 1 つも無いブロックの Finding(error)。 */
function noAssertionFinding(block: TestBlockRef, verifier: string): Finding {
  return makeFinding(verifier, {
    message: `${block.file}:${block.line} の ${block.tcId} は assert を 1 つも持ちません(何も確かめていないテストが「見張りテストあり」と数えられます)`,
    location: { file: block.file, pointer: `L${block.line}` },
    suggestion:
      'そのテストが確かめる事実を `expect(...)` で 1 つ以上主張する' +
      '(assert を含むヘルパを呼ぶ形でもよい)。確かめるものが無いなら、テストと' +
      '対応する test_cases の宣言をどちらも消す',
    counterexample: { file: block.file, line: String(block.line), tc: block.tcId },
  });
}

/** assert がループの中にしか無いブロックの Finding(warning)。 */
function loopOnlyFinding(block: TestBlockRef, verifier: string): Finding {
  return makeFinding(verifier, {
    severity: 'warning',
    message: `${block.file}:${block.line} の ${block.tcId} は assert がループの中にしかありません(母集合が空になった日に黙って緑になります)`,
    location: { file: block.file, pointer: `L${block.line}` },
    suggestion:
      'ループの外に母集合が空でないことの主張を 1 行置く' +
      '(`expect(items).not.toHaveLength(0)` / `expect(items.length).toBeGreaterThan(0)`)。' +
      '母集合が空になりうることが仕様なら、その分岐そのものを確かめるテストに書き換える',
    counterexample: { file: block.file, line: String(block.line), tc: block.tcId },
  });
}
