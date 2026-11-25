/**
 * ハンドブックだけを生成する CLI(**DB なしの入口**。使い方の 3 段の①「合意の道具 = 仕様 + ハンドブック」)。
 *
 * 使い方:
 *   npm run book                  — 実装の木(`app`)を持たない製品(仕様だけ)は、製品の `book` の根にハンドブックの章と部品を書く
 *   npm run book -- --out <dir>   — `<dir>/<book の根>/…` に書く。**実装の木を持つ製品(全部入りの `generate` がある製品)は
 *                                   `--out` が必須**(本物のハンドブックを、検証を載せない部分の出力で上書きしない)
 *   npm run book -- --check      — **書かずに**、入口の出力が全部入りの `generate` の生成物(リポジトリの `book` の根の対応する章)と、入口が未実施・未集計と
 *                                   書く塊を除いて同じかを見る(手元の確認用。CI には入れない。`lib/generate/book-entry-check.ts`)
 *   `--root` の説明は `ROOT_OPTION_HELP`
 *
 * **SQL の生成(`lib/sql/**`)と変異(`lib/mutation/**`)を読み込まない**(静的に `CLOSURE_BANS`・実行時にこの CLI の
 * 読み込みの記録のテストが見る。**この記録は「この Node の版・この題材・この経路」の観測であり、worker・フック登録前の読み込み・
 * VM などは対象外**)。そのため `generate` と違い、次の 3 つが縮む。何が縮んだかは実行のたびに名指しで出す
 * (`lib/generate/book-entry-report.ts`):
 *   - 変異の目録は回さない(未実施。章は状態 `not_run` を「未実施」と言い、回せなかった `unavailable` とは書き分ける)
 *   - 検証は生成を止める error(V 群)だけで、warning を出す全検査は回さない(未検査。章の「受け入れ」は「未集計」)
 *   - DB の層を読み込まないので、生成した SQL との突合は見ない(未検査。DB に接地する種類を採る製品にだけ名指す)
 *
 * **入力の状態も出す**(`lib/generate/book-entry-plan.ts`): 採っていない種類は未実施(章を出さない。置き場に有効な仕様が残っていても
 * 読まず、他の章の材料にも混ぜない = `readEntryInputs`)・採ったのに読めない種類(置き場に無い・壊れている・仕様を落とした)は阻害
 * (その種類が持ち主の章は書かない)・読めて 0 件の種類は実行。止めた章のファイルが書き込み先に前回の生成で残っていれば名指しして、
 * 終了コードを 0 にしない(自動では消さない)。
 *
 * **`--out` の置き場の木を通して本物のハンドブックを書き換えない**: 書く前に書く予定の全ファイルを検査し(置き場の木の中の既存の
 * シンボリックリンク・製品のハンドブックの中に解決される書き込み先)、1 件でもあれば何も書かずに止まる(`destinationConflicts`)。
 *
 * **この入口の出力は `generate` のハンドブックと別物である**(上の理由で一部の節が違う)。`generate:check` の鮮度とは比べない。代わりに `--check` が、
 * 入口の出力が全部入りの対応する章と、入口が未実施・未集計と書く塊を除いて同じか(別の本を出していないか)を見る。書くのは `generate` と同じ生成器
 * (`BOOK_GENERATORS`。本は HTML)が同じ文脈の組み立て(`readEntryInputs` = 採った種類だけを `readGenerateInputs` と同じ読み方で読む / `completeGenerateContext`)から出す章だけで、
 * migration・実装の部品・テストは 1 本も書かない。
 *
 * **止める章は、生成器を回さないのでなく、出力からその章のファイルを落とす**(`withoutStoppedChapters`。本の HTML は 1 本の生成器が全章を出す)。
 *
 * **阻害した種類を読んでいる章(止めなかった章)の冒頭には、どの節が読めた分だけかを名指す**(`lib/generate/book-entry-notice.ts`。入口の出力だけに足す)。
 */

