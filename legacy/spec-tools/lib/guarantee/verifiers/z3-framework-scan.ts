/**
 * Z3 仕組みの走査 ⇔ 仕組みの台帳(仕組み自身の見張りテストの突合)。
 *
 * 保証台帳は 2 本ある —— 製品のもの(Z1)と、仕組みが自分自身について持つもの(`framework/guarantees.md`)。
 * 仕組みの台帳の見張りテストは**仕組みの根**に住み(実行時パッケージのソースと検証器・生成器の木の `__tests__/guarantees`)、
 * 製品の木の走査には入らない。Z3 はその突合を、**製品の `uses`・製品の台帳・action_spec・実装の木のどれにも依らず**行う ——
 * 製品の側が何も採っていなくても、仕組みの約束は消えない(製品が外せない義務)。
 *
 * 見るのは 4 つ。
 *   1. 走査・台帳の状態: 阻害(根の下に置き場が無い・読めないテストがある・台帳が無い / 読めない / 欠けている)は error で言う。
 *      呼び手が根を渡していない(`not_requested`)ときは何も判定せず、**未実施と名指しする**(`frameworkNotRequestedNote`)—— 黙って緑にしない。
 *   2. 仕組みの台帳の各 `test_cases`: `spec_ids` は仕組みの台帳自身の id だけ(製品のドメインの語を持たない)・`implementation.file` は
 *      仕組みの見張りテストの置き場の下・実在してテスト名まで一致する(`checkTestCaseTrace` を Z1・A6 と共用)。
 *   3. 仕組みの根の全注釈: 台帳(製品の台帳が宣言する 1 件も含む)に宣言が無ければ孤児・同じ `@tc` が複数のテストにあれば重複
 *      (**製品の木の注釈とも合算して数える** = 根をまたぐ重複)・注釈を 1 つも持たないテストファイル(未処理台帳は無い)・
 *      片方だけの注釈・注釈の位置・ひな形とループの食い違い。
 *   4. 注釈の中身: assert を持つか(A16 と同じ関数 `assertionFindings`)。
 *
 * 製品の台帳が仕組みの見張りテストを宣言している 1 件(製品の実物の画面を読む配線の突合)は、Z1 が仕組みの走査を引いて見る。
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import type { TcRegistry, TcRegistryEntry, TestAnnotation } from '../../testcase/types.js';
import type { FrameworkScan, ScanWithFramework } from '../../testcase/index.js';
import { assertionFindings, checkTestCaseTrace, groupByTcId, ownerOf } from '../../testcase/index.js';
import { FRAMEWORK_GUARANTEES_FILE, FRAMEWORK_TEST_ROOTS, isUnderFrameworkTestRoots } from '../../io/framework-paths.js';
import { FRAMEWORK_GUARANTEE_CATALOG_ID } from '../../model/guarantee/namespace.js';
import type { FrameworkLedgerLoad } from '../../model/guarantee/framework-loader.js';
import { annotationShapeFindings } from './z3-annotation-shape.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'Z3';

/**
 * 仕組みの根を渡していないことを名指す 1 行(実行ログに出す。`isCheckRunNote` の形 = 範囲が縮んだ報告として数えられる)。
 *
 * 走査も台帳も渡していないときだけ未実施と言う。片方だけ渡している(呼び手の配線の誤り)・台帳が阻害されているときは、
 * 根を渡している —— `verifyFrameworkGuarantees` が error で言うので、ここでは言わない(同じ原因を 2 行で数えない)。
 *
 * @param tests 走査結果(仕組みの走査を入れ子で持っていてよい)
 * @param ledger 仕組みの台帳の読み込みの結果
 * @returns 渡していなければ未実施の行、それ以外は null
 */
export function frameworkNotRequestedNote(tests: ScanWithFramework, ledger: FrameworkLedgerLoad): string | null {
  if (!scanNotRequested(tests) || ledger.state !== 'not_requested') return null;
  return `${VERIFIER_ID}: 未実施 — 仕組みの根が渡されていません(仕組み自身の見張りテストと保証台帳を突き合わせていません)。`;
}

/** 仕組みの根の走査を渡していない(`framework` が無い / `not_requested`)か。 */
function scanNotRequested(tests: ScanWithFramework): boolean {
  const state = tests.framework?.state;
  return state === undefined || state.state === 'not_requested';
}

/**
 * 仕組みの走査と仕組みの台帳を突き合わせる。
 *
 * @param registry テストケース ID 台帳(両方の保証台帳のエントリを載せている)
 * @param tests 走査結果(`framework` に仕組みの根の走査を持つ)
 * @param ledger 仕組みの台帳の読み込みの結果
 * @returns 違反のリスト(走査も台帳も渡していなければ空 — 未実施は `frameworkNotRequestedNote` が言う)
 */
