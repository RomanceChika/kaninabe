/**
 * 部品の種類(`kind:`)の値域(ADR-0015)。パーサー・S17 / S18・生成器が同じ母集合を見る。
 *
 * 型の本体(`types.ts`)から分けてあるのは、値域が「生成物の形が増えるたびに 1 語足す」変更点であり、
 * 画面仕様の型の他の部分と変更の理由が違うからである(`types.ts` は `./types-component.js` から再輸出する)。
 */

/**
 * 部品の種類(`kind:`)の値域。**閉じた語**であり、生成物の形が 1 つ増えるごとに 1 語足す。
 *
 * `form`(単発の操作の作成 / 編集フォーム)・`table`(表。`returns: many` の読み 1 本。`edit` で行をその場で編集し、
 * `actions` で行ごとのボタンを持てる)・`detail`(詳細の項目。`returns: one` の読み 1 本)・
 * `actions`(1 行に対する操作のボタン列。`returns: one` の読み 1 本)。語は生成器ができた束で足す(ADR-0015)。
 *
 * `platform_read`(auth_spec の `platform_ops` の `read` を表にする)・`platform_actions`(`do` のボタン列)は
 * ドメインイベントでない認証基盤の操作の部品で、読む相手が query_spec でなく auth_spec である(ADR-0019)。
 */
export type ComponentKind = 'form' | 'table' | 'detail' | 'actions' | 'platform_read' | 'platform_actions';

/** 部品の種類の値域(パーサーと S17 / S18 と生成器が同じ母集合を見る)。 */
export const COMPONENT_KINDS: readonly ComponentKind[] = ['form', 'table', 'detail', 'actions', 'platform_read', 'platform_actions'];

/** 文字列が部品の種類の語彙かを判定する。 */
export function isComponentKind(value: string): value is ComponentKind {
  return (COMPONENT_KINDS as readonly string[]).includes(value);
}
