/**
 * screen_spec の `smoke:`(E2E スモークがこの画面を通ることの宣言)のパーサー。
 *
 * 責務は「1 画面の `smoke:` 節の読み取り」に閉じる(他の節は parse-screen-parts.ts が読む)。
 * 書式の正: screen-spec-writing.md §smoke。
 */

import type { SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { splitImplementation } from '../parse-test-case.js';
import type { ScreenSmoke } from './types.js';
import { e2eRootPath } from '../product/layout.js';
import type { ProductLayout } from '../product/layout.js';
import type { ProductRoots } from '../product/types.js';

/**
 * `smoke:` の implementation が指してよいディレクトリ(E2E スモークの置き場は 1 か所)。
 *
 * 置き場は置き場の配置の役割 `e2e-root` が決め(部品化 ③-c6)、**その上の実装の木の位置は製品の宣言から来る**(W3)。
 * 実装の木を持たない製品では宣言そのものが書けない。
 */
function e2eDirPrefix(roots: ProductRoots, layout: ProductLayout): string | null {
  const dir = e2eRootPath(layout, roots);
  return dir === null ? null : `${dir}/`;
}

/** どう直すかの定型文(置き場は宣言から組み立てる)。 */
function smokeSuggestion(prefix: string): string {
  return (
    'smoke に "- summary / implementation" を持つ要素を並べる' +
    '(summary はこの画面を通る手順の要約、implementation は' +
    ` "${prefix}{ファイル}.spec.mts::{テスト名}" 形式。書式の正: screen-spec-writing.md §smoke)`
  );
}

/**
 * `smoke:`(E2E スモークがこの画面を通ることの宣言)を読む。
 *
 * `test_cases` と違い、テストケース ID 台帳(A6/A9)には乗らない — 1 本の E2E スモークが
 * 多数の画面をまたぐため、正の登録はどれか 1 画面の `test_cases` が担う
 * (書式の正: screen-spec-writing.md §smoke)。ここで見るのは形式だけで、
 * 実在(scan 結果の `@tc` アノテーションと一致するか)は S11 が見る。
 *
 * @param root フロントマター全体の読み取り器
 * @param reporter 違反の記録先
 * @param roots 製品が宣言した根(実装の木の位置)
 * @param layout 置き場の配置(E2E の置き場 = 役割 `e2e-root`)
 * @returns 読めた宣言(未記入なら空配列)
 */
export function parseSmoke(
  root: YamlReader,
  reporter: SpecReporter,
  roots: ProductRoots,
  layout: ProductLayout,
): readonly ScreenSmoke[] {
  const prefix = e2eDirPrefix(roots, layout);
  const suggestion = smokeSuggestion(prefix ?? '');
  const items = root.optionalList('smoke', suggestion);
  const smoke: ScreenSmoke[] = [];
  eachRecord(items, 'smoke', reporter, suggestion, (reader, index) => {
    const at = `smoke[${index}]`;
    const summary = reader.requiredString('summary', suggestion);
    const raw = reader.requiredString('implementation', suggestion);
    if (summary === null || raw === null) return;
    const implementation = splitImplementation(raw);
    if (prefix === null || implementation === null || !implementation.file.startsWith(prefix)) {
      reporter.error(
        `${at}.implementation`,
        `implementation ${raw} が "${prefix ?? '(実装の木の宣言がありません)'}{ファイル}.spec.mts::{テスト名}" の形式ではありません`,
        suggestion,
        { value: raw },
      );
      return;
    }
    smoke.push({ summary, implementation, location: reporter.location(at) });
  });
  return smoke;
}
