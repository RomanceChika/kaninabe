/**
 * ux_principles_spec(UX 原則の台帳)のパーサー(U8 のスキーマ適合の部分)。
 *
 * ここで見るのは 1 ファイルの中で閉じる形だけである — 必須キー・`id` の形と一意・`budget.limit` が
 * 正の整数であること・`affects` が閉じた値域にあること・`statement` が 1 文であること。
 * `enforced_by` が実在する検査 ID か・既存の検査の行が揃っているかは、検査器の一覧を引く
 * `verify.ts`(同じ U8)の担当である(ここが検査器を import すると、検査器が台帳を読む向きと循環する)。
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord, checkDocType, META_FRONTMATTER_KEYS, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { UxPrincipleBudget, UxPrincipleDecl, UxPrinciplesSpec } from './types.js';
import { UX_PRINCIPLE_AFFECTS, UX_PRINCIPLES_ID, type UxPrincipleAffects } from './types.js';

/** 原則の ID の形(`U1` / `Y5-steps`)。 */
const PRINCIPLE_ID = /^[A-Z][0-9]+(-[a-z][a-z0-9_]*)?$/;

/** 台帳のトップレベルに書けるキー。 */
const SPEC_KEYS: readonly string[] = [...META_FRONTMATTER_KEYS, 'principles'];

/** principles の 1 要素に書けるキー。 */
const PRINCIPLE_KEYS: readonly string[] = ['id', 'statement', 'derives', 'enforced_by', 'budget', 'affects'];

const ROW_SUGGESTION =
  'principles は "- id / statement / enforced_by / (derives) / (budget) / (affects)" のリストで書く(ux-lint.md §台帳)';

/** 知らないキーを見つけたときの共通の直し方。 */
function unknownKeyHint(allowed: readonly string[]): string {
  return `書けるのは ${allowed.join(' / ')} だけ。綴り違いを直す`;
}

/**
 * 台帳 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @returns 構築した台帳と違反
 */
export function parseUxPrinciples(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ParseResult<UxPrinciplesSpec> {
  checkDocType(data, 'ux_principles_spec', reporter);
  const root = new YamlReader(data, '', reporter);
  root.rejectUnknownKeys(SPEC_KEYS, 'ux_principles_spec', unknownKeyHint(SPEC_KEYS));

  const id = root.requiredString('id', `id を ${UX_PRINCIPLES_ID} と書く(1 プロジェクト 1 枚)`);
  if (id !== null && id !== UX_PRINCIPLES_ID) {
    reporter.error('id', `id ${id} は UX 原則の台帳の id ではありません`, `id: ${UX_PRINCIPLES_ID} に直す`, {
      id,
      expected: UX_PRINCIPLES_ID,
    });
  }
  const principles = parsePrinciples(root, reporter);
  return {
    value: { id: UX_PRINCIPLES_ID, principles, location: reporter.location() },
    findings: reporter.findings(),
  };
}

/** principles を読む。重複した id の行は、突合の鍵が壊れるので落とす(重複の判定は id の形を見た直後 = 残りの欄を読む前。他の種類と同じ順)。 */
function parsePrinciples(root: YamlReader, reporter: SpecReporter): readonly UxPrincipleDecl[] {
  const items = root.requiredList('principles', ROW_SUGGESTION) ?? [];
  const decls: UxPrincipleDecl[] = [];
  const ids = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'principles', reporter, ROW_SUGGESTION, (item, index) => {
    item.rejectUnknownKeys(PRINCIPLE_KEYS, `principles[${index}]`, unknownKeyHint(PRINCIPLE_KEYS));
    const head = readHead(item, reporter);
    if (head === null) return;
    if (ids.has(head.id)) {
      reporter.error(`principles[${index}].id`, `id ${head.id} が重複しています`, '重複した行を消すか、id を分ける', {
        id: head.id,
      });
      duplicates += 1;
      return;
    }
    ids.add(head.id);
    decls.push(buildPrinciple(item, head, reporter));
  });
  reporter.settleRows(items.length, decls.length, duplicates);
  return decls;
}

/** 行の必須の 3 欄(重複の判定に要る分)。 */
interface PrincipleHead {
  readonly id: string;
  readonly statement: string;
  readonly enforcedBy: string;
}

