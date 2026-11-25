/**
 * 5 題材を**空の DB に構築して 1 往復**する通し実行(`npm run samples:db [題材]`)の CLI。
 *
 * 使い方:
 *   npm run samples:db            # data_table を持つ題材すべて
 *   npm run samples:db -- rooms   # 1 題材だけ
 *   `--root` の説明は `ROOT_OPTION_HELP`(`lib/io/messages.ts`)
 *
 * 終了コード: 全題材で migration が通れば 0、1 つでも落ちるか**判定できなかった**なら 1。
 *
 * ## 何を見ているのか
 *
 * 生成 SQL(題材ごとに 15〜45 本)は、束 ③-1 まで**一度も実行されていなかった**。字面の検査
 * (`__tests__/samples/harness.ts` の `checkSql`)は「流せる形か」までしか言えないので、
 * 「空の DB に順に当てて本当に通るか」は誰も確かめていなかったということである。ここは
 * 題材ごとに一時 workdir を組み、リポジトリの `supabase/` を読ませないまま
 * `supabase db reset --workdir <tmp>` を当てる。
 *
 * 構築が通ったら**そのまま 1 往復する** —— 一時ツリーの「実 DB に触る手足」を本物に差し替え、
 * 題材の**生成テスト(engine ⇔ RPC と保存点の一致の証明・RLS の挙動)を本物のハーネスで実行する**。
 * RLS の挙動テストは画面と同じ経路(`api` スキーマのビュー)で読む —— そのビューが表ごとの
 * `surface_migration` から生成されるようになったので、題材の world でも実行できる。
 * 件数を**報告する**のは、「緑」が何本ぶんの緑なのかを黙らせないためである。
 *
 * **リポジトリの `supabase/` は書き換えない。** 触るのはローカルスタックの DB の中身だけで、
 * 実行のあとにリポジトリの workdir で作り直して統合テストの前提へ戻す。
 *
 * **pre-commit には入れない**(実 DB を作り直す数分の実行である)。CI は別ジョブ `samples-db`
 * が、夜間の workflow で main が動いた日に 1 回回す(push では回さない)。
 *
 * 2 段目が緑なら**3 段目**を実行する —— 生成物の期待表と実 DB を両方向に突き合わせる
 * **構造の突合**(`*-parity.test.ts`)である。何を実行するかは題材の宣言から導かれ(`db-parity.ts`)、
 * 実行しないものは**導かれた理由**を 1 行ずつ報告する(免除リストは持たない)。
 *
 * この CLI が持つのは引数の読み取りと順番だけである —— 並べ直しは
 * `lib/targets/supabase/samples/db-migrations.ts`、CLI の呼び出しとロックは `lib/targets/supabase/samples/db-reset.ts`、
 * 一時ツリーの仕上げは `lib/targets/supabase/samples/db-tree.ts`、生成テストの実行は
 * `lib/targets/supabase/samples/db-tests.ts`、構造の突合の判定と実行は `lib/targets/supabase/samples/db-parity.ts`、
 * 結末の印字は `lib/targets/supabase/samples/db-report.ts` にある。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PARITY_FIRED_PAIRS, PARITY_SKIPPED_PAIRS, SAMPLE_COVERAGE, runSampleSystem } from '../__tests__/samples/harness.js';
import { orderMigrations, writeDbWorkdir } from '../lib/targets/supabase/samples/db-migrations.js';
import {
  acquireDbLease,
  readLocalStack,
  releaseDbLease,
  resetWithWorkdir,
  type LocalStack,
} from '../lib/targets/supabase/samples/db-reset.js';
import { generatedTestFiles, runGeneratedTests, tablesOf } from '../lib/targets/supabase/samples/db-tests.js';
import { EQUIVALENCE_TEST_ROLES, RLS_TEST_ROLES, unplacedTestRoles } from '../lib/targets/supabase/samples/db-test-places.js';
import { describeParity, runParityStage } from '../lib/targets/supabase/samples/db-parity.js';
import { naFactsOf, runProblems } from '../lib/targets/supabase/samples/sample-coverage-check.js';
import { kindOfPath, kindOutcomes, runWiringStage, withoutAlias, withProblems, type CoverageRunStage } from '../lib/targets/supabase/samples/wiring-tests.js';
import { sampleSourceAlias } from '../lib/targets/supabase/samples/db-places.js';
import { existsSync, readFileSync } from 'node:fs';
import { readyLines, report, seconds, writeStepCounts, type SampleOutcome } from '../lib/targets/supabase/samples/db-report.js';
import { writeRealHarness } from '../lib/targets/supabase/samples/db-tree.js';
import { PRODUCT_DECL_FILE } from '../lib/io/paths.js';
import { repoRootOrExit, withoutRootOption } from './repo-root.js';
import { loadProductRoots } from '../lib/model/product/loader.js';
import { selectPlatformTargets } from './select-platform.js';

/** リポジトリルート(作業ディレクトリから製品の根の宣言を上へ探す。`--root <path>` で上書き)。 */
const REPO_ROOT = repoRootOrExit('samples:db', process.argv.slice(2));

