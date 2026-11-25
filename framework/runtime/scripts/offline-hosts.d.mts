/**
 * `offline-hosts.mjs` の型(本体は依存なしの素の JavaScript。型はテストが読むためだけにある)。
 */

/** 許す外の宛先(閉じた表。空)。 */
export const ALLOWED_HOSTS: readonly string[];

/**
 * 宛先が手元か、許す表にあるか。
 *
 * @param host - 宛先の名前か番地
 * @returns 通してよければ true
 */
export function allowed(host: unknown): boolean;
