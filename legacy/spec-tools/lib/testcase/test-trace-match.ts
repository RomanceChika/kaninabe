/**
 * 仕様の `test_cases` とテストコードの `@tc` を突き合わせる共通処理(仕様 → テストの方向)。
 *
 * この突合は action_spec(A6)と query_spec(Q6)で完全に同じ規則であり、
 * 「宣言したテストが本当に存在するか」を 3 段で見る。
 * 1. `implementation` のパスがテストファイルとして実在するか。
 * 2. そのファイルに `@tc {id}` のアノテーションがあるか。
 * 3. アノテーションが飾っているテスト名が `implementation` の `::` 以降と一致するか。
 *
 * 検証器 ID(A6 / Q6 など)だけを引数で受け取り、メッセージ・対処・反例は共通にする
 * (どの群から出た指摘でも読み方が同じになるようにするため)。
 *
 * **置き場**: この突合は action / query / screen / auth / guarantee / external / data / usecase の
 * 8 種類の検査が使う共有の口で、どの種類のモデルも読まない(台帳のエントリ・走査結果・kernel の `Finding` だけ)。
 * 以前は `lib/trace/` にいて、`lib/usecase/` の Y9 が trace のディレクトリを読む形になっていた(種類のディレクトリの
 * 相互依存)ので、テストケースの共有の語彙と同じ `lib/testcase/` に置く(設計メモ framework-modules §13・§14)。
 * 突合の起点は仕様モデルではなく**テストケース ID 台帳**(lib/spec-index)のエントリであり、
 * 逆方向(orphan)と ID の一意性(A9)も同じ台帳を母集合にして見る。
 */

import { makeFinding, type Finding } from '../kernel/finding.js';
import { absentFor, type ScopeOwner } from '../kernel/scope-owner.js';
import type { TcRegistryEntry, TestAnnotation } from './types.js';

/**
 * アノテーションを `@tc` の値でまとめる(重複検出のため配列で保持する)。
 *
 * @param annotations app/ の走査で見つかった全アノテーション
 * @returns `@tc` の値 → そのアノテーションの一覧
 */
export function groupByTcId(
  annotations: readonly TestAnnotation[],
): ReadonlyMap<string, readonly TestAnnotation[]> {
  const grouped = new Map<string, TestAnnotation[]>();
  for (const annotation of annotations) {
    const bucket = grouped.get(annotation.tcId);
    if (bucket === undefined) grouped.set(annotation.tcId, [annotation]);
    else bucket.push(annotation);
  }
  return grouped;
}

/**
 * 1 件のテストケースを 3 段で突合する。
 *
 * @param testCase 台帳のエントリ(= 仕様側の宣言 1 件)
 * @param annotations その ID を持つアノテーション(0 件でもよい)
 * @param testFiles 実在するテストファイル(リポジトリルート相対)
 * @param verifier 指摘に付ける検証器 ID("A6" / "Q6")
 * @param owner 実装の範囲の持ち主。**必須**(省略して印を外さない)。`null` は仕組み自身の見張りテストの台帳で、印を付けない。
 *   持ち主があるとき、`@tc` がどこにも無い純粋な不在(ファイルが無い・ファイルはあるが `@tc` が無い)の error にだけ印を付ける。
 *   `@tc` が 1 つでもあれば(別のファイル・名前の食い違い・`spec_ids`)印は付けず、突合の全部を行う
 * @returns 違反のリスト。突合できていれば空
 */
export function checkTestCaseTrace(
  testCase: TcRegistryEntry,
  annotations: readonly TestAnnotation[],
  testFiles: ReadonlySet<string>,
  verifier: string,
  owner: ScopeOwner | null,
): Finding[] {
  const impl = testCase.implementation;
  // 印は「その tc の `@tc` がどこにも無い」ときだけ(1 つでもあれば、範囲の外でも突合の全部を行う)。
  const pureAbsence = owner !== null && annotations.length === 0;
  const tag = (finding: Finding): Finding => (pureAbsence ? absentFor(owner, finding) : finding);
  if (!testFiles.has(impl.file)) {
    return [tag(missingFileFinding(testCase, verifier))];
  }
  const inFile = annotations.filter((annotation) => annotation.file === impl.file);
  if (inFile.length === 0) {
    return [tag(uncoveredFinding(testCase, annotations, verifier))];
  }
  return inFile.flatMap((annotation) => checkAnnotation(testCase, annotation, verifier));
}

