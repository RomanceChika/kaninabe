/**
 * T12 の公開面の判定(`t12-ddl-migration.ts` ほか)が読む構成の絞り込み。
 *
 * 判定が読むのは外に出すスキーマの名前と後段の能力だけ(置き場のファイルも git も読まない)。
 * プラットフォームの設定の残りの欄を判定へ渡さないために、ここで 2 つに絞る。
 */

import type { PlatformProfile } from '../../model/product/platform-profile.js';
import type { SurfacePlatform } from './t12-surface-naming.js';

/**
 * 公開面の判定が読む 2 つの値を、プラットフォームの設定から取り出す。
 *
 * @param platform プラットフォームの設定
 */
export function surfacePlatformOf(platform: PlatformProfile): SurfacePlatform {
  return { exposedSchema: platform.exposedSchema, surfaceExposure: platform.surfaceExposure };
}
