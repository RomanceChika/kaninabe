/**
 * ローカルと CI が使う Supabase CLI の版（**正はここ 1 か所**）。
 *
 * `.nvmrc` が Node の版を固定するのと同じ発想で、CLI の版も固定する。CLI の版が変わると
 * 要求する Docker イメージの世代も変わり、`supabase start` が db コンテナを作り直して
 * 1GB 級の pull を始める（2026-09-09 に `npx supabase`（別の版）を使って実際にローカル環境を
 * 失った。NOTES.md 束 ⑯c-1b の「環境事故」）。**PATH の `supabase`（brew）だけを使い、
 * `npx supabase` は使わない。**
 *
 * CI 側（`.github/workflows/ci.yml` と `nightly.yml` の `supabase/setup-cli` の `version:`）は YAML から
 * この値を読めないので、同じ文字列を書いたうえでコメントからここを指している。食い違いに
 * 気づく口はローカル側にあり、`ensureLocalSupabase` が起動時に手元の版を確かめて、
 * 違えば警告する（**止めない** —— 版が違っても大抵は動くし、作業を止める理由には弱い）。
 */
export const SUPABASE_CLI_VERSION = '2.111.0';
