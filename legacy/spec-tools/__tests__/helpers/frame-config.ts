/**
 * 実装の木を組むテストが置く**枠の設定**(点検 16 回目 C16-3)。配置(Next.js)は枠の設定が在ることと、値を固定した欄(`poweredByHeader`・`headers`)を
 * 決まった形で書くことを要するので、入口の閉世界(J2 の続き)を回す木は、これを置かないと設定の不在の指摘が混ざる。
 *
 * 置くのは `next.config.mjs`(型検査と lint の対象の外。本文は実行しない。読むのは鍵の許可表の構文木だけ)。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 置くファイルの名前(製品の根の直下)。 */
export const FRAME_CONFIG_NAME = 'next.config.mjs';

/** 鍵の許可表と値を固定した欄を満たす本文(`NEXT_CONFIG_FIXED_MEMBERS` と同じ字句の並び)。 */
export const FRAME_CONFIG_TEXT = [
  '// 入口の閉世界のテスト用の枠の設定(値を固定した欄を決まった形で書く。点検 16 回目 C16-3)。',
  'const nextConfig = {',
  '  poweredByHeader: false,',
  '  async headers() { return [{ source: "/:path*", headers: staticHeaderEntries(BROWSER_DEFENSE) }]; },',
  '  experimental: { agentUpgrade: false },',
  '};',
  '',
  'export default nextConfig;',
  '',
].join('\n');

/**
 * 木に枠の設定を置く。
 *
 * @param repoRoot 木の根(リポジトリルートに見立てる)
 * @param productRoot 製品の根(リポジトリルートからの相対。既定は `app`)
 */
export function putFrameConfig(repoRoot: string, productRoot = 'app'): void {
  const target = path.join(repoRoot, productRoot, FRAME_CONFIG_NAME);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, FRAME_CONFIG_TEXT);
}