/**
 * 実行の対象になる題材(`legacy/spec-tools/__tests__/fixtures/samples/` の全部。夜間の workflow の一覧が字面で揃う(ci-cost.test.ts)ので並びで書き、
 * 題材の表 `sample-coverage.ts` の題材と食い違えば実行の入口が止める)。
 *
 * どの題材も**配線の段**(実 DB の要らない生成した試験)を回す。data_table を 1 枚も持たない題材(`dual_actors`)は構築する DDL が無いので、
 * 実 DB の段を持たないと名指して報告する(黙って飛ばさない。fix27 A2 までは題材ごと対象外だった)。
 */
const SAMPLES: readonly string[] = ['archive', 'dual_actors', 'expenses', 'library', 'rooms', 'stores'];

/**
 * 題材 1 つを空の DB に構築する。
 *
 * @param name 題材の名前
 * @returns migration の本数と `db reset` の結末
 */
async function buildSample(name: string, stack: LocalStack): Promise<SampleOutcome> {
  // 型検査のために組んだツリーをそのまま使う(同じ段取りを 2 か所に持たない)。
  const run = await runSampleSystem(name, { keepRoot: true });
  const tree = run.root;
  // **`?? ''` で流さない。** `path.join('', 'app')` は相対パス `app` になり、リポジトリルートから
  // 起動すれば**実装の接続層とシードを書き潰す**(独立レビュー ③-2-b F-4)。後始末の側だけが
  // 守られていて書き込みの側が守られていないのは非対称である。
  if (tree === undefined) {
    return {
      name,
      migrations: 0,
      reset: {
        ok: false,
        elapsedMs: 0,
        output:
          `${name}: 一時ツリーの場所が返りませんでした(runSampleSystem の keepRoot が効いていません)。` +
          '実 DB に当てるには「その題材の生成物が置かれたツリー」が要るので、ここで止めます',
        // 作り直す段にも届いていないので、待ち合わせは「していない」。
        ready: null,
      },
      tests: null,
      rlsFiles: 0,
      parity: null,
      wiring: null,
      noDb: null,
    };
  }
  const migrations = orderMigrations(run.generatedFiles, run.roots);
  const selection = selectPlatformTargets('samples:db', run.roots);
  const generated = generatedTestFiles(run.generatedFiles, run.roots, selection.layout);
  // **配線の段**(実 DB の要らない生成した試験)は DB を作る前に回す(DB に依らない。fix27 A2)。
  const wiring: CoverageRunStage = runWiringStage({ sample: name, tree, repoRoot: REPO_ROOT, generatedBy: run.generatedBy, roots: run.roots, layout: selection.layout, table: SAMPLE_COVERAGE });
  console.log(`  ${name}: 生成した試験(配線の段)${[...wiring.kinds].map(([kind, outcome]) => `${kind} ${outcome.passed} 件`).join(' / ') || '0 件'}`);
  if (migrations.length === 0) {
    rmSync(tree, { recursive: true, force: true });
    const noDb = 'data_table を 1 枚も持たない(構築する DDL が無いので実 DB の段は無い)';
    return { name, migrations: 0, reset: { ok: true, elapsedMs: 0, output: '', ready: null }, tests: null, rlsFiles: 0, parity: null, wiring, noDb };
  }
  const workdir = mkdtempSync(path.join(tmpdir(), `samples-db-${name}-`));
  try {
    const placed = writeDbWorkdir({ root: workdir, repoRoot: REPO_ROOT, migrations, roots: run.roots });
    console.log(`  ${name}: migration ${placed.length} 本を一時 workdir に並べました`);
    const reset = await resetWithWorkdir(workdir, stack, REPO_ROOT);
    for (const line of readyLines(reset)) console.log(`  ${name}: ${line}`);
    const base = { name, migrations: placed.length, reset, rlsFiles: generated.rls.length, wiring, noDb: null };
    if (!reset.ok) return { ...base, tests: null, parity: null };
    console.log(
      `  ${name}: 一致の証明 ${generated.equivalence.length} ファイルと` +
        ` RLS の挙動テスト ${generated.rls.length} ファイルを実行します`,
    );
    // **0 本は緑ではない。** 実行するものが無い題材を黙って通すと、「実行して緑」と
    // 「実行するものが存在しない」が区別できなくなる(設計メモが挙げた「緑が型検査だけに退化」の隣)。
    const empty = [
      ...(generated.equivalence.length === 0 ? ['一致の証明'] : []),
      ...(generated.rls.length === 0 ? ['RLS の挙動テスト'] : []),
    ];
    if (empty.length > 0) {
      // 置き場の配置が逆引きを宣言していない(拾う置き場を決められない)ことが原因なら、それを名指す(配置の欠落を「生成されていない」だけで言わない)。
      const unplaced = unplacedTestRoles(selection.layout, run.roots, [...EQUIVALENCE_TEST_ROLES, ...RLS_TEST_ROLES]);
      const cause =
        unplaced.length === 0
          ? ''
          : `。置き場の配置が ${unplaced.join(' / ')} の逆引き(置き場の根)を決められないため、拾う置き場がありません(配置の定義の検査が止めるはずの構成です)`;
      return {
        ...base,
        parity: null,
        tests: {
          ok: false,
          elapsedMs: 0,
          output: `${name}: ${empty.join(' と ')}が 1 ファイルも生成されていません(実行するものが無いので緑と報告できません)${cause}`,
          passed: null,
        },
      };
    }
    const harness = writeRealHarness({ root: tree, tables: tablesOf(migrations), roots: run.roots, platform: selection.platform, layout: selection.layout });
    const reportFile = path.join(tree, 'samples-db.json');
    const executed = runGeneratedTests({ ...harness, repoRoot: REPO_ROOT, stack, roots: run.roots, reportFile });
    // 生成器ごとの通った it の数を題材の表と照らす(実 DB の段。fix27 A2)。
    const dbKinds = existsSync(reportFile) ? withoutAlias(kindOutcomes(readFileSync(reportFile, 'utf-8'), kindOfPath(run.generatedBy)), `${sampleSourceAlias(selection.layout)}/`) : new Map();
    const tests = withProblems(executed, runProblems(name, 'db', { kinds: dbKinds, refusal: new Map(), ...naFactsOf(tree, run.roots) }, SAMPLE_COVERAGE), '生成した試験(実 DB の段)');
    // **3 段目は 2 段目が緑のときだけ。** 構築も world の組み立ても通っていない DB を相手に
    // 構造だけを突き合わせても、読める失敗にならない。
    if (!tests.ok) return { ...base, tests, parity: null };
    const parity = runParityStage({ sample: name, pairs: { fired: PARITY_FIRED_PAIRS, skipped: PARITY_SKIPPED_PAIRS }, tree, repoRoot: REPO_ROOT, migrations, stack, roots: run.roots, layout: selection.layout });
    for (const line of describeParity(parity)) console.log(`  ${name}: ${line}`);
    return { ...base, tests, parity };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
    rmSync(tree, { recursive: true, force: true });
  }
}

