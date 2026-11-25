/**
 * guarantee_spec の `guarantees` 1 行分の読み取りと、`canaries` ⇔ `test_cases` の閉世界。
 *
 * parse-guarantee.ts が呼ぶ下位の部品で、責務は「1 行の妥当性」と「行を跨いだ見張りテストの
 * 双方向突合」に閉じる(vocabulary の読み取りは parse-guarantee.ts が持つ)。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type { ActionTestCase } from '../../testcase/types.js';
import type { GuaranteeDecl, GuaranteeStatus, GuaranteeTermDecl, GuaranteeVocabularyAxis } from './types.js';
import { GUARANTEE_STATUSES } from './types.js';

/**
 * 保証 1 行分を読む。1 つでも読めなければ行ごと落とす(null)。
 *
 * @param item 行のマッピング(`rejectUnknownKeys` は呼び出し側で済ませてある)
 * @param id 読み終えた保証 ID
 * @param vocabulary カタログが宣言した語彙(enforcer)
 * @param reporter 違反の記録先
 */
export function buildGuarantee(
  item: YamlReader,
  id: string,
  vocabulary: Readonly<Record<GuaranteeVocabularyAxis, readonly GuaranteeTermDecl[]>>,
  reporter: SpecReporter,
): GuaranteeDecl | null {
  const label = item.requiredString('label', 'label に「何が起こりえないか」を短く言い切る');
  const enforcedBy = parseEnforcedBy(item, id, vocabulary, reporter);
  const status = parseStatus(item, reporter);
  const summary = item.requiredString('summary', 'summary に「何をどう保証しているか」を書く');
  if (label === null || enforcedBy === null || status === null || summary === null) return null;

  // optionalStringList は欠落時に空配列を返す(undefined にならない)ため、"書いたかどうか" は
  // has() で別に見る。ここを取り違えると、書いていない canaries が「空配列で書いてある」
  // 扱いになり、status: planned の行が誤って canaries 違反になる。
  const canaries = item.has('canaries')
    ? item.optionalStringList('canaries', 'canaries に test_cases の id を 1 つ以上並べる')
    : undefined;
  const plannedReason = item.optionalString(
    'planned_reason',
    'planned_reason に「まだ執行されていない理由」を書く',
  );
  if (!checkStatusFields(id, status, canaries, plannedReason, item, reporter)) return null;

  return {
    id,
    label,
    enforcedBy,
    status,
    ...(status === 'enforced' ? { canaries: canaries ?? [] } : {}),
    ...(status === 'planned' && plannedReason !== undefined ? { plannedReason } : {}),
    summary,
    location: reporter.location(`guarantees.${id}`),
  };
}

/** `enforced_by`(1 つ以上のリスト)を読む。宣言された vocabulary.enforcer に閉じる。 */
function parseEnforcedBy(
  item: YamlReader,
  id: string,
  vocabulary: Readonly<Record<GuaranteeVocabularyAxis, readonly GuaranteeTermDecl[]>>,
  reporter: SpecReporter,
): readonly string[] | null {
  const suggestion = 'enforced_by に「何が守っているか」を vocabulary.enforcer の語で 1 つ以上書く';
  const values = item.requiredStringList('enforced_by', suggestion, false);
  if (values === null) return null;
  const known = vocabulary.enforcer.map((term) => term.id);
  for (const value of values) {
    if (known.includes(value)) continue;
    reporter.error(
      item.pointer('enforced_by'),
      `保証 ${id} の enforced_by ${value} は vocabulary.enforcer に宣言されていません`,
      `vocabulary.enforcer の語(${known.join(' / ') || '未宣言'})から選ぶか、語彙の側に足す`,
      { guarantee: id, enforcer: value },
    );
    return null;
  }
  return values;
}

/** `status` を値域として読む。 */
function parseStatus(item: YamlReader, reporter: SpecReporter): GuaranteeStatus | null {
  const suggestion = `status に ${GUARANTEE_STATUSES.join(' / ')} のいずれかを書く`;
  const value = item.requiredString('status', suggestion);
  if (value === null) return null;
  if ((GUARANTEE_STATUSES as readonly string[]).includes(value)) return value as GuaranteeStatus;
  reporter.error(
    item.pointer('status'),
    `status ${value} は値域(${GUARANTEE_STATUSES.join(' / ')})にありません`,
    suggestion,
    { status: value },
  );
  return null;
}

