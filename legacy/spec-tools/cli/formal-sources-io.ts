/**
 * C24 の鮮度の入口(作業ツリーの読み取り・旧い閉包の git からの復元・`--freshness` の本体)。
 *
 * 何が閉包か・何が食い違いかの判定は `lib/formal/**` の純粋関数にある。ここが持つのは
 * ファイルを読む口と `git` を回す口だけで、`check:formal` の全実行と `--freshness` が同じ口を使う。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { computeClosure } from '../lib/semantics/import-closure.js';
import type { ClosureFile, SourceAlias, SourceReader } from '../lib/semantics/import-closure.js';
import type { MigrationFile } from '../lib/formal/migration-function.js';
import { premiseCheck } from '../lib/formal/premise.js';
import { formatFormalFinding } from '../lib/formal/report.js';
import { resolveSources } from '../lib/formal/resolve-sources.js';
import type { SourceIo } from '../lib/formal/resolve-sources.js';
import { freshnessFindings, parseSourceDeclarations } from '../lib/formal/source-lines.js';
import type { FormalFinding, SourceDeclaration } from '../lib/formal/types.js';
import { FRAMEWORK_FORMAL_DIR } from '../lib/io/paths.js';
import { sourceAliasOf } from '../lib/model/product/layout.js';
import type { ProductLayout } from '../lib/model/product/layout.js';
import type { ProductRoots } from '../lib/model/product/types.js';
import { gitIn } from './diff-io.js';
import type { Git } from './diff-io.js';

/** 履歴から旧い閉包を探すとき、新しい順に試すコミットの数(宣言を作ったコミットは先頭に来る)。 */
const RECALL_CANDIDATES = 3;

/**
 * 作業ツリーを読む口。読めない(無い・ディレクトリ・権限)ものは null にする。
 *
 * @param repoRoot リポジトリルート
 */
export function worktreeReader(repoRoot: string): SourceReader {
  return (relative) => {
    try {
      return readFileSync(path.join(repoRoot, relative), 'utf-8');
    } catch {
      return null;
    }
  };
}

/**
 * あるコミットの版を読む口(`git show <commit>:<path>`。答えなければ null)。
 *
 * @param git git を回す口
 * @param commit 読み出すコミット
 */
function commitReader(git: Git, commit: string): SourceReader {
  return (relative) => {
    const result = git(['show', `${commit}:${relative}`]);
    return result.ok ? result.stdout : null;
  };
}

/**
 * 宣言を**最後に書いたコミット**から、そのときの閉包のファイルを復元する。
 *
 * `\* SOURCE:` の行は閉包の hash だけを持つので、「どのファイルが動いたか」は宣言からは分からない。
 * そこで `git log -S<hash>` でその hash の行を入れたコミットを探し、そのコミットの版で閉包を計算し直す
 * (hash が宣言と一致したものだけを採る — 一致しなければ、その版は宣言を作った版ではない)。
 * 履歴が無い・浅い clone・手元で未コミットのまま宣言を書いた場合は null(名指しを諦め、閉包の全部を出す)。
 *
 * @param git git を回す口
 * @param tlaPath 宣言を持つ `.tla` のリポジトリルート相対パス(`formal/<model>.tla`)
 * @param declaration 食い違った宣言
 * @param alias 実装の木の別名(閉包の `@/…` の綴りと行き先。作業ツリー側と同じ値。配置の `sourceAliasOf`)
 * @returns 宣言を作った時点の閉包のファイル。復元できなければ null
 */
export function recallClosure(
  git: Git,
  tlaPath: string,
  declaration: SourceDeclaration,
  alias: SourceAlias | null,
): readonly ClosureFile[] | null {
  const log = git(['log', `-S${declaration.sha256}`, '--format=%H', '-n', String(RECALL_CANDIDATES), '--', tlaPath]);
  if (!log.ok) return null;
  for (const commit of log.stdout.split('\n').filter((line) => line.trim() !== '')) {
    const past = computeClosure(declaration.target, commitReader(git, commit.trim()), alias);
    if (past !== null && past.hash === declaration.sha256) return past.files;
  }
  return null;
}

/**
 * 1 つの `.tla` の鮮度の判定に要る I/O を作る。
 *
 * @param repoRoot リポジトリルート
 * @param model モジュール名(`formal/<model>.tla`)
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置(閉包の別名の import `@/…` の綴りと行き先を引く)
 */
export function sourceIoFor(repoRoot: string, model: string, roots: ProductRoots, layout: ProductLayout): SourceIo {
  const git = gitIn(repoRoot);
  return {
    read: worktreeReader(repoRoot),
    recall: (declaration) => recallClosure(git, `${FRAMEWORK_FORMAL_DIR}/${model}.tla`, declaration, sourceAliasOf(layout, roots)),
  };
}

/**
 * migration の置き場を丸ごと読む(`SOURCE-FN:` の解決に使う)。置き場は**製品の宣言**から来る。
 *
 * @param repoRoot リポジトリルート
 * @param roots 製品が宣言した根
 * @returns 置き場の `.sql` の全数(無ければ空)
 */
