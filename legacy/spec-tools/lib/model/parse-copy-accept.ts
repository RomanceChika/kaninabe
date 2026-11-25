/**
 * **写しの受け入れ**(`copy_accept`)を読む(`effects[].snapshot.fields[]` と `triggers[]`。点検 12 回目 A12-2)。
 *
 * 隠し列(`fields_hidden`)・個人列(`personal`)の約束は写しの先でも保つ。写し先で崩れる組は V12 / T15 が error にするので
 * (判定は `semantics/copy-exposure.ts`)、値が別の変換を通る・本人が公開を選んだ、のように約束が別の形で守られているなら、
 * その行に**約束 × 相手を名指して**理由を書く。
 *
 * ```yaml
 * # snapshot の写像の行
 * - from: article.author_note
 *   to: author_note
 *   copy_accept:
 *     - on: hidden          # 隠し列の約束(fields_hidden)
 *       role: member        # 隠した相手(from のロール)を 1 つずつ名指す
 *       reader: member      # 写し先を読める規則の by を 1 つずつ名指す(読み手を足すと受け入れは効かなくなる)
 *       reason: 公開の遷移の入力で本人が確認した文面だけが入る
 *     - on: personal        # 個人列の約束(role は書かない)
 *       reason: 匿名化の変換を通した表示名が入る
 *
 * # トリガ(triggers[])の要素。供給する列を column で名指す
 * copy_accept:
 *   - column: customer_name
 *     on: personal
 *     reason: …
 * ```
 *
 * 受け入れは名指した**約束 × 相手 × 読み手**(トリガは列も)にだけ効く。何も受け入れない要素は腐った受け入れとして検査が止める。
 * 緩める宣言なので、読めない要素は載せない(緩めない側に倒す)。違反は記録するので verify は止まる。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecReporter } from './parse-common.js';
import { eachRecord, type YamlReader } from './yaml-reader.js';
import type { SourceLocation } from './types-common.js';

/** YAML のキー。 */
export const COPY_ACCEPT_KEY = 'copy_accept';

/** 受け入れが名指せる約束(閉じた集合)。 */
export const COPY_PROMISES = ['hidden', 'personal'] as const;
export type CopyPromise = (typeof COPY_PROMISES)[number];

/** 写しの受け入れ 1 件。 */
export interface CopyAccept {
  readonly on: CopyPromise;
  /** 隠した相手(`on: hidden` のとき必須・`on: personal` では書けない)。 */
  readonly role?: string;
  /** 写し先を読める規則の `by`(`on: hidden` のとき必須・`on: personal` では書けない)。 */
  readonly reader?: string;
  readonly reason: string;
  readonly location: SourceLocation;
}

/** トリガの受け入れ 1 件(供給する列を名指す)。 */
export interface TriggerCopyAccept extends CopyAccept {
  readonly column: string;
}

/** 書き方。 */
export const COPY_ACCEPT_SUGGESTION =
  'copy_accept は、写し先で崩れる約束を 1 件ずつ名指して理由を書く —— ' +
  '"- on: hidden / role: {fields_hidden の from のロール} / reader: {写し先の reads の by} / reason: {理由}" か "- on: personal / reason: {理由}"' +
  '(トリガの要素は column: {供給する列} も書く)。名指していない約束・相手・読み手には効かない';

/** 要素の共通の読み取り(読めなければ null)。 */
function readElement(element: YamlReader, base: string, index: number, reporter: SpecReporter): CopyAccept | null {
  const on = element.requiredString('on', COPY_ACCEPT_SUGGESTION);
  const reason = element.requiredString('reason', COPY_ACCEPT_SUGGESTION);
  const role = element.optionalString('role', COPY_ACCEPT_SUGGESTION);
  const reader = element.optionalString('reader', COPY_ACCEPT_SUGGESTION);
  const location = reporter.location(`${base}[${index}]`);
  if (on === null || reason === null) return null;
  if (reason.trim() === '') {
    reporter.error(element.pointer('reason'), 'copy_accept の reason が空です', COPY_ACCEPT_SUGGESTION);
    return null;
  }
  if (!(COPY_PROMISES as readonly string[]).includes(on)) {
    reporter.error(element.pointer('on'), `copy_accept の on に "${on}" は書けません`, COPY_ACCEPT_SUGGESTION, { value: on });
    return null;
  }
  if ((on === 'hidden') !== (role !== undefined) || (on === 'hidden') !== (reader !== undefined)) {
    const message = on === 'hidden' ? 'copy_accept の on: hidden には隠した相手の role と読み手の reader が要ります' : 'copy_accept の on: personal に role と reader は書けません';
    reporter.error(element.pointer(role === undefined ? 'role' : 'reader'), message, COPY_ACCEPT_SUGGESTION);
    return null;
  }
  return { on: on as CopyPromise, ...(role === undefined ? {} : { role }), ...(reader === undefined ? {} : { reader }), reason, location };
}

/**
 * 写像の行の `copy_accept` を読む(書かれていなければ空)。
 *
 * @param reader 写像の行の読み手
 * @param reporter 違反の記録先
 * @returns 受け入れ
 */
export function parseCopyAccepts(reader: YamlReader, reporter: SpecReporter): readonly CopyAccept[] {
  const base = reader.pointer(COPY_ACCEPT_KEY);
  const accepts: CopyAccept[] = [];
  eachRecord(reader.optionalList(COPY_ACCEPT_KEY, COPY_ACCEPT_SUGGESTION), base, reporter, COPY_ACCEPT_SUGGESTION, (element, index) => {
    element.rejectUnknownKeys(['on', 'role', 'reader', 'reason'], 'copy_accept の要素', COPY_ACCEPT_SUGGESTION);
    const accept = readElement(element, base, index, reporter);
    if (accept !== null) accepts.push(accept);
  });
  return accepts;
}

/**
 * トリガの `copy_accept` を読む(書かれていなければ空)。
 *
 * @param reader トリガの要素の読み手
 * @param reporter 違反の記録先
 * @returns 受け入れ
 */
export function parseTriggerCopyAccepts(reader: YamlReader, reporter: SpecReporter): readonly TriggerCopyAccept[] {
  const base = reader.pointer(COPY_ACCEPT_KEY);
  const accepts: TriggerCopyAccept[] = [];
  eachRecord(reader.optionalList(COPY_ACCEPT_KEY, COPY_ACCEPT_SUGGESTION), base, reporter, COPY_ACCEPT_SUGGESTION, (element, index) => {
    element.rejectUnknownKeys(['column', 'on', 'role', 'reader', 'reason'], 'copy_accept の要素', COPY_ACCEPT_SUGGESTION);
    const column = element.requiredString('column', COPY_ACCEPT_SUGGESTION);
    const accept = readElement(element, base, index, reporter);
    if (column !== null && accept !== null) accepts.push({ ...accept, column });
  });
  return accepts;
}
