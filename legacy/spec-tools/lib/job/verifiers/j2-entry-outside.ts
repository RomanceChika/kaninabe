/**
 * J2(続き)HTTP の入口の閉世界の、**走査の根の外**の見張り(6 回目 C6-5・B6-2)。
 *
 * 入口の閉世界は配置の走査の根(Next.js では `src/app`)だけを歩く。枠がその根と並んで、または優先して口の根に選ぶ置き場(`forbiddenRoots`。
 * Next.js では製品の根の `pages` / `src/pages` / `app`)と、入口の母集合を変える枠の設定(`frameConfig`。既定の export の鍵の許可表)は、走査の中からは
 * 見えないので、置き場と設定そのものを error にする。値は配置(アプリの枠の後段)が宣言し、ここは在るかと本文を見るだけ。
 *
 * 点検 16 回目 C16-3・C16-7 で、在るものだけを見ていた 3 か所を閉じた:
 *   - 枠の設定が `required` なら、設定の不在と、値を固定した欄(守りのヘッダの配線)の不在も error(`next.config.ts` を消すと守りのヘッダが全部消えた)
 *   - 枠が直下のファイルを名前で呼ぶ置き場(`frameRootFiles`。Next.js の `src`)の直下のコードは許可表の名前だけ(`instrumentation.ts`・`middleware.ts` は表に無い)
 *   - 静的な置き場の走査は何も飛ばさない `walkTree` で歩き、読めなかった場所も error(読めない名前・権限の無いディレクトリを黙って飛ばしていた)
 */

import path from 'node:path';
import type { Finding } from '../../kernel/finding.js';
import { entryKindOf, isFile, listEntries, toRelative } from '../../io/paths.js';
import { walkTree } from '../../io/walk-tree.js';
import { tryReadText } from '../../io/read-text.js';
import type { LayoutScan } from '../../model/product/layout.js';
import { frameConfigKeysProblem } from '../frame-config-keys.js';
import { packageJsonResolutionProblem, tsconfigPathsProblem } from '../module-resolution-config.js';

/** J2 の指摘を組み立てる(この検査は J2 の続き)。 */
function entryFinding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: 'J2', severity: 'error', ...args };
}

/** 枠が別の口の根に選ぶ置き場がある指摘。 */
function forbiddenRootFinding(file: string, scanDir: string): Finding {
  return entryFinding({
    message:
      `${file} があります。アプリの枠はここを HTTP の口の根(Pages Router の pages/ の API ルート、または ${scanDir} より優先される根)として使うので、` +
      `その下の口は入口の閉世界(${scanDir} だけを歩く)・出どころの関門・GET / HEAD の禁止・有料の口の包み・生成の見張りテストのどれにも見えません`,
    location: { file },
    suggestion: `${file} を消す。HTTP の口は ${scanDir} の下の route.ts に置き、宣言に載せる`,
    counterexample: { file, scan_root: scanDir },
    grounding: 'implementation',
  });
}

/** 枠の設定が入口の母集合を変える指摘。 */
function frameConfigFinding(file: string, problem: string): Finding {
  return entryFinding({
    message: `${file} の既定の export が許可表で読めません: ${problem}`,
    location: { file },
    suggestion:
      '既定の export を同じファイルのオブジェクトのリテラル(か、それを指す最上位の const)にし、鍵は許可表の欄だけを静的な綴りで書く。' +
      '入口の母集合を変える欄(pageExtensions・rewrites など)は書けない(閉世界の検査は枠の既定の綴りで口を数える)。欄が本当に要るなら配置の値の許可表を直す',
    counterexample: { file },
    grounding: 'implementation',
  });
}

/** 枠がそのまま配る置き場の、読めなかった場所の指摘(点検 16 回目 C16-7。読めない場所を黙って飛ばさない)。 */
function unreadableStaticFinding(dir: string): Finding {
  return entryFinding({
    message: `${dir} は枠がそのまま配る置き場の中で、読めませんでした。中のファイルの拡張子を確かめられないので、読めないまま通しません`,
    location: { file: dir },
    suggestion: `${dir} を読める権限にするか消す`,
    counterexample: { file: dir },
    grounding: 'implementation',
  });
}

/** 枠がそのまま配る置き場の、表の外の拡張子のファイルの指摘(点検 13 回目 B13-7)。 */
function staticRootFindings(repoRoot: string, root: NonNullable<LayoutScan['staticRoot']>): Finding[] {
  const allowed = new Set(root.extensions);
  const walked = walkTree(path.join(repoRoot, root.dir));
  return [
    ...walked.unreadable.map((absolute) => unreadableStaticFinding(toRelative(repoRoot, absolute))),
    ...walkedFileFindings(repoRoot, root, allowed, walked.files),
  ];
}

/** 静的な置き場の、表の外の拡張子のファイルの指摘の本体。 */
function walkedFileFindings(repoRoot: string, root: NonNullable<LayoutScan['staticRoot']>, allowed: ReadonlySet<string>, files: readonly string[]): Finding[] {
  return files
    .map((absolute) => toRelative(repoRoot, absolute))
    .filter((file) => !allowed.has(path.extname(file).slice(1)))
    .map((file) =>
      entryFinding({
        message: `${file} は枠がそのまま配るファイルで、拡張子が許可表の外です。文書やスクリプトは前段の守り(CSP)の外に出ます`,
        location: { file },
        suggestion: `${root.dir} に置けるのは ${root.extensions.join(' / ')} だけ。文書は画面として宣言する`,
        counterexample: { file, allowed: root.extensions.join(', ') },
        grounding: 'implementation',
      }),
    );
}

/**
 * 走査の根の外で入口の閉世界を壊す置き場・設定の指摘(製品の根の下。在るものだけ)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param scan 配置の逆引きの走査(`forbiddenRoots` / `frameConfig` は製品の根を接いだ形)
 */
