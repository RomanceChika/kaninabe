/**
 * テストケースの意味クラス(`test_cases[].covers`)の説明文。
 *
 * 値域そのもの(`COVERAGE_CLASSES` / `CoverageClass` / `isCoverageClass`)は語彙の入口 `types.ts` にある
 * (前段がパースで読む)。説明文は検査(A7)だけが読むので、値の実装としてここに残す。
 *
 * 「そのテストが何を確かめているか」を有限個の分類に落とすための語彙であり、
 * A7(意味的カバレッジ)はこの語彙の上で「宣言すべきなのに宣言されていないもの」を検出する。
 * 分類はドメイン仕様から機械的に導ける拒否理由(guard / from / by / 不変条件 / 競合)に
 * 対応させてあり、どれにも当たらない補助的なケースだけが `other` になる。
 *
 * 定義の正: docs/rules/process/backend/specification/standards/action-spec-writing.md §covers
 */

import type { CoverageClass } from './types.js';

/**
 * 各クラスが「何を確かめるケースか」の説明。
 * A7 の対処文(どんなテストを足せばよいか)に埋め込む。
 */
export const COVERAGE_CLASS_HINTS: Readonly<Record<CoverageClass, string>> = {
  success: '許可された条件がすべて揃った実行が成功すること',
  guard_unsatisfied: 'ガード条件が成立しない状況で拒否されること',
  invalid_from: '遷移元に含まれない状態から実行して拒否されること',
  forbidden: '許可されていないロールが実行して拒否されること',
  invariant: '不変条件に反する実行が拒否されること',
  conflict: '可否を判断したあとに対象が変化していた実行が競合として拒否されること',
  not_found: '対象が存在しない場合の振る舞い',
  other: '上のどれにも当たらない補助的な確認',
};
