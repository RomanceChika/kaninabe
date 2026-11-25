/**
 * 画面の `route`(URL の形)の文法。
 *
 * 静的なセグメントは `[a-z0-9_-]+`、動的なセグメントは `:param`(`:` に続く `[a-z][a-z0-9_]*` が**セグメント全体**)。
 * ファイルの置き場の記法(角括弧など)は仕様に書かず、後段の写像が持つ。文法の判定と動的セグメントの数え方はここ 1 か所にまとめ、
 * S1(形式の検査)・H2(着地先)・生成器が同じ定義を読む。
 */

/** 静的なセグメント(小文字・数字・ハイフン・アンダースコア)。 */
export const STATIC_SEGMENT = /^[a-z0-9_-]+$/;

/** 動的なセグメント(`:param`。捕獲群 1 が名前)。 */
export const DYNAMIC_SEGMENT = /^:([a-z][a-z0-9_]*)$/;

/**
 * route の動的セグメントの名前を、出現順に返す。
 *
 * @param route 画面の route(例: `/items/:item_id/parts/:part_id`)
 * @returns 動的セグメントの名前の列(例: `['item_id', 'part_id']`。静的な route は空)
 */
export function dynamicParams(route: string): string[] {
  return route
    .split('/')
    .map((segment) => DYNAMIC_SEGMENT.exec(segment)?.[1])
    .filter((name): name is string => name !== undefined);
}

/**
 * route が文法に載る形か(先頭 `/`・末尾に `/` なし・各セグメントが静的か `:param`)。名前の重複は見ない(それは S1 が見る)。
 * 実装の木から逆引きした route が、そもそも仕様に書ける形かを問うのに使う(書けない形は宣言しようがない)。
 *
 * @param route 画面の route、または実装の木から逆引きした route
 * @returns 仕様の文法に載る形なら true
 */
export function isSpecRouteForm(route: string): boolean {
  if (route === '/') return true;
  if (!route.startsWith('/') || route.endsWith('/')) return false;
  return route
    .slice(1)
    .split('/')
    .every((segment) => STATIC_SEGMENT.test(segment) || DYNAMIC_SEGMENT.test(segment));
}
