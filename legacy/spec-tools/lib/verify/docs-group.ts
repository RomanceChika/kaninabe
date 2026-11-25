/**
 * 文書整合検証(M 群)の配線(lib/compose/verify-pipeline.ts が呼ぶ)。
 *
 * 走査ルートの導出と実行状況の報告だけを持つ。責務は pipeline の他の run* ヘルパーと同じ「入力の読み込み位置と報告の文言」だけである。
 */

import path from 'node:path';
import type { Finding } from '../kernel/finding.js';
import type { ProgressLog } from './group-contract.js';
import { runDocsVerification } from '../docs/run.js';
import { LINKED_ROOT_FILES } from '../model/docs/link-scan.js';
import { detectRepoRoot, FRAMEWORK_DOCS_DIR, FRAMEWORK_RULES_DIR } from '../io/paths.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * 文書整合検証(M 群)を実行し、実行状況を一行で残す。
 *
 * **走査ルートは 2 つの出どころから来る。** 仕様の木とドメイン知識は**製品の宣言**から、
 * 規約の木とサイトルートは**仕組み自身の住所**(`lib/io/paths.ts` の定数)からである。
 * 規約の木を「仕様の木の親の `rules`」として導いてはならない —— 仕様の木を `spec/` に置いた
 * 製品で規約が `{repo}/rules` になり、**M 群が黙って消える**(独立レビューの指摘)。
 *
 * rules / specs のどちらのツリーも無い環境では検証をスキップし、その旨を報告して壊れないように
 * する(knowledge はディレクトリごと無くてよい任意の走査ルート)。
 */
export function runDocs(domainRoot: string, roots: ProductRoots, log: ProgressLog): Finding[] {
  const repoRoot = detectRepoRoot(domainRoot);
  const knowledge = roots.knowledge;
  const result = runDocsVerification({
    rulesRoot: path.join(repoRoot, FRAMEWORK_RULES_DIR),
    specsRoot: path.join(repoRoot, roots.specs),
    ...(knowledge === null ? {} : { knowledgeRoot: path.join(repoRoot, knowledge) }),
    docsRoot: path.join(repoRoot, FRAMEWORK_DOCS_DIR),
    linkedRootFiles: LINKED_ROOT_FILES,
    repoRoot,
    roots,
  });

  if (!result.available) {
    // **報告する綴りも宣言から組む。** P1 が「根の不在は各群のスコープ行が宣言する」を根拠に
    // 警告を出さない設計なので、その宣言が嘘だと根拠ごと崩れる。
    log(`M 群(文書整合): ${FRAMEWORK_RULES_DIR} も ${roots.specs} も無いためスキップしました。`);
    return result.findings;
  }
  const rulesCount = result.docCount - result.specsDocCount - result.knowledgeDocCount;
  log(
    `M 群(文書整合): ${result.docCount} 文書(rules ${rulesCount} / specs ${result.specsDocCount} / ` +
      `knowledge ${result.knowledgeDocCount})を検査しました。リンクの実在は ${result.linkedFileCount} ファイル(CLAUDE.md + docs/ の下の全部の .md)を見ました。`,
  );
  for (const root of emptyRoots(rulesCount, result.specsDocCount, roots)) {
    log(`M 群(文書整合): ${root} から文書を 1 件も読めませんでした(M0 の警告を参照)。`);
  }
  return result.findings;
}

/** 1 件も読めなかった走査ルートの名前。走査範囲の後退を出力の目立つ位置に出すために使う。 */
function emptyRoots(rulesCount: number, specsCount: number, roots: ProductRoots): string[] {
  const empty: string[] = [];
  if (rulesCount === 0) empty.push(FRAMEWORK_RULES_DIR);
  if (specsCount === 0) empty.push(roots.specs);
  return empty;
}
