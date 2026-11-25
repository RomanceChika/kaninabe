/**
 * ハンドブック「画面」の章が使う、画面のグループ(仕様ディレクトリ単位)の一覧。
 */

import type { ScreenSpecModel } from '../../model/screen/types.js';
import { screenGroup } from './screen-nav-graph.js';

/**
 * モデルに現れるグループの一覧(画面の宣言順で最初に現れた順・重複なし)。
 *
 * @param model 読み込み済みの画面仕様
 * @returns グループ名の並び
 */
export function screenGroups(model: ScreenSpecModel): readonly string[] {
  const groups: string[] = [];
  for (const screen of model.screens) {
    const group = screenGroup(screen);
    if (!groups.includes(group)) groups.push(group);
  }
  return groups;
}

