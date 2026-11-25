/**
 * 適用済み migration の不変性の検査(C23)の CLI。
 *
 * 使い方:
 *   npm run check:migrations -- --staged            # pre-commit: HEAD ⇔ ステージ
 *   npm run check:migrations -- --base <ref> [--head <ref>]  # merge-check・CI: 基点 ⇔ 比較先(基点は呼び手が渡す。無い・使えなければ赤)
 *   `--root` の説明は `ROOT_OPTION_HELP`(`lib/io/messages.ts`)
 *
 * 終了コード: 違反 0 件なら 0、違反があるか**判定できなかった**なら 1。
 *
 * **この CLI が持つのは引数の読み取りと git の呼び出しと印字だけ**である。基点の決め方は
 * lib/gates/migration-diff.ts、判定は lib/gates/migration-immutability.ts(不変則)と
 * lib/gates/migration-numbering.ts(採番の単調増加)の純粋関数にある
 * (どちらも git を注入して単体で読める)。pre-commit と CI が同じ 1 本を呼ぶ ——
 * 「片方だけ直す」非対称を作らないため(scope-parity.test.ts と同じ流儀)。
 *
 * 見る判定は 3 つである。
 *   1. **不変則**: 基点に存在する migration を動かしていないこと
 *   2. **採番**: 新しく足した migration の 6 桁連番が、辞書順で 1 つ前より大きいこと
 *      (日付をまたいでも振り直さない。migrations.md §採番)
 *   3. **拡張の置き場**: 新しく足した migration の `create extension` / `alter extension … set schema` が
 *      `extensions` だけを置き場にすること(点検 7 回目 A7-3。lib/gates/migration-extensions.ts)
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import type { GitResult } from '../lib/gates/migration-diff.js';
import { diffSourceOf } from '../lib/gates/migration-diff.js';
import { migrationDir, formatViolations, frozenViolations, parseNameStatus } from '../lib/gates/migration-immutability.js';
import {
  addedPaths,
  dateStamp,
  formatNumberingViolations,
  numberingViolations,
} from '../lib/gates/migration-numbering.js';
import { extensionViolations, formatExtensionViolations } from '../lib/gates/migration-extensions.js';
import type { ExtensionViolation } from '../lib/gates/migration-extensions.js';
import { PRODUCT_DECL_FILE } from '../lib/io/paths.js';
import { childEnvOutsideRoot } from '../lib/io/safe-path.js';
import { repoRootOrExit } from './repo-root.js';
import { loadProductRoots } from '../lib/model/product/loader.js';
import type { ProductRoots } from '../lib/model/product/types.js';

/** リポジトリルート(作業ディレクトリから製品の根の宣言を上へ探す。`--root <path>` で上書き。git の cwd と宣言の読み先で同じ 1 本を使う)。 */
const REPO_ROOT = repoRootOrExit('check:migrations', process.argv.slice(2));

/** 失敗の理由を 1 行にする(git の stderr があればその 1 行目。無ければ例外の文言)。 */
function failureReason(args: readonly string[], error: unknown): string {
  const stderr =
    typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { readonly stderr?: unknown }).stderr ?? '')
      : '';
  const first = stderr
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  if (first !== undefined) return first;
  return error instanceof Error ? error.message : `git ${args.join(' ')} が失敗しました`;
}

