/**
 * term_ledger(用語の台帳)のパーサー(M11 = スキーマ適合 + 綴りの閉世界)。
 *
 * スキーマの正: term-ledger-writing.md。ここで見るのは 1 ファイルの中で閉じる形だけである ——
 * 必須キー・`origin` / `face` の値域・`id` と `term` の一意・`first` が相対パスであること・
 * **`gloss` が 1 文であること**、そして**台帳が自分で矛盾していないこと**(`avoid` が自分の `term` や別の語の `term` を禁じていない)。
 * 初出の実在(`first` の先)と旧綴りの走査は、本文を読む M7〜M9 の担当である。
 */

import type { SpecReporter } from '../parse-common.js';
import { checkDocType, META_FRONTMATTER_KEYS, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { TermDecl, TermLedgerSpec } from './types.js';
import { TERM_FACES, TERM_ORIGINS } from './types.js';

/** 台帳の文書 ID(1 プロジェクト 1 台帳なので導出元が無く固定)。 */
export const TERM_LEDGER_ID = 'term-ledger';

/** 識別子(スネークケース)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** term_ledger のトップレベルに書けるキー。 */
const SPEC_KEYS: readonly string[] = [...META_FRONTMATTER_KEYS, 'terms'];

/** terms の 1 要素に書けるキー。 */
const TERM_KEYS: readonly string[] = ['term', 'id', 'gloss', 'origin', 'first', 'face', 'avoid', 'not'];

const ROW_SUGGESTION =
  'terms は "- term / id / gloss / origin / first / face / (avoid) / (not)" のリストで書く(term-ledger-writing.md)';

/** 知らないキーを見つけたときに示す共通の直し方。 */
function unknownKeyHint(allowed: readonly string[]): string {
  return `書けるのは ${allowed.join(' / ')} だけ。綴り違いを直す`;
}

/**
 * 台帳 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @returns 構築した台帳と M11 違反
 */
export function parseTermLedger(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ParseResult<TermLedgerSpec> {
  checkDocType(data, 'term_ledger', reporter);
  const root = new YamlReader(data, '', reporter);
  root.rejectUnknownKeys(SPEC_KEYS, 'term_ledger', unknownKeyHint(SPEC_KEYS));

  const id = root.requiredString('id', `id を ${TERM_LEDGER_ID} と書く(1 プロジェクト 1 台帳)`);
  if (id !== null && id !== TERM_LEDGER_ID) {
    reporter.error('id', `id ${id} は台帳の id ではありません`, `id: ${TERM_LEDGER_ID} に直す`, {
      id,
      expected: TERM_LEDGER_ID,
    });
  }
  const terms = parseTerms(root, reporter);
  checkAvoidClosure(terms, reporter);
  return { value: { id: TERM_LEDGER_ID, terms, location: reporter.location() }, findings: reporter.findings() };
}

/** terms を読む。重複した id / term は突合の鍵が壊れるので、その行だけ落とす。 */
function parseTerms(root: YamlReader, reporter: SpecReporter): readonly TermDecl[] {
  const items = root.requiredList('terms', ROW_SUGGESTION) ?? [];
  const terms: TermDecl[] = [];
  const ids = new Set<string>();
  const words = new Set<string>();
  eachRecord(items, 'terms', reporter, ROW_SUGGESTION, (item, index) => {
    item.rejectUnknownKeys(TERM_KEYS, `terms[${index}]`, unknownKeyHint(TERM_KEYS));
    const decl = buildTerm(item, index, reporter);
    if (decl === null) return;
    if (ids.has(decl.id)) {
      reporter.error(`terms[${index}].id`, `id ${decl.id} が重複しています`, '重複した行を消すか、id を分ける', {
        id: decl.id,
      });
      return;
    }
    if (words.has(decl.term)) {
      reporter.error(`terms[${index}].term`, `term ${decl.term} が重複しています`, '1 つの語は 1 行だけ持つ', {
        term: decl.term,
      });
      return;
    }
    ids.add(decl.id);
    words.add(decl.term);
    terms.push(decl);
  });
  return terms;
}

/** 1 行を読む。1 つでも読めなければ行ごと落とす(null)。 */
function buildTerm(item: YamlReader, index: number, reporter: SpecReporter): TermDecl | null {
  const term = item.requiredString('term', 'term に本文で使う綴りを書く');
  const id = item.requiredString('id', 'id に英語の識別子(スネークケース)を書く');
  const gloss = item.requiredString('gloss', 'gloss に 1 行の定義を書く');
  const origin = closedValue(item, 'origin', TERM_ORIGINS, reporter);
  const first = item.requiredString('first', 'first に語を導入している文書のパスを書く');
  const face = closedValue(item, 'face', TERM_FACES, reporter);
  const avoid = readAvoid(item, reporter);
  const notUsage = readNot(item, reporter);
  if (term === null || id === null || gloss === null || origin === null || first === null || face === null) {
    return null;
  }
  const problems = [
    nonEmpty(item, 'term', term, reporter),
    nonEmpty(item, 'gloss', gloss, reporter),
    checkId(item, id, reporter),
    checkFirst(item, first, reporter),
  ];
  if (problems.includes(false)) return null;
  checkOneSentence(item, gloss, reporter);
  return {
    term,
    id,
    gloss,
    origin,
    first,
    face,
    avoid,
    not: notUsage,
    location: reporter.location(`terms.${id}`),
  };
}

/**
 * `not`(この語を使わない用法)を読む。省略は null。空・複数行は書けない。
 *
 * 空の値は「書いたのに書いていない」宣言であり、複数行は 1 行の欄に散文を流し込む形である
 * (禁じる用法は 1 行で言い切れる範囲に絞る)。**宣言を落とさず値だけ捨てる**: 用法の注意書きが
 * 壊れても語そのものの宣言(`term` / `avoid` の執行)は有効のままにしておく。
 */
function readNot(item: YamlReader, reporter: SpecReporter): string | null {
  const value = item.optionalString('not', 'not はこの語を使わない用法を 1 行の文字列で書く');
  if (value === undefined) return null;
  if (value.trim() === '') {
    reporter.error(item.pointer('not'), 'not が空です', 'not に内容を書くか、欄ごと消す');
    return null;
  }
  if (/[\r\n]/.test(value.trim())) {
    reporter.error(item.pointer('not'), 'not が複数行です', 'not は 1 行で言い切る(長い説明は first の文書に書く)');
    return null;
  }
  return value.trim();
}

/** 値域の値を読む。 */
function closedValue<T extends string>(
  item: YamlReader,
  key: string,
  allowed: readonly T[],
  reporter: SpecReporter,
): T | null {
  const suggestion = `${key} に ${allowed.join(' / ')} のいずれかを書く`;
  const value = item.requiredString(key, suggestion);
  if (value === null) return null;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  reporter.error(item.pointer(key), `${key} ${value} は値域(${allowed.join(' / ')})にありません`, suggestion, {
    [key]: value,
  });
  return null;
}

/** 空白だけの値は「書いたのに書いていない」宣言なので落とす。 */
function nonEmpty(item: YamlReader, key: string, value: string, reporter: SpecReporter): boolean {
  if (value.trim() !== '') return true;
  reporter.error(item.pointer(key), `${key} が空です`, `${key} に内容を書く`);
  return false;
}

/**
 * `gloss` が 1 文であること(句点「。」で区切られた文が 2 つ以上なら error。末尾の句点は数えない)。
 *
 * 2 文目に入るのは、禁じる用法(`not` の仕事)か、初出の文書が説明すれば足りる補足である。語の意味を
 * 1 文で言い切れないと、ブックの表とツールチップで「この語は何の語か」が読み手に伝わらない。
 * **宣言は落とさない**(1 文に直すまでの間も `avoid` の執行は有効のままにする)。
 */
function checkOneSentence(item: YamlReader, gloss: string, reporter: SpecReporter): void {
  const sentences = gloss.split('。').filter((part) => part.trim() !== '').length;
  if (sentences <= 1) return;
  reporter.error(
    item.pointer('gloss'),
    `gloss が ${sentences} 文です(1 文で言い切る)`,
    '2 文目は、禁じる用法なら not に 1 行で、補足なら first の文書の説明に移す。2 つの情報が要るなら「〜で、〜」と 1 文にする',
    { gloss },
  );
}

/** id がスネークケースであること。 */
function checkId(item: YamlReader, id: string, reporter: SpecReporter): boolean {
  if (SNAKE.test(id)) return true;
  reporter.error(item.pointer('id'), `id ${id} がスネークケースではありません`, '小文字・数字・アンダースコアで書く', { id });
  return false;
}

/** first がリポジトリルートからの相対パスであること(絶対パス・親ディレクトリ参照は書けない)。 */
function checkFirst(item: YamlReader, first: string, reporter: SpecReporter): boolean {
  const relative = first.trim() !== '' && !first.startsWith('/') && !first.split('/').includes('..');
  if (relative) return true;
  reporter.error(
    item.pointer('first'),
    `first ${first} がリポジトリルートからの相対パスではありません`,
    'docs/rules/... のように、リポジトリルートからの相対パスで書く(絶対パスと ../ は使わない)',
    { first },
  );
  return false;
}

/** avoid を読む。空の綴りは落とし、重複は 1 つにする。 */
function readAvoid(item: YamlReader, reporter: SpecReporter): readonly string[] {
  const listed = item.optionalStringList('avoid', 'avoid は使わない綴りの文字列のリストで書く');
  const kept: string[] = [];
  listed.forEach((spelling, at) => {
    if (spelling.trim() === '') {
      reporter.error(`${item.pointer('avoid')}[${at}]`, 'avoid に空の綴りは書けません', '綴りを書くか、その要素を消す');
      return;
    }
    if (!kept.includes(spelling)) kept.push(spelling);
  });
  return kept;
}

/**
 * `avoid` が台帳の語を禁じていないことを見る。
 *
 * 自分の `term` を禁じる行は「使う語と禁じる語が同じ」で、別の語の `term` を禁じる行は
 * 「台帳が自分で矛盾している」。どちらも M9 が台帳自身の語を旧綴りとして責めることになる。
 */
function checkAvoidClosure(terms: readonly TermDecl[], reporter: SpecReporter): void {
  const owners = new Map(terms.map((decl) => [decl.term, decl.id]));
  for (const decl of terms) {
    for (const spelling of decl.avoid) {
      const owner = owners.get(spelling);
      if (owner === undefined) continue;
      const own = owner === decl.id;
      reporter.error(
        `terms.${decl.id}.avoid`,
        own
          ? `語 ${decl.id} の avoid に自分の term「${spelling}」があります(使う語と禁じる語が同じ)`
          : `語 ${decl.id} の avoid「${spelling}」は別の語の term です(台帳が自分で矛盾している。語 ${owner})`,
        own
          ? 'avoid から消す(禁じたいのは別の綴りのはず)'
          : 'どちらの綴りを使うかを決め、負けた側を avoid に移す。両方使うなら avoid から消す',
        { term: decl.term, avoid: spelling, owner },
      );
    }
  }
}
