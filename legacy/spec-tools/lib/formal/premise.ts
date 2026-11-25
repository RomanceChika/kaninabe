/**
 * 模型の前提の検査の**段取り**(どのファイルの何を読むか)。
 *
 * 判定そのものは `runtime-constants.ts` の純粋関数が持ち、ここはファイルの居場所だけを
 * 知っている —— 居場所が動いたらここ 1 か所を直す。
 */

import { describePremise, premiseFindings, readRuntimeConstants } from './runtime-constants.js';
import type { RuntimeConstantSources } from './runtime-constants.js';
import type { FormalFinding } from './types.js';
import { latestDefinition } from './migration-function.js';
import type { MigrationFile } from './migration-function.js';
import { generatedPath, migrationPath } from '../model/product/paths.js';
import { httpEntryPath } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/** 1 回の起動の予算を持つ起動口(ジョブの runner)の URL。 */
const RUNNER_ENDPOINT = '/api/jobs/run';

/** リースの既定を持つ DB の関数(`SOURCE-FN:` と同じく、**関数名**で最新の migration へ解決する)。 */
const LEASE_FUNCTION = 'claim_due_jobs';

/**
 * 3 つの実装値の居場所(リポジトリルート相対)。
 *
 * 置き場は製品の宣言から組み立てる。リースの既定は migration のファイル名を綴らず、**その関数を定義する
 * 最新番号の migration**へ解決する(`SOURCE-FN:` と同じ解決。直したら解決先が動く)。実装の木を持たない製品・配置が起動口を決められない構成・
 * 関数を定義する migration が無い製品では前提を読めないので **null**(空のパスを黙って返さない)になり、premise の検査は「読めなかった」と、決められなかった居場所を名指す。
 *
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置(起動口の位置を引く。アプリの枠の後段が与える)
 * @param migrations 読み込んだ migration の並び(リースの解決に使う)
 */
export function premiseFiles(
  roots: ProductRoots,
  layout: ProductLayout,
  migrations: readonly MigrationFile[],
): {
  readonly budget: string | null;
  readonly timeout: string;
  readonly lease: string | null;
} {
  return {
    /** 1 回の起動が使ってよい時間。 */
    budget: httpEntryPath(layout, roots, RUNNER_ENDPOINT),
    /** 外部呼び出しのタイムアウト(連携カタログの生成物。最大を取る)。 */
    timeout: generatedPath(roots, 'external-expectations.ts'),
    /** リースの既定。 */
    lease: leaseFile(roots, migrations),
  };
}

/** リースの既定を持つ migration の置き場所(関数を定義する最新番号のもの。無ければ null)。 */
function leaseFile(roots: ProductRoots, migrations: readonly MigrationFile[]): string | null {
  const name = latestDefinition(migrations, LEASE_FUNCTION);
  return name === null ? null : migrationPath(roots, name);
}

/** 前提の検査の結果。 */
export interface PremiseOutcome {
  readonly findings: readonly FormalFinding[];
  /** 進捗行(何を確かめたか・なぜ飛ばしたか)。 */
  readonly notes: readonly string[];
}

/**
 * 実装の 3 定数を読んで比を確かめる。
 *
 * `app/` が無い構成(docs だけを取り出した環境)では読む相手が無いので、
 * **飛ばしたことを報告して**通す —— 黙って通すと、読めなかった実行と確かめた実行が
 * 見分けのつかない形になる(K1 が app/ 不在で env 参照検査を飛ばすときと同じ扱い)。
 *
 * @param repoRoot リポジトリルート(未使用だが、居場所の解決を呼ぶ側に預けないための引数)
 * @param read リポジトリルート相対のパスを読む関数(読めなければ null)
 * @param roots 製品が宣言した根(3 つの居場所を組み立てる)
 * @param layout 置き場の配置(起動口の居場所を引く。アプリの枠の後段が与える)
 * @param migrations 読み込んだ migration の並び(リースの既定の居場所の解決に使う)
 * @returns Finding と進捗行
 */
export function premiseCheck(
  repoRoot: string,
  read: (file: string) => string | null,
  roots: ProductRoots,
  layout: ProductLayout,
  migrations: readonly MigrationFile[],
): PremiseOutcome {
  void repoRoot;
  const files = premiseFiles(roots, layout, migrations);
  // 居場所が決まらなかった(null)ものは読みに行かない(空のパスはリポジトリルートそのものを指す)。
  const readAt = (file: string | null): string | null => (file === null ? null : read(file));
  const budgetText = readAt(files.budget);
  const timeoutText = readAt(files.timeout);
  const leaseText = readAt(files.lease);
  if (files.budget === null || files.lease === null || budgetText === null || timeoutText === null || leaseText === null) {
    const missing = [
      files.budget ?? 'budget(居場所を決められない: 置き場の配置が起動口 http-entry を決められない・実装の木が無い)',
      files.timeout,
      files.lease ?? 'lease(居場所を決められない: 関数を定義する migration が無い)',
    ].filter((_, index) => [budgetText, timeoutText, leaseText][index] === null);
    return {
      findings: [],
      notes: [`  Outbox の前提: 読む相手がいないので確かめていません(${missing.join(' / ')})`],
    };
  }
  const sources: RuntimeConstantSources = {
    budget: { path: files.budget, text: budgetText },
    timeout: { path: files.timeout, text: timeoutText },
    lease: { path: files.lease, text: leaseText },
  };
  const constants = readRuntimeConstants(sources);
  if ('severity' in constants) return { findings: [constants], notes: [] };
  return { findings: premiseFindings(constants, sources), notes: [describePremise(constants)] };
}