export function loadMigrations(repoRoot: string, roots: ProductRoots): readonly MigrationFile[] {
  const dir = path.join(repoRoot, roots.migrations);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf-8') }));
}

/** 写し元 1 件の閉包の大きさ(印字用)。 */
export interface ClosureSize {
  readonly target: string;
  readonly files: number;
}

/**
 * 1 つのモデルの鮮度(`SOURCE:` / `SOURCE-FN:` と実ファイルの突合)。
 *
 * @param repoRoot リポジトリルート
 * @param model モジュール名
 * @param tla `.tla` の全文
 * @param migrations 読み込んだ migration
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置(閉包の別名の import を解く)
 * @returns 食い違い・解決できない宣言の Finding と、`SOURCE:` ごとの閉包の大きさ
 */
export function sourceReport(
  repoRoot: string,
  model: string,
  tla: string,
  migrations: readonly MigrationFile[],
  roots: ProductRoots,
  layout: ProductLayout,
): { readonly findings: FormalFinding[]; readonly sizes: readonly ClosureSize[] } {
  const parsed = parseSourceDeclarations(tla);
  const resolved = resolveSources(parsed.declarations, migrations, sourceIoFor(repoRoot, model, roots, layout), roots, layout);
  const sizes = [...resolved.entries()].flatMap(([target, entry]) =>
    entry.kind === 'ok' && entry.closure !== undefined ? [{ target, files: entry.closure.length }] : [],
  );
  return { findings: freshnessFindings(model, parsed, resolved), sizes };
}

/** 鮮度の Finding だけ(全実行の `checkModel` が使う)。 */
export function sourceFindings(
  repoRoot: string,
  model: string,
  tla: string,
  migrations: readonly MigrationFile[],
  roots: ProductRoots,
  layout: ProductLayout,
): FormalFinding[] {
  return sourceReport(repoRoot, model, tla, migrations, roots, layout).findings;
}

/**
 * `check:formal --freshness` の本体。**鮮度と、模型の前提の比**を `formal/*.tla` の全部について見る
 * (TLC も Java も呼ばない。数秒)。閉包は静的に列挙できないので CI の `formal` フィルタには載らず、
 * 閉包のどこが動いても落ちるよう、毎 push の docs ジョブと pre-commit がこれを回す。
 *
 * **前提の比(予算 + タイムアウト < リース。`premiseCheck`)もここで見る。** 前提は 3 つの実装値を読むだけの
 * 数秒の検査で TLC が要らない。CI の `formal` ジョブ(TLC)はモデルそのものが動いたときだけ起きる
 * (束 CI-cost)ので、前提の比をそちらにだけ置くと、実装の値(予算・タイムアウト・リース)だけを動かした
 * コミットでは誰も比を見ない —— 毎 push の経路に置く。
 *
 * @param repoRoot リポジトリルート
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置(前提の読み取り元の居場所を引く)
 * @param color 色付けの有無
 * @returns 終了コード(違反 0 件なら 0)
 */
export function freshnessOnly(repoRoot: string, roots: ProductRoots, layout: ProductLayout, color: boolean): number {
  const dir = path.join(repoRoot, FRAMEWORK_FORMAL_DIR);
  const models = existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith('.tla'))
        .map((file) => file.slice(0, -'.tla'.length))
        .sort()
    : [];
  const migrations = loadMigrations(repoRoot, roots);
  const findings: FormalFinding[] = [];
  if (models.length === 0) {
    findings.push({
      severity: 'error',
      message: 'formal/ にモデル(*.tla)が 1 本もありません',
      location: FRAMEWORK_FORMAL_DIR,
      suggestion: '空の集合を突き合わせて緑にしない。formal/ の置き場を確かめる',
    });
  }
  for (const model of models) {
    const report = sourceReport(repoRoot, model, readFileSync(path.join(dir, `${model}.tla`), 'utf-8'), migrations, roots, layout);
    findings.push(...report.findings);
    const sizes = report.sizes.map((size) => `${path.posix.basename(size.target)} ${size.files}`).join(' / ');
    console.log(`  ${model}: 閉包の本数 ${sizes === '' ? '(SOURCE: なし)' : sizes}`);
  }
  const premise = premiseCheck(repoRoot, worktreeReader(repoRoot), roots, layout, migrations);
  for (const note of premise.notes) console.log(note);
  findings.push(...premise.findings);
  console.log('');
  for (const finding of findings) console.log(formatFormalFinding(finding, { color }));
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  console.log(
    errors === 0
      ? `✓ 約束事のモデル ${models.length} 本の写し元は、閉包まで含めて宣言どおりでした(鮮度と前提の比のみ。TLC は回していません)`
      : `検査結果: ${errors} 件の鮮度・前提のエラー(鮮度と前提の比のみ。TLC は回していません)`,
  );
  return errors === 0 ? 0 : 1;
}
