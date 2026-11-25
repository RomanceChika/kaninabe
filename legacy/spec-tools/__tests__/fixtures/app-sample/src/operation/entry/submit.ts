/**
 * lib/trace/scan.ts のテスト用フィクスチャ。
 * A10 が見るのは「このパスにファイルがあるか」だけなので、中身は最小でよい。
 */

/** 走査モジュールの代わりのダミー。 */
export function submitEntryOperation(): { readonly ok: true } {
  return { ok: true };
}