/** git を回して標準出力を返す。失敗は理由つきで返す(黙って null にしない)。 */
function gitRunner(args: readonly string[]): GitResult {
  try {
    const stdout = execFileSync('git', [...args], {
      cwd: REPO_ROOT,
      // PATH から根の中と node_modules を落とす(deploy-check の C23 は npm ci の後の npm run の下で走る。依存の偽の git が関門を空にしない。9 回目 C9-5)。
      env: childEnvOutsideRoot(process.env, REPO_ROOT),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, reason: failureReason(args, error) };
  }
}

/** 引数から `--key value` を 1 つ読む。無ければ undefined。 */
function option(args: readonly string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

/**
 * 基点のコミットに存在した migration のパスを読む(採番の判定の母集合)。
 *
 * @param base 基点の ref
 * @param roots 製品が宣言した根(migration の置き場)
 * @returns パスの一覧。git が答えなければ null(= 判定できない)
 */
function migrationsAt(base: string, roots: ProductRoots): string[] | null {
  const result = gitRunner(['ls-tree', '-r', '--name-only', '--full-name', base, '--', migrationDir(roots)]);
  if (!result.ok) return null;
  return result.stdout.split('\n').filter((line) => line !== '');
}

/**
 * 足した migration の本文を読み、拡張の置き場の破れを集める。
 *
 * 読む版は比較先と同じ —— pre-commit はステージ(`:<path>`)、CI は `--head` の ref。
 * 本文が読めないファイルは「判定できない」= 違反にする(黙って通さない)。
 *
 * @param added 足した migration のパス
 * @param revision `git show` に渡す版の接頭辞(`''` = ステージ)
 * @returns 破れの一覧
 */
function addedExtensionViolations(added: readonly string[], revision: string): ExtensionViolation[] {
  return added
    .filter((file) => file.endsWith('.sql'))
    .flatMap((file) => {
      const result = gitRunner(['show', `${revision}:${file}`]);
      if (!result.ok) return [{ file, statement: `(本文を読めません: ${result.reason})`, kind: '読めない文' as const }];
      return extensionViolations(file, result.stdout);
    });
}

function main(): number {
  const args = process.argv.slice(2);
  // migration の置き場は製品が宣言する。宣言が読めないと検査は「分からない」= 赤である。
  const roots = loadProductRoots(REPO_ROOT).model.roots;
  if (roots === null) {
    console.error(`check:migrations: 製品の根の宣言(${PRODUCT_DECL_FILE})を読めません`);
    return 1;
  }
  // 基点は呼び手が渡す(--staged か --base)。無ければ赤(既定の基点を選ばない。fix27 差分点検 6 回目 A6-1)。
  const source = diffSourceOf(args, gitRunner, roots);

  if (source.kind === 'unavailable') {
    // 「検査対象なし」ではなく「分からない」。検査は分からないときは赤である
    // (deploy ジョブでは本番 DB に触る直前の最後の関門なので、無言で通さない)。
    console.error(`check:migrations: ${source.reason}`);
    console.error(
      '  C23 を判定できませんでした。基点と比較先の ref が実在するか、' +
        'このクローンに歴史があるか(CI なら fetch-depth: 0)を確かめてください',
    );
    return 1;
  }
  for (const note of source.notes) console.log(`check:migrations: ${note}`);
  if (source.kind === 'skip') return 0;

  const changes = parseNameStatus(source.raw);
  const lines = formatViolations(frozenViolations(changes, roots), source.base);

  // 採番の判定は「基点に何があったか」を要る(辞書順で 1 つ前を引くため)。読めなければ
  // 「違反 0 件」ではなく「判定できない」である(不変則の側と同じ挙動)。
  const baseFiles = migrationsAt(source.base, roots);
  if (baseFiles === null) {
    console.error(`check:migrations: 基点 ${source.base} の migration の一覧を読めませんでした`);
    console.error('  C23 の採番の判定ができません。基点の ref が実在するかを確かめてください');
    return 1;
  }
  const numbering = formatNumberingViolations(
    numberingViolations(baseFiles, addedPaths(changes), roots),
    source.base,
    // 「次に使う番号」の日付部分は今日である(時計を持つのはこの CLI だけ)。
    dateStamp(new Date()),
  );

  const extensions = formatExtensionViolations(
    addedExtensionViolations(
      addedPaths(changes),
      args.includes('--staged') ? '' : (option(args, '--head') ?? 'HEAD'),
    ),
  );

  if (lines.length === 0 && numbering.length === 0 && extensions.length === 0) {
    console.log('check:migrations: 適用済み migration は動いていません / 採番は単調増加です / 拡張の置き場は extensions だけです');
    return 0;
  }
  for (const line of [...lines, ...numbering, ...extensions]) console.error(line);
  return 1;
}

process.exit(main());
