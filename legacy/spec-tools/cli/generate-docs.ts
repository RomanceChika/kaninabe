/**
 * ドメイン仕様の本文生成 CLI。
 *
 * 使い方:
 *   npm run generate            — specs/domain の AUTO-GENERATED ブロックを再生成して書き込む
 *   npm run generate:check      — 書き込まずに、生成結果と現状の差分があれば終了コード 1(鮮度チェック)
 *   npm run generate -- --base <ref>
 *                               — 章の「今回変わった」に、基点 <ref> からの公理の側の差分を載せる(読むときの
 *                                 一時の生成。**コミットしない** — 基点なしの `generate` で元に戻る)
 *   `--root` の説明は `ROOT_OPTION_HELP`(`lib/io/messages.ts`)
 *
 * 検証(`npm run verify`)は生成の前に 1 回回し、その警告を「まだ通していない受け入れ」として章と手引きに
 * 配る(層の表: 生成器は検証器を読まないので、結果を渡すのはこの CLI の仕事)。
 * フロントマター(YAML)が正であり、本文の生成ブロックはこのコマンドの出力で常に上書きされる。
 */

import path from 'node:path';
import process from 'node:process';
import { loadSpecModel } from '../lib/model/loader.js';
import { allGenerators } from '../lib/compose/all-generators.js';
import { targetGenerators, verifyInputsOf } from '../lib/target-api/contract.js';
import { generationBlockers, generationBlockingErrors } from '../lib/verify/pre-generate.js';
import { shutdownZ3 } from '../lib/guard/z3.js';
import { exitCodeAfterShutdown } from '../lib/guard/z3-finish.js';
import type { GenerateContext } from '../lib/gen-kit/generator.js';
import { completeGenerateContext, surfaceUnsupportedNotice } from '../lib/generate/generate-context.js';
import { gatesInputOf, readGenerateInputsWithLoads } from '../lib/generate/generate-inputs.js';
import { runGenerators } from './run-generators.js';
import { mutationReportOfContext } from '../lib/mutation/context-report.js';
import { resultsDir } from '../lib/generate/render/book/results-section.js';
import { exemptionSummary, placementProblemsOf } from '../lib/generate/render/book/block-check.js';
import { repoRootOrExit } from './repo-root.js';
import { axiomFactsOfModel } from '../lib/diff/axioms.js';
import { frameworkHostRoot } from '../lib/io/framework-paths.js';
import { runAllVerifications } from '../lib/compose/verify-pipeline.js';
import { BASE_WITHOUT_VALUE_WARNING, baseWarnings, readingBaseFrom } from './diff-io.js';
import { loadProductRoots } from '../lib/model/product/loader.js';
import { selectPlatformTargets } from './select-platform.js';
import { layoutScan } from '../lib/model/product/layout.js';
import { bookPath, previewsPath, specPath } from '../lib/model/product/paths.js';
import { formatFinding } from '../lib/verify/report.js';
import {
  applyGeneratedSections,
  findOrphanGenerated,
  findStrayInBook,
  findUndeclaredInGeneratedDir,
} from '../lib/generate/apply-sections.js';
import { longIdentifierRefusals } from '../lib/sql/identifier-length.js';
import { unfrozenConstantRefusals } from '../lib/gen-kit/frozen-constants.js';
import { writableTreesOf } from '../lib/generate/write-gate.js';
import { frameworkLedgerOf } from '../lib/generate/framework-ledger-context.js';