import path from 'node:path';
import process from 'node:process';
import { loadSpecModel } from '../lib/model/loader.js';
import { shutdownZ3 } from '../lib/guard/z3.js';
import { exitCodeAfterShutdown } from '../lib/guard/z3-finish.js';
import { generationBlockingErrors } from '../lib/verify/pre-generate.js';
import { BOOK_GENERATORS } from '../lib/compose/book-generators.js';
import { partitionPlacementProblems, planEntryInputs, staleChapters, unreadPlaces, withoutStoppedChapters } from '../lib/generate/book-entry-plan.js';
import { destinationConflicts, entryDestination, outOptionOf } from '../lib/generate/book-entry-destination.js';
import { checkChapter, formatCheckReport } from '../lib/generate/book-entry-check.js';
import { readerNotices, withReaderNotices } from '../lib/generate/book-entry-notice.js';
import { bookEntryReport, formatBookEntryReport, formatStaleChapters } from '../lib/generate/book-entry-report.js';
import { completeGenerateContext } from '../lib/generate/generate-context.js';
import { selectLayout, selectPlatformProfile } from './select-target-values.js';
import { gatesInputOf, inputStatesOf, readEntryInputs } from '../lib/generate/generate-inputs.js';
import { frameworkHostRoot } from '../lib/io/framework-paths.js';
import { runGenerators } from './run-generators.js';
import { applyGeneratedSections, findUndeclaredInGeneratedDir } from '../lib/generate/apply-sections.js';
import { writableTreesOf } from '../lib/generate/write-gate.js';
import { placementProblemsOf } from '../lib/generate/render/book/block-check.js';
import { resultsDir } from '../lib/generate/render/book/results-section.js';
import { entryKindOf, isFile, realpathLoose } from '../lib/io/paths.js';
import { tryReadText } from '../lib/io/read-text.js';
import { loadProductRoots } from '../lib/model/product/loader.js';
import { specPath } from '../lib/model/product/paths.js';
import { formatFinding } from '../lib/verify/report.js';
import { invocationDir, repoRootOrExit, withoutRootOption } from './repo-root.js';

