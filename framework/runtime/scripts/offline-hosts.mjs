/**
 * ビルドの外への通信の見張り(`offline-guard.mjs`)が通してよい宛先の判定(副作用なし。テストはこちらだけを読む)。
 *
 * 許す外の宛先は閉じた表 `ALLOWED_HOSTS` だけで、**空**である(2026-11-05 コーディネーターの決定: 生成するアプリは既定で手元だけでビルドできる)。
 * 足すときは理由と一緒にここへ書く。手元(ループバック)は外ではないので通す。
 */

/** 許す外の宛先(閉じた表。**空**)。 */
export const ALLOWED_HOSTS = Object.freeze([]);

/** 手元(ループバック)の宛先。 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/**
 * 宛先が手元か、許す表にあるか。
 *
 * @param {unknown} host - 宛先の名前か番地(名前の無い接続 = Unix の socket・既定の localhost は手元)
 * @returns {boolean} 通してよければ true
 */
export function allowed(host) {
  if (typeof host !== 'string' || host === '') return true;
  const name = host.toLowerCase();
  if (LOOPBACK.has(name) || name.endsWith('.localhost') || /^127\./.test(name)) return true;
  return ALLOWED_HOSTS.includes(name);
}
