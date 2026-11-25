/**
 * `exceptions:`（免除の一本化。決定性の格上げ ⑥）の共通パーサー。
 *
 * action_spec と query_spec の両方が同じ形の `exceptions:` を持てる
 * （action-spec-writing.md / query-spec-writing.md 共通の節）。
 * `eslint-disable` はコード内に書けない（`layer/no-eslint-disable-comment`）ため、
 * 生成で導けない ESLint 違反を受け入れるには、ここで宣言した理由が唯一の口になる。
 * 生成器（code-lint-exceptions.ts）がこれを `app/src/domain/generated/lint-exceptions.json`
 * に写し、`app/eslint.config.mjs` がファイル単位の免除として読む。
 *
 * ファイル I/O は行わない（I/O は loader.ts に集約する。規約: scripts-code-quality.md）。
 */

import type { SourceLocation } from './types.js';
import { eachRecord, type YamlReader } from './yaml-reader.js';
import type { SpecReporter } from './parse-common.js';

/** `exceptions:` の 1 件（ESLint ルール 1 本の理由つき受け入れ）。 */
export interface LintExceptionDecl {
  /** 免除する ESLint ルール ID（例: "no-restricted-syntax"）。値域の検査はしない —— */
  readonly rule: string;
  /** なぜこの 1 箇所だけ受け入れるか（日本語 1 文）。空文字は許さない。 */
  readonly reason: string;
  readonly location: SourceLocation;
}

const EXCEPTIONS_SUGGESTION =
  'exceptions に "- rule / reason" を持つ要素を並べる' +
  '(rule は ESLint のルール ID、reason はこの 1 箇所だけ受け入れる理由。generate で導けない例外だけに使う)';

/**
 * `exceptions:`(任意)を読む。書かなければ免除なし(空配列)。
 *
 * `eslint-disable` の代わりに使う唯一の口であり、免除は「コードに書く」のではなく
 * 「仕様に理由つきで宣言する」ことを強制する(免除の一本化)。
 *
 * @param root フロントマター全体の読み取り器
 * @param reporter 違反の記録先
 * @returns 読めた免除宣言(exceptions 自体が無ければ空配列)
 */
export function parseLintExceptions(root: YamlReader, reporter: SpecReporter): readonly LintExceptionDecl[] {
  if (!root.has('exceptions')) return [];
  const items = root.optionalList('exceptions', EXCEPTIONS_SUGGESTION);
  const result: LintExceptionDecl[] = [];
  eachRecord(items, 'exceptions', reporter, EXCEPTIONS_SUGGESTION, (reader, index) => {
    const rule = reader.requiredString('rule', EXCEPTIONS_SUGGESTION);
    const reason = reader.requiredString('reason', EXCEPTIONS_SUGGESTION);
    if (rule === null || reason === null) return;
    if (rule.trim() === '' || reason.trim() === '') {
      reporter.error(
        `exceptions[${index}]`,
        'exceptions の rule / reason は空文字にできません',
        EXCEPTIONS_SUGGESTION,
      );
      return;
    }
    result.push({ rule, reason, location: reporter.location(`exceptions[${index}]`) });
  });
  return result;
}
