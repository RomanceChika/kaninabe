/**
 * 題材の表(`sample-coverage.ts`)の n/a の条件の材料を、題材の仕様から読む(fix27 A2・差分点検 D27-1)。照らしは sample-coverage-check.ts。
 */

import path from 'node:path';
import { PRODUCT_DECL_FILE } from '../../../io/paths.js';
import { availableLoad, catalogInput, type CatalogLoad } from '../../../kernel/input-state.js';
import { loadDataTableSpecModel } from '../../../model/data/loader.js';
import { loadExternalSpecModel } from '../../../model/external/loader.js';
import { loadJobSpecModel } from '../../../model/job/loader.js';
import { loadProductRoots } from '../../../model/product/loader.js';
import type { ProductRoots } from '../../../model/product/types.js';
import { selectionOf, type ProductUses, type SpecKind } from '../../../model/product/uses.js';
import type { NaFacts } from './sample-coverage-check.js';

/**
 * 採った種類の読み込みの結果を、読込済みの値にする(採っていなければ null = 事実として無い)。採ったのに無い・読めない・仕様を落としたなら例外
 * (0 件と数えると n/a の条件が黙って成り立つ。差分点検 D27-1)。採ったかは題材の `product.md` の `uses`(ファイルの有無から推定しない)。
 */
function selectedValue<T>(uses: ProductUses, kind: SpecKind, load: CatalogLoad<T>, file: string): T | null {
  const input = catalogInput(selectionOf(uses, kind), load);
  if (input.state === 'unselected') return null;
  if (input.state === 'blocked') throw new Error(`題材の表の n/a の条件の材料を読めません: ${kind}(${file})が ${input.reason}(採った種類が無い・読めないのを 0 件と数えない)`);
  return input.value;
}

/**
 * 題材の表の n/a の条件の材料(有料の連携の数・時刻起点のジョブの数・手書きの本文の数)を、題材の仕様から読む。
 *
 * 採った種類(`product.md` の `uses`)の仕様が無い・読めない・仕様を落としたなら例外(赤)。採っていない種類は 0 件(事実として無い)。
 * 手書きの本文は、`kind: rpc` で `handwritten` を宣言したもの・本文の生成先 `migration` を持たないもの(T6 が後者に `handwritten` を要求する)と、
 * `kind: trigger` で `handwritten` を宣言したもの(本文が手書きの migration にあるトリガ。宣言しないトリガの本文は生成物 = T17)の和(差分点検 D27-1)。
 *
 * @param root 題材の木のルート(一時ツリーでも fixture の置き場でもよい。根に product.md がある)
 * @param roots その題材が宣言した根
 * @returns 条件の材料
 */
export function naFactsOf(root: string, roots: ProductRoots): NaFacts {
  const uses = loadProductRoots(root).uses;
  if (uses === null) throw new Error(`題材の表の n/a の条件の材料を読めません: ${path.join(root, PRODUCT_DECL_FILE)} の uses が無い・読めない`);
  const specs = path.join(root, roots.specs, 'backend');
  const externalFile = path.join(specs, 'external.md');
  const tablesDir = path.join(specs, 'data', 'tables');
  const jobsFile = path.join(specs, 'jobs.md');
  const catalog = selectedValue(uses, 'external', loadExternalSpecModel(externalFile, { repoRoot: root }), externalFile);
  const tablesLoaded = loadDataTableSpecModel(tablesDir, { repoRoot: root });
  const tables = selectedValue(uses, 'data_tables', availableLoad(tablesLoaded.model, tablesLoaded.findings, tablesLoaded.dropped), tablesDir);
  const jobs = selectedValue(uses, 'jobs', loadJobSpecModel(jobsFile, { repoRoot: root }), jobsFile)?.jobs ?? [];
  const functions = (tables?.tables ?? []).flatMap((table) => table.functions);
  return {
    paid: (catalog?.integrations ?? []).filter((integration) => integration.spend === 'paid').length,
    scheduled: jobs.filter((job) => job.source === 'schedule').length,
    handwritten:
      functions.filter((fn) => fn.kind === 'rpc' && (fn.handwritten !== undefined || fn.migration === undefined)).length +
      functions.filter((fn) => fn.kind === 'trigger' && fn.handwritten !== undefined).length,
  };
}
