/**
 * 置き場の**逆引き**の全役割への口(`layoutClassify`)— 実在のファイルのパス → それを自分の実体と読む役割とキー(§20-2 の `classify(path) → (役割, キー)`)。
 *
 * 役割ごとの逆引き(`layoutScan`)は「ある役割の走査の根と、その下の相対パス → キー」で、読み手は役割を決めて呼ぶ(S7 は画面の器を・走査は操作の本体を)。
 * ここは**逆向きの問い**で、パスから役割を決める。**同じパスを 2 つ以上の役割が自分のものと読んだら、置き場の衝突**(配置の定義の検査 `layout-nesting.ts` が、
 * 役割ごとのキーの見本の置き場をこの口に当てて見る)。純関数で throw しない。
 */

import { LAYOUT_CLASSIFIED_ROLES, layoutScan } from './layout.js';
import type { ClassifiedRole, ProductLayout } from './layout.js';

/** パスを自分の実体と読んだ役割 1 つ(と、その役割でのキー)。 */
export interface LayoutClassified {
  /** 読んだ役割。 */
  readonly role: ClassifiedRole;
  /** その役割でのキー(逆引きが返した値。キーの形への正規化はしない — 深すぎる配置は規約のパスから導けない形のまま返す)。 */
  readonly key: string;
}

/**
 * パスを自分の実体と読む役割を全部返す(逆引きを持つ全役割に当てる)。
 *
 * @param layout 後段が与える配置
 * @param productRoot 製品の根(`roots.app`。`path` もこの根を接いだ形で渡す。空文字 `''` は「製品の根からの相対」。null = 実装の木を持たない = どの役割にも読まれない)
 * @param path ファイルのパス(区切りは `/`。`productRoot` が `''` でなければリポジトリルート相対)
 * @returns 読んだ役割とキー(宣言順。どの役割にも読まれなければ空 — 逆引きを持たない手書きのファイル・テスト支援など)。2 つ以上あれば衝突
 */
export function layoutClassify(layout: ProductLayout, productRoot: string | null, path: string): readonly LayoutClassified[] {
  const found: LayoutClassified[] = [];
  for (const role of LAYOUT_CLASSIFIED_ROLES) {
    const scan = layoutScan(layout, productRoot, role);
    if (scan === null || !path.startsWith(`${scan.dir}/`)) continue;
    const key = scan.keyOf(path.slice(scan.dir.length + 1));
    if (key !== null) found.push({ role, key });
  }
  return found;
}