/** 行の必須の欄を読む。1 つでも読めなければ・形が違えば行ごと落とす(null)。 */
function readHead(item: YamlReader, reporter: SpecReporter): PrincipleHead | null {
  const id = item.requiredString('id', 'id に原則の ID(U1 / Y5-steps の形)を書く');
  const statement = item.requiredString('statement', 'statement に原則を日本語 1 文で書く');
  const enforcedBy = item.requiredString('enforced_by', 'enforced_by に見張る検査の ID か advisory を書く');
  if (id === null || statement === null || enforcedBy === null) return null;
  if (!PRINCIPLE_ID.test(id)) {
    reporter.error(item.pointer('id'), `id ${id} が原則の ID の形ではありません`, '"U4" や "Y5-steps" の形で書く', { id });
    return null;
  }
  if (statement.trim() === '') {
    reporter.error(item.pointer('statement'), 'statement が空です', 'statement に原則を日本語 1 文で書く');
    return null;
  }
  return { id, statement, enforcedBy };
}

/** 残りの欄(derives / budget / affects)を読んで 1 行を作る。 */
function buildPrinciple(item: YamlReader, head: PrincipleHead, reporter: SpecReporter): UxPrincipleDecl {
  const { id, statement, enforcedBy } = head;
  const derives = item.optionalStringList('derives', 'derives は出どころの文字列のリストで書く');
  const budget = readBudget(item, reporter);
  const affects = readAffects(item, reporter);
  checkOneSentence(item, statement, reporter);
  return {
    id,
    statement,
    derives,
    enforcedBy,
    ...(budget === undefined ? {} : { budget }),
    ...(affects === undefined ? {} : { affects }),
    location: reporter.location(`principles.${id}`),
  };
}

/** `statement` が 1 文であること(句点で区切られた文が 2 つ以上なら error)。宣言は落とさない。 */
function checkOneSentence(item: YamlReader, statement: string, reporter: SpecReporter): void {
  const sentences = statement.split('。').filter((part) => part.trim() !== '').length;
  if (sentences <= 1) return;
  reporter.error(
    item.pointer('statement'),
    `statement が ${sentences} 文です(1 文で言い切る)`,
    '2 文目の補足は、ux-lint.md の本文に書く(台帳の文は表とハンドブックに 1 行で出る)',
    { statement },
  );
}

/**
 * `budget: { limit: N }` を読む。閉じたキー・正の整数だけ。省略は undefined。
 * 書かれたのに読めなかった閾値は、既定値に黙って戻らないよう error で名指す(型違いは落とした行として数える。値が無い = `limit: null` と欠落(キー無し)は error だけで数えない)。
 */
function readBudget(item: YamlReader, reporter: SpecReporter): UxPrincipleBudget | undefined {
  const raw = item.raw('budget');
  if (raw === undefined || raw === null) return undefined;
  const suggestion = 'budget は "{ limit: 正の整数 }" で書く(例: budget: { limit: 7 })';
  const record = asRecord(raw);
  if (record === null) {
    reporter.error(item.pointer('budget'), 'budget はマッピングで書きます', suggestion);
    reporter.dropRows();
    return undefined;
  }
  const reader = new YamlReader(record, item.pointer('budget'), reporter);
  reader.rejectUnknownKeys(['limit'], 'budget', suggestion);
  const limit = reader.optionalNumber('limit', suggestion);
  if (limit === undefined) {
    if (reader.raw('limit') === null) {
      // 値が無い(null / 欠落)のは読み飛ばした宣言ではない。error で名指すだけで数えない(型違いは optionalNumber が数え済み。usecases の budget も同じ基準)。
      reporter.error(reader.pointer('limit'), 'budget.limit が null です(値が読めません)', suggestion);
      return undefined;
    }
    if (!reader.has('limit')) {
      // 欠落(キー無し)も null と同じ基準: 値が無いのは読み飛ばした宣言ではない。error で名指すだけで数えない(阻害にしない)。
      reporter.error(reader.pointer('limit'), 'budget に limit がありません', suggestion);
    }
    return undefined;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    reporter.error(reader.pointer('limit'), `limit ${limit} が正の整数ではありません`, suggestion, { limit: String(limit) });
    reporter.dropRows();
    return undefined;
  }
  return { limit };
}

/** `affects` を読む。閉じた値域の外は error。省略は undefined。 */
function readAffects(item: YamlReader, reporter: SpecReporter): UxPrincipleAffects | undefined {
  const value = item.optionalString('affects', `affects は ${UX_PRINCIPLE_AFFECTS.join(' / ')} のいずれかで書く`);
  if (value === undefined) return undefined;
  const known = (UX_PRINCIPLE_AFFECTS as readonly string[]).includes(value);
  if (known) return value as UxPrincipleAffects;
  reporter.error(
    item.pointer('affects'),
    `affects ${value} は属性の名前の値域(${UX_PRINCIPLE_AFFECTS.join(' / ')})にありません`,
    '台帳が名指しできるのは、生成物が引く属性の名前だけ。新しい属性が要るなら先に属性の導出(operation-attributes)を足す',
    { affects: value },
  );
  reporter.dropRows();
  return undefined;
}
