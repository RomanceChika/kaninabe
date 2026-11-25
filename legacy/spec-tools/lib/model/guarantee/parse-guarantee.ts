/**
 * guarantee_spec(保証台帳)のパーサー(Z0 = スキーマ適合 + 語彙の閉世界 + 見張りテストの閉世界)。
 *
 * スキーマの正: guarantee-spec-writing.md。
 * ここで見るのは 1 ファイルの中で閉じる形だけである — `enforced_by` が**同じファイルが
 * 宣言した語彙**に載っていること(語彙の一覧を体系側に持たないための形)、`status` が
 * フレームワーク固定の値域にあること、そして **`status` と `canaries` / `planned_reason`
 * の対応**(`enforced` は見張りテスト必須、`planned` は理由必須)である。
 *
 * **見張りテストの閉世界もここで見る**(H0 / N0 / K0 には無い、このカタログ固有の検査)。
 * 「見張りテストを宣言していない保証はエラー」を機械にするには、保証からテストケースへの参照(`canaries`)が
 * 実在することと、その逆(どの保証からも参照されないテストケース = 孤児の見張りテスト)が
 * 無いことの両方を見る必要がある。どちらも 1 ファイルの中で閉じる事実なので Z0 の担当であり、
 * 実装テストへの接地(`@tc` との突合)は Z1 が別に見る。行ごとの読み取りと見張りテストの突合は
 * parse-guarantee-rows.ts が持つ。
 */