/** 引数から `--key value` を 1 つ読む。無ければ undefined。 */
function option(args: readonly string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

async function main(): Promise<number> {
  const check = process.argv.includes('--check');
  const baseRef = option(process.argv.slice(2), '--base');
  // リポジトリルートは「作業ディレクトリから製品の根の宣言を上へ探す」ことで決まり(`--root` で上書き)、
  // 仕様の木の位置はその宣言が持つ —— この CLI は `docs/specs` のようなパスの綴りを 1 つも持たない(束 ①-a)。
  const repoRoot = repoRootOrExit('generate', process.argv.slice(2));
  const rootsResult = loadProductRoots(repoRoot);
  const roots = rootsResult.model.roots;
  const uses = rootsResult.uses;
  if (roots === null || uses === null) {
    console.error('製品の根の宣言(product.md)を読めないため生成を中止します。npm run verify の P 群を先に通してください:');
    for (const finding of rootsResult.findings) console.error(formatFinding(finding, { color: true }));
    return 1;
  }
  /** 仕様の木の中の絶対パス(宣言された根からの組み立て)。 */
  const spec = (...segments: readonly string[]): string =>
    path.join(repoRoot, specPath(roots, ...segments));
  const rootDir = spec('domain');

  const { model, findings } = loadSpecModel(rootDir);
  const errors = findings.filter((f) => f.severity === 'error');
  if (model === null || errors.length > 0) {
    console.error(`仕様のスキーマエラーが ${errors.length} 件あるため生成を中止します。先に npm run verify を通してください。`);
    return 1;
  }

  // 後段(プラットフォームの設定 = DB のロール名・認証の式など と、後段が登録する検査・生成器)を選ぶのは組み立ての根であるこの CLI だけ
  // (検証にも生成にも同じ選択を渡す)。置き場の配置は入力を読む側(smoke の置き場・ハンドブックが写す資材の置き場)も要るので、読む前に選ぶ。
  const selection = selectPlatformTargets('generate', roots);
  // 後段に SQL の公開面を外へ出す能力が無ければ、公開面の生成物は出ない。黙って完走させず、出さないものを名指す(検査側の T12 の行と同じ語)。
  const unsupported = surfaceUnsupportedNotice(selection.platform, 'generate');
  if (unsupported !== null) console.warn(unsupported);
  // ローダーで読む入力の並べ方は generate-book.ts と同じ 1 本(readGenerateInputs)。
  // 認証フローの関門の入力の状態は `uses` と読み込みの結果で決め、文脈に載せる(到達に依る生成物が、関門が読めないときに「確かめていない」と書く)。
  const read = readGenerateInputsWithLoads(repoRoot, roots, selection.layout, { frameworkRoot: frameworkHostRoot() });
  const inputs = { ...read.context, gates: gatesInputOf(read, uses) };
  const actions = inputs.actions;

  // 生成の入力は検証をエラーなしで通った仕様だけ(判定器は verify と同じ。pre-generate.ts)。
  const verifyErrors = await generationBlockingErrors(model, inputs.guards, roots);
  if (verifyErrors.length > 0) {
    console.error(
      `仕様の検証エラーが ${verifyErrors.length} 件あるため生成を中止します。npm run verify で内容を確認してください。`,
    );
    return 1;
  }

  // 検証を先に回すのはこの CLI の仕事(層の表: 生成器は検証器を読まない)。その警告は
  // 「まだ通していない受け入れ」として章と手引きに配る(文脈への載せ方は completeGenerateContext)。
  // 余分の検出の走査の根(例の表のテストの置き場。置き場の配置の役割 `compute-example-test` の逆引き)。実装の木があるのに根を決められないのは
  // 「余分が無い」ではなく前提の失敗(黙って 0 件にしない)。実装の木を持たない製品は置き場が無いのが事実で、走査しない。
  const computeExamples = roots.app === null ? null : layoutScan(selection.layout, roots.app, 'compute-example-test');
  if (roots.app !== null && computeExamples === null) {
    console.error(
      '余分の検出の走査の根を決められないため生成を中止します: 置き場の配置が compute-example-test の逆引き(置き場の根)を宣言していないか、基準の役割を辿れません' +
        '(配置の定義の検査が選ぶ根で止めるはずの構成です。アプリの枠の後段の配置を直してください)',
    );
    return 1;
  }
  const verified = await runAllVerifications({ domainRoot: rootDir, frameworkRoot: frameworkHostRoot(), ...verifyInputsOf(selection) });
  // 全群の検証の error が 1 件でもあれば、何も書かずに止める(実装の木との突合だけは生成の前提にしない: `IMPLEMENTATION_COMPARISON_CHECK_IDS`)。
  // 上の V 群の判定だけでは、名前の綴り(T 群)・置き場(A2 / Q0 / S0 / Y0)・参照の欠落の error で生成が走ってしまう。
  const blockers = generationBlockers(verified.findings);
  if (!verified.modelBuilt || blockers.length > 0) {
    console.error(`仕様の検証エラーが ${blockers.length} 件あるため、何も書かずに生成を中止します(全群の error。実装の木との突合は除く)。npm run verify で内容を確認してください:`);
    for (const finding of blockers) console.error(formatFinding(finding, { color: true }));
    return 1;
  }
  // 基点つきの読み(章の「今回変わった」)。比較先は生成物ではなく仕様モデルから作る(生成の途中は生成物が古い)。
  let readingBase: GenerateContext['readingBase'];
  if (baseRef !== undefined) {
    const read = readingBaseFrom(repoRoot, roots, baseRef, axiomFactsOfModel(model, actions?.actions ?? []), {
      actions: actions !== undefined,
    });
    if (!read.ok) {
      console.error(`基点つきの読みを作れないため生成を中止します: ${read.reason}`);
      return 1;
    }
    readingBase = read.base;
    for (const line of baseWarnings(baseRef, read.notRead)) console.warn(line);
  } else if (process.argv.includes('--base')) {
    // 値の無い --base を黙って基点なしにしない(「今回変わった」が — のままの理由を残す)。
    console.warn(BASE_WITHOUT_VALUE_WARNING);
  }
  // 章の描き方(人向けの表示)・仕様の生テキスト・検証の警告を載せて文脈を完成させる。通し実行も同じ 1 本を呼ぶ。
  // 変異の目録の実測は**ここ(組み立ての根)が起動する**(`mutationReportOfContext`)。生成器の側は結果を受け取るだけ。
  // どのブロックにも属さない標識は下の「標識の置き場」の検査が止める。
  const ctx = completeGenerateContext(
    repoRoot,
    roots,
    selection.platform,
    selection.layout,
    model,
    inputs,
    verified.findings,
    mutationReportOfContext,
    readingBase,
    verified.extensionLedger,
  );

  // ファイルごとに全セクションをまとめて適用する(書き込みの実体は apply-sections.ts)
  const generated = runGenerators(allGenerators(targetGenerators(selection.targets)), model, ctx);
  if (!generated.ok) {
    // 生成器の前提が破れた(= 検査の穴)。仕様の問題と同じ字面で印字して止める ——
    // スタックトレースでは「何を・どう直すか」が読めない(scripts-code-quality.md)。
    console.error('生成器の前提が破れているため生成を中止します(示した検査器に判定が足りていません):');
    for (const finding of generated.findings) console.error(formatFinding(finding, { color: true }));
    return 1;
  }
  const byFile = generated.byFile;

  // 標識の置き場の検査(基線なしで 0 件)。属さない標識・章が出していない標識があれば、
  // 書き込む前に止める(code-examples.ts の「未参照の印」と同じ形)。
  const placement = placementProblemsOf(byFile, model, ctx);
  if (placement.length > 0) {
    console.error(`標識の置き場エラー: ${placement.length} 件(標識はどのブロックにも属し、割り付け先の章が出していること)`);
    for (const problem of placement) console.error(`  - ${problem.message}\n    対処: ${problem.suggestion}`);
    return 1;
  }

  // 生成する SQL の識別子が PostgreSQL の上限(63 バイト)を超えていないこと。超えた名前は黙って切り詰められて別の名前と衝突しうるので、書く前に止める。
  const longNames = longIdentifierRefusals(byFile);
  if (longNames.length > 0) {
    console.error(`識別子の長さエラー: ${longNames.length} 件(生成する SQL の名前は 63 バイト以内。超えた分は PostgreSQL が黙って切り詰める)。何も書かずに止めました:`);
    for (const refusal of longNames) console.error(`  - ${refusal.file}: ${refusal.reason}`);
    return 1;
  }

  // 安全に関わる生成の定数(一覧は frozen-constants.ts の 1 か所)が凍結されていること。凍っていない定数は最上位の
  // Object.assign 1 行で以後の要求の全部に効く(点検 8 回目 B8-4)ので、書く前に止める。
  const unfrozen = unfrozenConstantRefusals(byFile);
  if (unfrozen.length > 0) {
    console.error(`凍結の関所: ${unfrozen.length} 件(実行時に書き換えさせない生成の定数は deepFreeze で初期化する)。何も書かずに止めました:`);
    for (const refusal of unfrozen) console.error(`  - ${refusal.file}: ${refusal.reason}`);
    return 1;
  }

  console.log(exemptionSummary(ctx));

  // 書いてよい木は製品が宣言した根だけ(仕組みの保証台帳は、生成の対象が仕組みの木そのもののときだけ)。関所が拒否したら何も書かない。
  const trees = writableTreesOf(roots, { ownFrameworkTree: frameworkLedgerOf(ctx)?.ownTree === true });
  const result = applyGeneratedSections(byFile, repoRoot, { check, trees }, (line) => {
    if (line.startsWith('警告:')) console.warn(line);
    else if (line.startsWith('鮮度エラー:')) console.error(line);
    else console.log(line);
  });

  if (result.refused.length > 0) {
    console.error(`書き込みの関所が ${result.refused.length} 件の書き先を拒否したため、何も書かずに止めました:`);
    for (const refusal of result.refused) console.error(`  - ${refusal.file}: ${refusal.reason}`);
    console.error('  対処: 書き先は製品の根の宣言(product.md の roots)の木の中の通常のファイルにする(仕様が宣言するファイル名・コミットされたシンボリックリンクを見直す)');
    return 1;
  }

  // 余分の検出(鮮度の裏返し)。宣言を書き換えたときに前の名前のファイルが残ると、
  // どの仕様からも再生成できない生成物が歴史に入る(migrations は追記専用なので、
  // **まだコミットしていないもの**だけが取り残しでありうる)。
  // 結果表の元データ(json)は**置き場ぜんたいが生成物**であり、ファイル名は集約名 /
  // ユースケース名で決まる。集約を 1 つリネームすると、どの仕様からも出ない json が残る ——
  // JSON は `AUTO-GENERATED` の行を持てないので、目印ではなく宣言集合で判定する。
  const declared = new Set(byFile.keys());
  // 例の表のテストの置き場(置き場の配置の役割 `compute-example-test`。Next.js なら `operation/__tests__/generated/computes`)も置き場ぜんたいが生成物である ——
  // 例を持つ純関数の名前を変えると、前の名前のテストファイルが取り残される(A6 は注釈の突合で止めるが、
  // ここは「どの仕様からも出ないファイル」を名指す)。走査の根は配置の逆引きから引く(上で決める。null は実装の木を持たない製品だけ)。
  const orphans = [
    ...findOrphanGenerated(repoRoot, roots.migrations, declared, (line) => console.warn(line)).map(
      (file) => `${file} は生成物ですがどの宣言からも出ません(migration の名前を直したときの取り残し)`,
    ),
    ...findUndeclaredInGeneratedDir(repoRoot, resultsDir(roots), declared).map(
      (file) => `${file} は生成物ですがどの仕様からも出ません(集約 / ユースケースを改名したときの取り残し)`,
    ),
    ...(computeExamples === null ? [] : findUndeclaredInGeneratedDir(repoRoot, computeExamples.dir, declared)).map(
      (file) => `${file} は生成物ですがどの仕様からも出ません(例の表を持つ純関数を改名・削除したときの取り残し)`,
    ),
    ...findStrayInBook(repoRoot, bookPath(roots), declared, previewsPath(roots)).map(
      (file) => `${file} は本の根の下にありますがどの生成器からも出ません(本の木は全部が生成物で、book:open がそのまま配る)`,
    ),
  ];
  for (const line of orphans) console.error(`余分エラー: ${line}。削除するか、宣言をそのファイル名に戻す`);

  if (check && (result.stale.length > 0 || orphans.length > 0)) return 1;
  if (!check && byFile.size === 0) console.log('生成対象がありませんでした');
  if (!check && byFile.size > 0) console.log(`✓ ${byFile.size} ファイルを generate しました`);
  return 0;
}

const exitCode = await main();
// Z3 のワーカースレッドを畳む(verify-docs.ts と同じ後始末)。
process.exit(await exitCodeAfterShutdown(exitCode, shutdownZ3, (line) => console.error(line), 'generate'));
