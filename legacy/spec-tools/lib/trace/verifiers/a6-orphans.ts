/**
 * A6 テスト突合チェック(テスト → 仕様の方向)。
 *
 * 仕様側から見た欠落(uncovered)は a6-test-trace.ts が見る。こちらが見るのは逆方向で、
 * action-spec-writing.md の「テスト側に仕様の記載が無い = orphan」に当たる。
 * 併せて、突合キーが一意であるためのテスト側の重複も見る。
 *
 * - orphan:            テストに `@tc X` があるが、どの仕様の test_cases にも X が無い
 *                      (母集合はテストケース ID 台帳。仕様種を問わない)。
 * - テスト側の重複:      同じ `@tc X` が複数のテストに付いている(どれが X なのか決まらない)。
 * - 見ていない:          読めずに落とした data_table の名前空間の `@tc`(表の ID の系統の接頭辞 + 表名か entity 名。
 *                      台帳に落とした表の test_cases は載らないので、台帳に無いことから orphan とは言えない)。orphan にせず、`unseen` で名指して返す。
 *
 * 仕様側の重複(同じ ID を複数の仕様が宣言している)は仕様種をまたぐ性質なので、
 * 台帳を見る A9 が一括して担う(A6 では見ない)。
 */

import type { Finding } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { TestAnnotation, TcRegistryEntry } from '../../testcase/types.js';
import { SPEC_KIND_LIST } from '../../testcase/index.js';
import { droppedTableEntitiesOf, droppedTableFilesOf, type TraceInput } from '../input.js';
import { droppedTableOfTcId } from '../../model/data/dropped-tables.js';

/** 台帳が受け付ける仕様種の並び(指摘の文面に出す。仕様種が増えたら台帳側の 1 行で追随する)。 */
const SPEC_KINDS = SPEC_KIND_LIST.join(' / ');

/** `checkTestSide` の結果。 */
export interface TestSideResult {
  /** orphan・テスト側の重複の違反。 */
  readonly findings: Finding[];
  /** 落とした表の名前空間にあるため、orphan かどうかを判定しなかった `@tc`(重複なし・出現順)。 */
  readonly unseen: readonly string[];
}

/**
 * テスト側から仕様側への突合(orphan)と、テスト側の `@tc` 重複を検証する。
 *
 * @param input トレース検証への入力全体
 * @param byTcId `@tc` の値でまとめたアノテーション(a6-test-trace.ts が構築したもの)
 * @returns 違反のリストと、判定しなかった `@tc`
 */
export function checkTestSide(
  input: TraceInput,
  byTcId: ReadonlyMap<string, readonly TestAnnotation[]>,
): TestSideResult {
  const scanTcIds = scanTestCaseIds(input);
  const droppedFiles = droppedTableFilesOf(input);
  const droppedEntities = droppedTableEntitiesOf(input);
  const findings: Finding[] = [];
  const unseen: string[] = [];
  for (const [tcId, annotations] of byTcId) {
    const declared = input.registry.find(tcId);
    if (declared.length === 0) {
      // scans[].test_cases(A10 のテスト義務)は台帳の外にある(A10 が独自に突合する)。
      // ここで見逃さないと、close_deadline のような system 専用イベントの注釈が
      // 「どの仕様にも無い」と orphan 判定されてしまう。
      if (scanTcIds.has(tcId)) continue;
      // 落とした表の名前空間の @tc は、その表の test_cases が台帳に無いだけ(宣言が無いとは言えない)。判定せず、見ていないことを返す。
      if (droppedTableOfTcId(tcId, droppedFiles, droppedEntities) !== null) {
        unseen.push(tcId);
        continue;
      }
      findings.push(...annotations.map(orphanFinding));
      continue;
    }
    // 宣言がどの仕様種のものであっても、同じ @tc が複数のテストに付けば突合キーが壊れる。
    const first = annotations[0];
    if (annotations.length > 1 && first !== undefined) {
      findings.push(duplicateAnnotationFinding(tcId, annotations, first, declared));
    }
  }
  return { findings, unseen };
}

/** `scans[].test_cases` に宣言された全 ID(A10 が独自に突合するため、台帳の外にある)。 */
function scanTestCaseIds(input: TraceInput): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const scan of input.actions.scans) {
    for (const testCase of scan.testCases ?? []) ids.add(testCase.id);
  }
  return ids;
}

/** どの仕様にも宣言が無い `@tc`(母集合は台帳なので、仕様種を問わず「どこにも無い」)。 */
function orphanFinding(annotation: TestAnnotation): Finding {
  return traceFinding('A6', {
    message:
      `テストの "@tc ${annotation.tcId}" に対応するテストケースが、` +
      `どの仕様(${SPEC_KINDS})の test_cases にもありません`,
    location: { file: annotation.file, pointer: `L${annotation.line}` },
    suggestion:
      `対応する仕様の test_cases に "- id: ${annotation.tcId}" を追加する` +
      '(書き込みの操作なら action_spec、読み取り経路なら query_spec、画面の配線なら screen_spec。' +
      `implementation: ${annotation.file}::${annotation.testName ?? '{テスト名}'})。` +
      'このテストが仕様と結び付かないなら @tc を外す',
    counterexample: {
      tc: annotation.tcId,
      file: annotation.file,
      test: annotation.testName ?? '(不明)',
    },
  });
}

/**
 * 同じ `@tc` が複数のテストに付いている。
 *
 * 宣言元は台帳から引けるので、対処では「どの仕様に足すか」を仕様種つきで示す
 * (仕様種を決め打ちにすると、query_spec のテストで誤った指示になる)。
 */
function duplicateAnnotationFinding(
  tcId: string,
  annotations: readonly TestAnnotation[],
  first: TestAnnotation,
  declared: readonly TcRegistryEntry[],
): Finding {
  const places = annotations.map((a) => `${a.file}:${a.line}`).join(', ');
  const origin = declared.map((entry) => `${entry.specKind} ${entry.specId}`).join(' / ');
  return traceFinding('A6', {
    message: `"@tc ${tcId}" が複数のテストに付いています`,
    location: { file: first.file, pointer: `L${first.line}` },
    suggestion:
      'テストケース ID とテストは 1 対 1 にする。片方に別の ID を振って、' +
      `宣言元の仕様(${origin})の test_cases にも追加する(該当: ${places})`,
    counterexample: { tc: tcId, places, declared_in: origin },
  });
}
