/**
 * lib/trace/scan.ts のテスト用フィクスチャ。
 * A2 が見るのは「このパスにファイルがあるか」だけなので、中身は最小でよい。
 */

/** Server Action の代わりのダミー。 */
export function submitEntry(): { readonly ok: true } {
  return { ok: true };
}