export function verifyFrameworkGuarantees(
  registry: TcRegistry,
  tests: ScanWithFramework,
  ledger: FrameworkLedgerLoad,
): Finding[] {
  const findings: Finding[] = [];
  // 台帳の阻害は**根を渡した証拠**である —— 走査を渡していなくても(配線の誤り)、黙って未実施にしない。
  if (ledger.state === 'blocked') findings.push(ledgerBlockedFinding(ledger.reason));
  const scan = tests.framework;
  if (scan === undefined || scan.state.state === 'not_requested') {
    if (ledger.state === 'loaded') findings.push(scanMissingFinding());
    return findings;
  }
  if (scan.state.state === 'blocked') findings.push(scanBlockedFinding(scan.state.reason));
  if (ledger.state === 'not_requested') findings.push(ledgerMissingFinding());
  const entries = registry.entries.filter((entry) => ownerOf(entry) === 'framework');
  // 読めた台帳に見張りテストが 1 件も無いのは、空の台帳で緑にならないように error で言う(阻害のときは別に言っている)。
  if (ledger.state === 'loaded' && entries.length === 0) findings.push(ledgerEmptyFinding());
  findings.push(...entries.flatMap(checkEntryShape));
  if (scan.state.state !== 'scanned') return findings;
  return [...findings, ...checkEntryTrace(registry, scan), ...checkAnnotations(registry, tests, scan, ledger.state === 'loaded')];
}

/** 仕組みの台帳の `test_cases` 1 件の宣言の形(`spec_ids` と置き場。走査に依らない)。 */
function checkEntryShape(entry: TcRegistryEntry): Finding[] {
  const findings: Finding[] = entry.specIds
    .filter((id) => id !== FRAMEWORK_GUARANTEE_CATALOG_ID)
    .map((id) =>
      makeFinding(VERIFIER_ID, {
        message: `${entry.tcId} の spec_ids ${id} は仕組みの台帳が指してよい仕様ではありません`,
        location: entry.location,
        suggestion: `仕組みの台帳の spec_ids に書けるのはこの台帳自身の id(${FRAMEWORK_GUARANTEE_CATALOG_ID})だけ(仕組みは製品のドメインの語を持たない)`,
        counterexample: { test_case: entry.tcId, spec_id: id },
      }),
    );
  if (!isUnderFrameworkTestRoots(entry.implementation.file)) {
    findings.push(
      makeFinding(VERIFIER_ID, {
        message: `${entry.tcId} の implementation ${entry.implementation.file} は仕組みの見張りテストの置き場の外です`,
        location: entry.location,
        suggestion: `仕組みの台帳の見張りテストは仕組みの根の下(${FRAMEWORK_TEST_ROOTS.join(' / ')})に置く。製品の木のテストを仕組みの保証の見張りにしない`,
        counterexample: { test_case: entry.tcId, file: entry.implementation.file },
      }),
    );
  }
  return findings;
}

/** 仕組みの台帳の `test_cases` を仕組みの走査に突き合わせる(置き場の外を指すものは形の違反で済んでいるので見ない)。 */
function checkEntryTrace(registry: TcRegistry, scan: FrameworkScan): Finding[] {
  const byTcId = groupByTcId(scan.annotations);
  const files = new Set(scan.testFiles);
  return registry.entries
    .filter((entry) => ownerOf(entry) === 'framework' && isUnderFrameworkTestRoots(entry.implementation.file))
    .flatMap((entry) => checkTestCaseTrace(entry, byTcId.get(entry.tcId) ?? [], files, VERIFIER_ID));
}

/**
 * 仕組みの根の注釈 → 台帳の方向(孤児・重複・注釈なしのファイル・形・中身)。
 * 台帳を使えないとき(阻害)は孤児を判定しない —— 宣言が全部見えていないのに「宣言が無い」と言う偽の error の洪水を作らない(阻害は別に言っている)。
 */
function checkAnnotations(
  registry: TcRegistry,
  tests: ScanWithFramework,
  scan: FrameworkScan,
  ledgerLoaded: boolean,
): Finding[] {
  const tagged = new Set(scan.annotations.map((annotation) => annotation.file));
  return [
    ...(ledgerLoaded ? scan.annotations.filter((annotation) => !isDeclared(registry, annotation)).map(orphanFinding) : []),
    ...duplicateFindings(scan.annotations, tests.annotations),
    ...scan.testFiles.filter((file) => !tagged.has(file)).map(untaggedFinding),
    ...annotationShapeFindings(scan),
    ...assertionFindings(scan.testBlocks ?? [], scan.assertionHelpers ?? [], VERIFIER_ID),
  ];
}

/**
 * 仕組みの根の注釈に、持ち主として正しい宣言があるか。
 *
 * 正しいのは、仕組みの台帳の宣言か、**製品の保証台帳が仕組みの置き場の下を指して宣言した 1 件**(製品の実物を読む配線の突合)だけである。
 * 製品の action_spec など別の種類の宣言を、仕組みの根のテストが自分の注釈に使っても宣言とは認めない(台帳に `has` するだけで通すと、
 * 製品のテストケース ID を仕組みの根のテストが横取りしても孤児にならない)。
 */