/**
 * `status` と `canaries` / `planned_reason` の対応を見る。
 *
 * `enforced` は見張りテストが 1 つ以上必須で `planned_reason` を書けない。`planned` は理由が
 * 必須で見張りテストを書けない — 「まだ執行していないのに見張りテストがある」「執行しているのに
 * 理由だけ書いてある」という中途半端な宣言を許さないためである。
 */
function checkStatusFields(
  id: string,
  status: GuaranteeStatus,
  canaries: readonly string[] | undefined,
  plannedReason: string | undefined,
  item: YamlReader,
  reporter: SpecReporter,
): boolean {
  if (status === 'enforced') {
    if (plannedReason !== undefined) {
      reporter.error(
        item.pointer('planned_reason'),
        `保証 ${id} は status: enforced なのに planned_reason があります`,
        'planned_reason を消す(理由が要るのは status: planned の行だけ)',
        { guarantee: id },
      );
      return false;
    }
    if (canaries === undefined || canaries.length === 0) {
      reporter.error(
        item.pointer('canaries'),
        `保証 ${id} は status: enforced なのに canaries がありません`,
        'canaries に test_cases の id を 1 つ以上書く(見張りテストを宣言していない保証は主張しているだけである)',
        { guarantee: id },
      );
      return false;
    }
    return true;
  }
  // status === 'planned'
  if (canaries !== undefined) {
    reporter.error(
      item.pointer('canaries'),
      `保証 ${id} は status: planned なのに canaries があります`,
      'canaries を消す(見張りテストが持てるのは status: enforced の行だけ)。' +
        '執行できているなら status を enforced に直す',
      { guarantee: id },
    );
    return false;
  }
  if (plannedReason === undefined) {
    reporter.error(
      item.pointer('planned_reason'),
      `保証 ${id} は status: planned なのに planned_reason がありません`,
      'planned_reason に「まだ執行されていない理由」を書く',
      { guarantee: id },
    );
    return false;
  }
  return true;
}

/**
 * `canaries` ⇔ `test_cases` を双方向に突き合わせる(1 ファイルの中で閉じる事実)。
 *
 * - 保証の `canaries` が指す id は `test_cases` に実在すること。
 * - `test_cases` の各行は、どこかの保証の `canaries` から参照されていること
 *   (**孤児の見張りテスト** — 宣言だけあって誰も保証していないテストケースを許さない)。
 * - 1 つの保証の `canaries` に同じ id を 2 度書かないこと(見張りテストの数を水増しして見せる宣言の重複。
 *   id の名指しで止める。台帳の表やハンドブックの件数が実体より多く出る)。
 *
 * @param guarantees 読み終えた保証の全数
 * @param testCases 読み終えたテストケースの全数
 * @param reporter 違反の記録先
 */
export function checkCanaries(
  guarantees: readonly GuaranteeDecl[],
  testCases: readonly ActionTestCase[],
  reporter: SpecReporter,
): void {
  const known = new Set(testCases.map((testCase) => testCase.id));
  const referenced = new Set<string>();
  for (const decl of guarantees) {
    const seen = new Set<string>();
    for (const canary of decl.canaries ?? []) {
      referenced.add(canary);
      if (seen.has(canary)) {
        reporter.error(
          `guarantees.${decl.id}.canaries`,
          `保証 ${decl.id} の canaries に ${canary} が重複しています`,
          `canaries の ${canary} を 1 つにする(同じ見張りテストを 2 度並べても保証は強くならず、件数だけが増えて見える)`,
          { guarantee: decl.id, canary },
        );
        continue;
      }
      seen.add(canary);
      if (known.has(canary)) continue;
      reporter.error(
        `guarantees.${decl.id}.canaries`,
        `保証 ${decl.id} の canaries ${canary} に対応する test_cases がありません`,
        `test_cases に "- id: ${canary}" を足すか、canaries を実在する id へ直す`,
        { guarantee: decl.id, canary },
      );
    }
  }
  for (const testCase of testCases) {
    if (referenced.has(testCase.id)) continue;
    reporter.error(
      `test_cases.${testCase.id}`,
      `テストケース ${testCase.id} はどの保証の canaries からも参照されていません(孤児の見張りテスト)`,
      'いずれかの保証の canaries に足すか、不要ならこのテストケースを削除する',
      { test_case: testCase.id },
    );
  }
}