/** 書かずに、全部入りの生成物と比べる口。 */
const CHECK_OPTION = '--check';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const repoRoot = repoRootOrExit('book', args);
  const rootsResult = loadProductRoots(repoRoot);
  const roots = rootsResult.model.roots;
  const uses = rootsResult.uses;
  if (roots === null || uses === null) {
    console.error('製品の根の宣言(product.md)を読めないため生成を中止します。npm run verify の P 群を先に通してください:');
    for (const finding of rootsResult.findings) console.error(formatFinding(finding, { color: true }));
    return 1;
  }

  // 書き先は読み込みの前に決める(本物のハンドブックを上書きしない)。`--check` は書かないので、書き先を要らない(実装の木を持つ製品でも `--out` は要らない)。
  const check = withoutRootOption(args).includes(CHECK_OPTION);
  const destination = entryDestination(repoRoot, roots, outOptionOf(withoutRootOption(args)), invocationDir(), realpathLoose);
  if (!check && !destination.ok) {
    console.error(`book: ${destination.message}`);
    return 1;
  }
  const outRoot = destination.ok ? destination.outRoot : repoRoot;

  const { model, findings } = loadSpecModel(path.join(repoRoot, specPath(roots, 'domain')));
  const errors = findings.filter((f) => f.severity === 'error');
  if (model === null || errors.length > 0) {
    console.error(`仕様のスキーマエラーが ${errors.length} 件あるため生成を中止します。先に npm run verify を通してください。`);
    return 1;
  }

  // 製品が採っている種類だけを読む(採っていない種類は、置き場に仕様が残っていても読まない)。全部入りの `generate` の口とは別の投影。
  // 置き場の配置は入力を読む側(smoke の置き場・ハンドブックが写す資材の置き場)も要るので、読む前に選ぶ(配置の値だけを選ぶ口)。
  const layout = selectLayout('book', roots);
  const read = readEntryInputs(repoRoot, roots, uses, layout, { frameworkRoot: frameworkHostRoot() });
  // 認証フローの関門の入力の状態を文脈に載せる(到達に依る章が、関門が読めないときに「確かめていない」と書く。全部入りの `generate` と同じ口)。
  const inputs = { ...read.context, gates: gatesInputOf(read, uses) };
  // 入力の状態(未選択 / 阻害 / 読込済み)は `uses` で決める。阻害した種類・採っていない種類が持ち主の章は回さない(報告が名指す)。
  const plan = planEntryInputs(inputStatesOf(read.loads, uses), roots);
  // 生成を止める error だけは generate と同じ判定器で見る(これも SQL の層を読まない)。warning を出す全検査は回さない。
  const verifyErrors = await generationBlockingErrors(model, inputs.guards, roots);
  if (verifyErrors.length > 0) {
    console.error(`仕様の検証エラーが ${verifyErrors.length} 件あるため生成を中止します。npm run verify で内容を確認してください。`);
    return 1;
  }

  // 検証の結果は載せない(null)。変異の目録は起動しない(口が null = 状態は not_run。章は「未実施」と言う)。
  // プラットフォームの設定はハンドブックの生成器が読まない(SQL を書かない入口)が、文脈の形を 1 つに保つために、設定の値だけを選ぶ口から渡す
  // (後段を選ぶ口 `select-targets.ts` は全後段 = ホストの生成器・検査まで読むので、この入口は通さない = 閉包の禁止。設定の契約の検査 `platformProfileProblems` は SQL の層にあり、この入口は SQL を書かないので通さない)。
  // 採っていない種類の置き場の仕様は、生テキストも読まない(標識の集計 = 種類横断の章の材料に混ぜない)。
  const ctx = completeGenerateContext(repoRoot, roots, selectPlatformProfile(), layout, model, inputs, null, null, undefined, undefined, unreadPlaces(plan, roots));
  const generated = runGenerators(BOOK_GENERATORS, model, ctx);
  if (!generated.ok) {
    console.error('生成器の前提が破れているため生成を中止します(示した検査器に判定が足りていません):');
    for (const finding of generated.findings) console.error(formatFinding(finding, { color: true }));
    return 1;
  }
  // 本は HTML を 1 本の生成器が全章まとめて出すので、止める章(阻害・採っていない種類が持ち主の章)は出力からそのファイルを落とす。
  const byFile = withoutStoppedChapters(generated.byFile, plan, roots);
  const { emptyGenerators } = generated;

  // 阻害した種類の仕様ファイルの標識が章に出ていないのはその結果なので、エラーにせず報告に名指す(それ以外は generate と同じに止める)。
  // 採っていない種類の仕様は生テキストを読まないので、ここには来ない。
  const placement = partitionPlacementProblems(placementProblemsOf(byFile, model, ctx), plan, roots);
  if (placement.hard.length > 0) {
    console.error(`標識の置き場エラー: ${placement.hard.length} 件(標識はどのブロックにも属し、割り付け先の章が出していること)`);
    for (const problem of placement.hard) console.error(`  - ${problem.message}\n    対処: ${problem.suggestion}`);
    return 1;
  }

  // `--check`: 書かずに、入口の出力を全部入りの生成物(リポジトリの book の根の同じ相対パス)と比べる。
  if (check) {
    // 比べるのは全体を生成する章・部品(`wholeFile`)。書き込みと同じく、最初の全体生成のセクションが書かれる中身である。
    const wholes = [...byFile].flatMap(([file, sections]) => {
      const whole = sections.find((section) => section.wholeFile === true);
      return whole === undefined ? [] : [{ file, content: whole.content }];
    });
    const report = formatCheckReport(wholes.map(({ file, content }) => checkChapter(file, content, tryReadText(path.join(repoRoot, file)))));
    if (plan.blocked.length > 0) {
      console.log(`注意: 阻害した種類(${plan.blocked.map((blocked) => blocked.kind).join(' / ')})があるので、読めた分だけの章を全部入りと比べている(食い違いは阻害の結果でありうる)`);
    }
    for (const line of report.lines) console.log(line);
    return report.ok ? 0 : 1;
  }

  // 阻害した種類を読んでいる章(止めなかった章)の冒頭に、どの節が読めた分だけかを名指す(入口の出力だけ。全部入りの `generate` の章には足さない)。
  const notices = readerNotices(plan, [...byFile.keys()], roots);
  const noticed = withReaderNotices(byFile, notices);

  // `--out` の置き場の木を通して本物のハンドブックを書き換えない: 書く予定の全ファイルを先に検査し、1 件でもあれば何も書かない。
  if (destination.ok && destination.explicit) {
    const conflicts = destinationConflicts([...byFile.keys()], outRoot, repoRoot, roots, { kindOf: entryKindOf, realpath: realpathLoose });
    if (conflicts.length > 0) {
      console.error(`書き込み先の置き場が、製品の本物のハンドブックを書き換えるおそれがあるため、何も書かずに止めます(${conflicts.length} 件):`);
      for (const conflict of conflicts) console.error(`  - ${conflict}`);
      console.error(`  対処: 置き場は専用の空の木にする(置き場の木の中のシンボリックリンクを消す・別の置き場を --out に指定する)`);
      return 1;
    }
  }

  console.log('ハンドブックだけを生成します(DB なしの入口。SQL の生成と変異の層は読み込みません)');
  console.log(`書き込み先: ${path.join(outRoot, roots.book)}${destination.ok && destination.explicit ? '(--out で指定)' : ''}`);
  const applied = applyGeneratedSections(noticed, outRoot, { check: false, trees: writableTreesOf(roots, { ownFrameworkTree: false }) }, (line) => {
    if (line.startsWith('警告:')) console.warn(line);
    else console.log(line);
  });
  if (applied.refused.length > 0) {
    console.error(`書き込みの関所が ${applied.refused.length} 件の書き先を拒否したため、何も書かずに止めました:`);
    for (const refusal of applied.refused) console.error(`  - ${refusal.file}: ${refusal.reason}`);
    return 1;
  }

  // 結果表の元データ(json)の置き場ぜんたいが生成物(`generate` と同じ。書き込み先の置き場を見る)。
  const orphans = findUndeclaredInGeneratedDir(outRoot, resultsDir(roots), new Set(byFile.keys())).map(
    (file) => `${file} は生成物ですがどの仕様からも出ません(集約 / ユースケースを改名したときの取り残し)`,
  );
  for (const line of orphans) console.error(`余分エラー: ${line}。削除するか、宣言をそのファイル名に戻す`);

  // 止めた章(阻害・採っていない。この実行では回さない章)のファイルが書き込み先に残っていれば名指す(黙って古い章を残さない)。
  const stale = staleChapters(plan, (file) => isFile(path.join(outRoot, file)));
  const unplaced = placement.ofBlocked.map((problem) => problem.file);
  const report = bookEntryReport({ files: [...byFile.keys()], emptyGenerators, uses, plan, stale, unplaced, notices });
  for (const line of formatBookEntryReport(report)) console.log(line);
  const staleLines = formatStaleChapters(report);
  for (const line of staleLines) console.error(line);
  // 全群の検証(T・A・S 群ほか)は SQL の層と変異の層を読む(この入口は読まない約束。`CLOSURE_BANS`)ので、ここでは回さない。止めるのは V 群の error だけ。
  // 生成物への注入は出力の口(`html/markup.ts`)と書き込みの関所が止める。仕様の誤りの全部は `npm run verify`(全部入りの `generate` は全群の error で止まる)が見る。
  console.warn('警告: この入口の出力は generate のハンドブックと別物なのでコミットしない(本物は npm run generate が出す)。全群の検証は回さない(V 群の error だけで止める)ので、仕様の誤りは npm run verify で見る');
  if (orphans.length > 0 || staleLines.length > 0) return 1;
  if (byFile.size === 0) console.log('生成対象がありませんでした');
  else {
    const unchanged = byFile.size - applied.written.length - applied.skipped.length;
    const skipped = applied.skipped.length === 0 ? '' : `・マーカーの差し込み先が無く飛ばした ${applied.skipped.length}`;
    console.log(`✓ 生成 ${byFile.size} ファイル(実際に書いた ${applied.written.length}・変わらなかった ${unchanged}${skipped})`);
  }
  return 0;
}

const exitCode = await main();
// Z3 のワーカースレッドを畳む(generate-docs.ts と同じ後始末。生成を止める error の判定が充足性で使う)。
process.exit(await exitCodeAfterShutdown(exitCode, shutdownZ3, (line) => console.error(line), 'generate-book'));
