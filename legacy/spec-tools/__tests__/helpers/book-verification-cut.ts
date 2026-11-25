/**
 * ハンドブックの章から、検証の結果(警告)と変異の目録に依る部分(印 `data-dep="verify"` の要素)を切り出す道具。
 * 実体は `lib/generate/book-verification-cut.ts`(入口の `--check` と同じ 1 本を、テストも使う)。
 */

export { cutVerification } from '../../lib/generate/book-verification-cut.js';