/** 対象の題材を引数から決める(無指定なら全部)。 */
function selected(args: readonly string[]): readonly string[] | null {
  const named = args.filter((arg) => !arg.startsWith('--'));
  if (named.length === 0) return SAMPLES;
  const unknown = named.filter((name) => !SAMPLES.includes(name));
  if (unknown.length === 0) return named;
  for (const name of unknown) console.error(`samples:db: 題材 ${name} を知りません(対象: ${SAMPLES.join(' / ')})`);
  return null;
}

/**
 * 実行の入口。
 *
 * @returns 終了コード
 */
async function main(): Promise<number> {
  const argv = withoutRootOption(process.argv.slice(2));
  // `--no-restore`: 実行のあとリポジトリの形へ戻さない。CI の runner は使い捨てで、戻しは
  // 「このあと統合テストを回す手元」のための段だから(CI では戻しの `db reset` 後に GoTrue が
  // 180 秒上がらない実測が 3 回あり、題材 5/5 が緑なのに戻しだけで赤になっていた)。
  const restore = !argv.includes('--no-restore');
  const tabled = Object.keys(SAMPLE_COVERAGE).sort();
  if (tabled.join(' ') !== SAMPLES.join(' ')) {
    console.error(`samples:db: 題材の一覧(${SAMPLES.join(' / ')})が題材の表 sample-coverage.ts の題材(${tabled.join(' / ')})と食い違います`);
    return 1;
  }
  const names = selected(argv.filter((arg) => arg !== '--no-restore'));
  if (names === null) return 1;

  const stack = readLocalStack(REPO_ROOT);
  if (stack === null) {
    console.error('samples:db: ローカル Supabase の接続情報が読めません。');
    console.error(
      '  この通し実行はコンテナを起動しません(勝手に上げるより先に `cd app && npm run test:integration` を\n' +
        '  通すべき局面である)。起動してからもう一度実行してください',
    );
    return 1;
  }

  // 錠取りは**ホストの**実装の木で回す(題材ごとの宣言ではなく、このリポジトリの宣言)。
  const hostRoots = loadProductRoots(REPO_ROOT).model.roots;
  if (hostRoots === null) {
    console.error(`samples:db: 製品の根の宣言(${PRODUCT_DECL_FILE})を読めません`);
    return 1;
  }
  const lease = await acquireDbLease(stack.databaseUrl, REPO_ROOT, hostRoots);
  if (lease === null) return 1;

  const outcomes: SampleOutcome[] = [];
  try {
    for (const name of names) {
      console.log(`samples:db: ${name} を空の DB に構築します`);
      outcomes.push(await buildSample(name, stack));
    }
  } finally {
    if (restore) {
      // **リポジトリの形へ戻す。** ここを通らないと、この実行のあとの統合テストは
      // 「表が 1 つも無い DB」を相手にすることになる。
      console.log('');
      console.log('samples:db: リポジトリの workdir で DB を作り直します(統合テストの前提へ戻す)');
      const restored = await resetWithWorkdir(REPO_ROOT, stack, REPO_ROOT);
      console.log(`  戻し: ${restored.ok ? '通った' : '落ちた'} / ${seconds(restored.elapsedMs)}`);
      for (const line of readyLines(restored)) console.log(`  戻し: ${line}`);
      if (!restored.ok) {
        console.error(restored.output);
        console.error(
          'samples:db: リポジトリの migration の再適用が落ちました。' +
            'この DB には題材のスキーマが残っています(統合テストの前に作り直してください)',
        );
        outcomes.push({
          name: '(リポジトリへの戻し)',
          migrations: 0,
          reset: restored,
          tests: null,
          rlsFiles: 0,
          parity: null,
          wiring: null,
          noDb: null,
        });
      }
    } else {
      console.log('');
      console.log('samples:db: --no-restore のためリポジトリの形へは戻しません(この DB には最後の題材のスキーマが残ります)');
    }
    await releaseDbLease(lease);
  }
  // 走り手が段の子に渡す件数のファイル(開発用リポジトリの走り手の口。無ければ何もしない)。題材の試験は生成した vitest の設定で回るので、
  // 走り手の globalSetup の件数が届かない。通った数を配線・生成テスト・突合の内訳ごとにここで返す(読めない内訳は null。fix27 差分点検 5 回目 A5-1)。
  writeStepCounts(outcomes, process.env);
  return report(outcomes) === 0 ? 0 : 1;
}

process.exit(await main());