/** アノテーション 1 件とテストケースの中身(テスト名・spec_ids)を突き合わせる。 */
function checkAnnotation(
  testCase: TcRegistryEntry,
  annotation: TestAnnotation,
  verifier: string,
): Finding[] {
  const findings: Finding[] = [];
  const expected = testCase.implementation.testName;
  if (annotation.testName === null) {
    findings.push(unnamedFinding(testCase, annotation, verifier));
  } else if (annotation.testName !== expected) {
    findings.push(nameMismatchFinding(testCase, annotation, verifier));
  }
  const declared = [...testCase.specIds].sort().join(' ');
  const annotated = [...annotation.specIds].sort().join(' ');
  if (annotated !== '' && annotated !== declared) {
    findings.push(specIdsMismatchFinding(testCase, annotation, declared, annotated, verifier));
  }
  return findings;
}

function missingFileFinding(testCase: TcRegistryEntry, verifier: string): Finding {
  return makeFinding(verifier, {
    message: `${testCase.tcId} の implementation が指すテストファイルがありません`,
    location: testCase.location,
    suggestion:
      `${testCase.implementation.file} を作って "// @tc ${testCase.tcId}" を付けたテストを書くか、` +
      'implementation のパスを実在するテストファイルへ直す(パスはリポジトリルートから)',
    counterexample: { test_case: testCase.tcId, file: testCase.implementation.file },
  });
}

function uncoveredFinding(
  testCase: TcRegistryEntry,
  elsewhere: readonly TestAnnotation[],
  verifier: string,
): Finding {
  const found = elsewhere.map((annotation) => annotation.file).join(', ');
  return makeFinding(verifier, {
    message:
      elsewhere.length === 0
        ? `${testCase.tcId} に対応する "@tc ${testCase.tcId}" がテストコードにありません`
        : `${testCase.tcId} の "@tc" は別のファイルにあります`,
    location: testCase.location,
    suggestion:
      elsewhere.length === 0
        ? `${testCase.implementation.file} の "${testCase.implementation.testName}" の直前に ` +
          `"// @spec ${testCase.specIds.join(' ')} @tc ${testCase.tcId}" を書く`
        : `implementation のパスを ${found} に直すか、アノテーションを ${testCase.implementation.file} へ移す`,
    counterexample: {
      test_case: testCase.tcId,
      expected_file: testCase.implementation.file,
      ...(elsewhere.length === 0 ? {} : { found_in: found }),
    },
  });
}

function unnamedFinding(
  testCase: TcRegistryEntry,
  annotation: TestAnnotation,
  verifier: string,
): Finding {
  return makeFinding(verifier, {
    message: `${testCase.tcId} のアノテーションが飾っているテストを特定できません`,
    location: { file: annotation.file, pointer: `L${annotation.line}` },
    suggestion:
      `"// @tc ${testCase.tcId}" の直後に it("${testCase.implementation.testName}", ...) を置く` +
      '(アノテーションは直後のテスト宣言を飾る)',
    counterexample: { test_case: testCase.tcId, line: String(annotation.line) },
  });
}

function nameMismatchFinding(
  testCase: TcRegistryEntry,
  annotation: TestAnnotation,
  verifier: string,
): Finding {
  return makeFinding(verifier, {
    message: `${testCase.tcId} のテスト名が implementation と一致しません`,
    location: testCase.location,
    suggestion:
      `implementation を "${testCase.implementation.file}::${annotation.testName ?? ''}" に直すか、` +
      `テスト名を "${testCase.implementation.testName}" に直す`,
    counterexample: {
      test_case: testCase.tcId,
      spec_side: testCase.implementation.testName,
      test_side: annotation.testName ?? '(不明)',
    },
  });
}

function specIdsMismatchFinding(
  testCase: TcRegistryEntry,
  annotation: TestAnnotation,
  declared: string,
  annotated: string,
  verifier: string,
): Finding {
  return makeFinding(verifier, {
    severity: 'warning',
    message: `${testCase.tcId} の spec_ids とテスト側の @spec が一致しません`,
    location: testCase.location,
    suggestion:
      `どちらが正かを決めて揃える(仕様側 spec_ids: [${testCase.specIds.join(', ')}] / ` +
      `テスト側 @spec: ${annotation.specIds.join(' ')})`,
    counterexample: {
      test_case: testCase.tcId,
      spec_ids: declared,
      annotation: annotated,
      file: annotation.file,
    },
  });
}