import type { SpecReporter } from '../parse-common.js';
import type { LedgerOwner } from '../../kernel/ledger-owner.js';
import { checkDocType, META_FRONTMATTER_KEYS, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { parseTestCases } from '../parse-test-case.js';
import type { GuaranteeCatalogSpec, GuaranteeDecl, GuaranteeTermDecl, GuaranteeVocabularyAxis } from './types.js';
import { GUARANTEE_VOCABULARY_AXES } from './types.js';
import { buildGuarantee, checkCanaries } from './parse-guarantee-rows.js';
import { catalogIdOf, checkNamespace } from './namespace.js';

/** 識別子(スネークケース)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** guarantee_spec のトップレベルに書けるキー。 */
const SPEC_KEYS: readonly string[] = [...META_FRONTMATTER_KEYS, 'vocabulary', 'guarantees', 'test_cases'];

/** guarantees の 1 要素に書けるキー。 */
const GUARANTEE_KEYS: readonly string[] = [
  'id',
  'label',
  'enforced_by',
  'status',
  'canaries',
  'planned_reason',
  'summary',
];

const VOCABULARY_SUGGESTION =
  'vocabulary に enforcer(執行者)の語彙を "- id / label" のリストで宣言する' +
  '(語彙はこのアプリの事情なので体系側に持たない — guarantee-spec-writing.md)';

/** 知らないキーを見つけたときに示す共通の直し方。 */
function unknownKeyHint(allowed: readonly string[]): string {
  return `書けるのは ${allowed.join(' / ')} だけ。綴り違いを直す`;
}

/**
 * 保証台帳 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @param options `owner` は台帳の持ち主(省略は製品。仕組みの台帳は名前空間の予約と文書 ID が別 — namespace.ts)
 * @returns 構築したカタログと Z0 違反
 */
export function parseGuaranteeCatalog(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
  options: { readonly owner?: LedgerOwner } = {},
): ParseResult<GuaranteeCatalogSpec> {
  const owner = options.owner ?? 'product';
  const expectedId = catalogIdOf(owner);
  checkDocType(data, 'guarantee_spec', reporter);
  const root = new YamlReader(data, '', reporter);
  root.rejectUnknownKeys(SPEC_KEYS, 'guarantee_spec', unknownKeyHint(SPEC_KEYS));

  const id = root.requiredString('id', `id を ${expectedId} と書く(台帳 1 本につき 1 つ)`);
  if (id !== null && id !== expectedId) {
    reporter.error('id', `id ${id} はカタログの id ではありません`, `id: ${expectedId} に直す`, {
      id,
      expected: expectedId,
    });
  }
  const vocabulary = parseVocabulary(root, reporter);
  const guarantees = parseGuarantees(root, vocabulary, reporter);
  const testCases = parseTestCases(root, reporter) ?? [];
  checkCanaries(guarantees, testCases, reporter);
  checkNamespace(owner, guarantees, testCases, reporter);

  return {
    value: {
      id: expectedId,
      vocabulary,
      guarantees,
      testCases,
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

/** vocabulary を軸ごとに読む。軸そのものは体系が持ち、語彙は仕様が宣言する。 */
function parseVocabulary(
  root: YamlReader,
  reporter: SpecReporter,
): Record<GuaranteeVocabularyAxis, readonly GuaranteeTermDecl[]> {
  const raw = root.raw('vocabulary');
  const reader =
    raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)
      ? null
      : new YamlReader(raw as Readonly<Record<string, unknown>>, 'vocabulary', reporter);
  if (reader === null) {
    reporter.error('vocabulary', 'vocabulary がありません', VOCABULARY_SUGGESTION);
    reporter.dropRows();
  }
  const result = {} as Record<GuaranteeVocabularyAxis, readonly GuaranteeTermDecl[]>;
  for (const axis of GUARANTEE_VOCABULARY_AXES) {
    result[axis] = reader === null ? [] : parseTerms(reader, axis, reporter);
  }
  return result;
}

/** 1 軸分の語彙を読む。重複した語は突合キーが壊れるのでここで落とす。 */
function parseTerms(
  reader: YamlReader,
  axis: GuaranteeVocabularyAxis,
  reporter: SpecReporter,
): readonly GuaranteeTermDecl[] {
  const items = reader.optionalList(axis, VOCABULARY_SUGGESTION);
  if (items.length === 0) {
    reporter.error(`vocabulary.${axis}`, `vocabulary.${axis} が空です`, VOCABULARY_SUGGESTION);
    return [];
  }
  const terms: GuaranteeTermDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, `vocabulary.${axis}`, reporter, VOCABULARY_SUGGESTION, (item, index) => {
    const id = item.requiredString('id', `id に ${axis} の語(スネークケース)を書く`);
    if (id === null) return;
    if (!SNAKE.test(id)) {
      reporter.error(item.pointer('id'), `${axis} の語 ${id} がスネークケースではありません`, VOCABULARY_SUGGESTION, {
        id,
      });
      return;
    }
    if (seen.has(id)) {
      reporter.error(`vocabulary.${axis}[${index}].id`, `${axis} の語 ${id} が重複しています`, '重複した要素を削除する', {
        id,
      });
      duplicates += 1;
      return;
    }
    seen.add(id);
    const label = item.optionalLabel('label', 'label に人間向けの表示名を書く(未定なら書かない)');
    terms.push({ id, ...(label === undefined ? {} : { label }) });
  });
  reporter.settleRows(items.length, terms.length, duplicates);
  return terms;
}

/** guarantees を読む。行の enforcer は宣言された vocabulary に閉じていなければならない。 */
function parseGuarantees(
  root: YamlReader,
  vocabulary: Readonly<Record<GuaranteeVocabularyAxis, readonly GuaranteeTermDecl[]>>,
  reporter: SpecReporter,
): readonly GuaranteeDecl[] {
  const suggestion =
    'guarantees は "- id / label / enforced_by / status / (canaries) / (planned_reason) / summary" のリストで書く';
  const items = root.requiredList('guarantees', suggestion) ?? [];
  const guarantees: GuaranteeDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'guarantees', reporter, suggestion, (item, index) => {
    const id = item.requiredString('id', 'id に保証の名前(スネークケース)を書く');
    if (id === null) return;
    if (!SNAKE.test(id)) {
      reporter.error(item.pointer('id'), `保証 ${id} がスネークケースではありません`, 'スネークケースに直す', { id });
      return;
    }
    if (seen.has(id)) {
      reporter.error(`guarantees[${index}].id`, `保証 ${id} が重複しています`, '重複した行を削除する', { id });
      duplicates += 1;
      return;
    }
    seen.add(id);
    item.rejectUnknownKeys(GUARANTEE_KEYS, `保証 ${id}`, unknownKeyHint(GUARANTEE_KEYS));
    const decl = buildGuarantee(item, id, vocabulary, reporter);
    if (decl !== null) guarantees.push(decl);
  });
  reporter.settleRows(items.length, guarantees.length, duplicates);
  return guarantees;
}