export function isDeclared(registry: TcRegistry, annotation: TestAnnotation): boolean {
  return registry
    .find(annotation.tcId)
    .some(
      (entry) =>
        ownerOf(entry) === 'framework' ||
        (entry.specKind === 'guarantee_spec' && isUnderFrameworkTestRoots(entry.implementation.file)),
    );
}

function scanBlockedFinding(reason: string): Finding {
  return makeFinding(VERIFIER_ID, {
    message: `仕組みの見張りテストを走査できません: ${reason}`,
    location: { file: FRAMEWORK_GUARANTEES_FILE },
    suggestion: '仕組みの根の下に見張りテストの置き場があること・テストファイルを読めることを確かめる(空の走査で緑にしないため、突合を止めている)',
  });
}

function ledgerBlockedFinding(reason: string): Finding {
  return makeFinding(VERIFIER_ID, {
    message: `仕組みの保証台帳を使えません: ${reason}`,
    location: { file: FRAMEWORK_GUARANTEES_FILE },
    suggestion: '仕組みの台帳は製品が外せない義務である。台帳を置く・読める形に直す(Z0 の指摘が原因を言う)',
  });
}

function ledgerEmptyFinding(): Finding {
  return makeFinding(VERIFIER_ID, {
    message: '仕組みの保証台帳に見張りテストの宣言(test_cases)が 1 件もありません',
    location: { file: FRAMEWORK_GUARANTEES_FILE },
    suggestion: '仕組みの保証は 1 行ごとに見張りテストの宣言が必須である。空の台帳は何も見張っていないので通さない',
  });
}

function scanMissingFinding(): Finding {
  return makeFinding(VERIFIER_ID, {
    message: '仕組みの保証台帳は渡されているのに、仕組みの根の走査が渡されていません',
    location: { file: FRAMEWORK_GUARANTEES_FILE },
    suggestion: '呼び手の配線の誤り。走査と台帳は同じ仕組みの根から一緒に読んで渡す',
  });
}

function ledgerMissingFinding(): Finding {
  return makeFinding(VERIFIER_ID, {
    message: '仕組みの根の走査は渡されているのに、仕組みの保証台帳が渡されていません',
    location: { file: FRAMEWORK_GUARANTEES_FILE },
    suggestion: '呼び手の配線の誤り。走査と台帳は同じ仕組みの根から一緒に読んで渡す',
  });
}

function orphanFinding(annotation: TestAnnotation): Finding {
  return makeFinding(VERIFIER_ID, {
    message: `仕組みの見張りテストの "@tc ${annotation.tcId}" に対応するテストケースが、どの保証台帳の test_cases にもありません`,
    location: { file: annotation.file, pointer: `L${annotation.line}` },
    suggestion:
      `仕組みの台帳(${FRAMEWORK_GUARANTEES_FILE})の test_cases に "- id: ${annotation.tcId}" を足し、保証の canaries から指す。` +
      'このテストが保証と結び付かないなら @tc を外す',
    counterexample: { tc: annotation.tcId, file: annotation.file, test: annotation.testName ?? '(不明)' },
  });
}

/** 同じ `@tc` が複数のテストに付いている(仕組みの根の注釈が 1 つでも絡むもの。製品の木の注釈とも合算して数える)。 */
function duplicateFindings(
  framework: readonly TestAnnotation[],
  product: readonly TestAnnotation[],
): Finding[] {
  const inFramework = groupByTcId(framework);
  const all = groupByTcId([...framework, ...product]);
  const findings: Finding[] = [];
  for (const tcId of inFramework.keys()) {
    const group = all.get(tcId) ?? [];
    const first = group[0];
    if (group.length < 2 || first === undefined) continue;
    const places = group.map((annotation) => `${annotation.file}:${annotation.line}`).join(', ');
    findings.push(
      makeFinding(VERIFIER_ID, {
        message: `"@tc ${tcId}" が複数のテストに付いています(仕組みの根と製品の木をまたいで数えています)`,
        location: { file: first.file, pointer: `L${first.line}` },
        suggestion: 'テストケース ID とテストは 1 対 1 にする。片方に別の ID を振って、保証台帳の test_cases にも足す',
        counterexample: { tc: tcId, places },
      }),
    );
  }
  return findings;
}

/** 注釈を 1 つも持たないテストファイル(仕組みの根には未処理台帳が無い。全ファイルが保証の見張りである)。 */
function untaggedFinding(file: string): Finding {
  return makeFinding(VERIFIER_ID, {
    message: `${file} は @tc の注釈を 1 つも持たない仕組みの根のテストファイルです`,
    location: { file },
    suggestion:
      `仕組みの見張りテストの置き場(${FRAMEWORK_TEST_ROOTS.join(' / ')})のテストは、すべて保証の見張りとして ` +
      '`// @spec framework-guarantee-catalog @tc TC-FW-…` を付け、仕組みの台帳の test_cases に宣言する。保証の見張りでないテストはこの置き場に置かない',
    counterexample: { file },
  });
}