export function outsideScanFindings(repoRoot: string, scan: LayoutScan): Finding[] {
  const findings: Finding[] = [];
  for (const dir of scan.forbiddenRoots ?? []) {
    if (entryKindOf(path.join(repoRoot, dir)) !== 'absent') findings.push(forbiddenRootFinding(dir, scan.dir));
  }
  if (scan.staticRoot !== undefined) findings.push(...staticRootFindings(repoRoot, scan.staticRoot));
  if (scan.frameConfig !== undefined) findings.push(...frameConfigFindings(repoRoot, scan.frameConfig));
  if (scan.frameRootFiles !== undefined) findings.push(...frameRootFindings(repoRoot, scan.frameRootFiles));
  return findings;
}

/** 枠の設定ファイルの指摘(在るものの鍵の許可表と、`required` なら不在)。 */
function frameConfigFindings(repoRoot: string, config: NonNullable<LayoutScan['frameConfig']>): Finding[] {
  const findings: Finding[] = [];
  let present = 0;
  for (const file of config.files) {
    const text = tryReadText(path.join(repoRoot, file));
    if (text === null) continue;
    present += 1;
    const problem = frameConfigKeysProblem(file, text, config.allowedKeys, config.fixedMembers, config.required === true);
    if (problem !== null) findings.push(frameConfigFinding(file, problem));
  }
  if (config.required === true && present === 0) findings.push(missingFrameConfigFinding(config.files));
  return findings;
}

/** 在ることを要する枠の設定が、どの名前でも無い(読めない)指摘(点検 16 回目 C16-3)。 */
function missingFrameConfigFinding(files: readonly string[]): Finding {
  const listed = files.join(' / ');
  return entryFinding({
    message: `枠の設定(${listed} のどれか)がありません(読めません)。守りの配線(応答のヘッダなど)は設定が持つので、設定の不在は守りが黙って消える形です`,
    location: { file: files[0] ?? '' },
    suggestion: `${files[0] ?? '枠の設定'} を置き、値を固定した欄を決まった形で書く`,
    counterexample: { files: listed },
    grounding: 'implementation',
  });
}

/** コードのファイルの拡張子(`.js` / `.jsx` / `.ts` / `.tsx` と、その `c` / `m` の形)。 */
const CODE_FILE = /\.[cm]?[jt]sx?$/u;

/** 枠が直下のファイルを名前で呼ぶ置き場の、許可表に無いコードのファイルの指摘(点検 16 回目 C16-3)。 */
function frameRootFindings(repoRoot: string, root: NonNullable<LayoutScan['frameRootFiles']>): Finding[] {
  const allowed = new Set(root.files);
  return listEntries(path.join(repoRoot, root.dir))
    .filter((name) => CODE_FILE.test(name) && !allowed.has(name) && isFile(path.join(repoRoot, root.dir, name)))
    .map((name) => {
      const file = path.posix.join(root.dir, name);
      return entryFinding({
        message: `${file} は枠が名前で呼びうる置き場の直下のコードで、許可表(${root.files.join(' / ')})に無い名前です。枠は ${root.dir} の直下の決まった名前のファイルを要求ごと・起動時に呼ぶので、表の外のファイルは宣言の無い入口になりえます`,
        location: { file },
        suggestion: `${file} を消すか、層の下(${root.dir}/<層>/)に移す。直下に置けるコードは ${root.files.join(' / ')} だけ`,
        counterexample: { file, allowed: root.files.join(', ') },
        grounding: 'implementation',
      });
    });
}


/** 指定子の解き方を変える設定の指摘。 */
function resolutionConfigFinding(file: string, problem: string): Finding {
  return entryFinding({
    message:
      `${file} が指定子の解き方を許可表の外で変えています: ${problem}。` +
      '束ねる道具は別名を自分のソースに解きますが、import の閉包(有料の連携に届くか・起動口が実装に届くか)は相対と配置の別名しか辿らないので、届く先が黙って消えます(点検 7 回目 B7-2)',
    location: { file },
    suggestion:
      '実装の木の中は相対か配置の別名で import し、package.json の imports / exports・tsconfig の paths の追加 / baseUrl は書かない。' +
      '別名が本当に要るなら配置の別名(source-root の module)を直す',
    counterexample: { file },
    grounding: 'implementation',
  });
}

/**
 * 製品の `package.json` と `tsconfig.json` が、指定子の解き方を許可表の外で変えていないか(在るものだけ。点検 7 回目 B7-2)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param productRoot 製品の根(リポジトリルート相対)
 * @param alias 配置の別名(`dir` はリポジトリルート相対。null なら別名なし)
 */
export function resolutionConfigFindings(repoRoot: string, productRoot: string, alias: { readonly prefix: string; readonly dir: string } | null): Finding[] {
  const findings: Finding[] = [];
  const packageFile = path.posix.join(productRoot, 'package.json');
  const packageText = tryReadText(path.join(repoRoot, packageFile));
  const packageProblem = packageText === null ? null : packageJsonResolutionProblem(packageText);
  if (packageProblem !== null) findings.push(resolutionConfigFinding(packageFile, packageProblem));
  const tsconfigFile = path.posix.join(productRoot, 'tsconfig.json');
  const tsconfigText = tryReadText(path.join(repoRoot, tsconfigFile));
  const local = alias === null ? null : { prefix: alias.prefix, dir: path.posix.relative(productRoot, alias.dir) };
  const tsconfigProblem = tsconfigText === null ? null : tsconfigPathsProblem(tsconfigFile, tsconfigText, local);
  if (tsconfigProblem !== null) findings.push(resolutionConfigFinding(tsconfigFile, tsconfigProblem));
  return findings;
}
