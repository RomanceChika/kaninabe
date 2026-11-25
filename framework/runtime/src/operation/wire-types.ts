/**
 * DB に運ぶ値の**中立の型**（`Json` と欄の 3 値と `RpcArg`）。
 *
 * 公開の入口は `./ports.ts`（`@kaninabe/runtime/ports`）で、ここはその一部を別ファイルに置いているだけ
 * である（ポートの宣言と、運ぶ値の型は責務が違うので別のファイルに置く）。
 * 値を運べる形に直す関数は `./_template/wire.ts`。
 */

/**
 * DB に運べる JSON（**`undefined` を含まない**）。
 *
 * 運び方の契約の土台である。`undefined` は JSON に無く、PostgREST は引数ごと落とし、pg は
 * null にする —— 土台に入れた瞬間に「鍵を落とす経路」と「null にする経路」が逆転する。
 * だから型に入れず、`undefined` は入口の正規化（`_template/wire.ts` の `toWire`）が欄の
 * 3 値（`Presence` / `Change`）に直すか拒否する。
 */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/** `null` を含まない JSON（3 値の `value` / `set` の型。null は専用の合図で表す）。 */
export type NonNullJson = Exclude<Json, null>;

/**
 * 入力の欄の 3 値（作成: 全欄を出すが、送られていないのと null で送られたのを区別して持つ）。
 *
 * **`value` は null を持てない** —— null は `{ kind: 'null' }` だけで表す（二通りの null を作らない）。
 */
export type Presence<T extends NonNullJson> =
  | { readonly kind: 'absent' }
  | { readonly kind: 'null' }
  | { readonly kind: 'value'; readonly value: T };

/**
 * 編集の欄の 3 値（`unchanged` = 鍵を出さない / `clear` = 空にする / `set` = 値にする）。
 *
 * **`set` は null を持てない**（空にするのは `clear` だけ）。
 */
export type Change<T extends NonNullJson> =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'set'; readonly value: T };

/**
 * RPC の引数 1 本の**意味**（運び方ではない）。
 *
 * - `value`: 最上位の引数。署名が固定で「未指定」を持てない。
 * - `record`: 作成の `input_values`。並べた欄を全部出し、`absent` も `null` で出す。
 * - `patch`: 編集の `input_changes`。`unchanged` は鍵を出さない・`clear` は null・`set` は値。
 * - `document`: 複合 RPC の入力（深い JSON をそのまま運ぶ）。
 *
 * 運び方（PostgREST の JSON か pg のパラメータか）を決めるのは adapter であり、この型は
 * どの adapter にも同じことを約束する。
 */
export type RpcArg =
  | { readonly kind: 'value'; readonly value: Json }
  | { readonly kind: 'record'; readonly fields: Readonly<Record<string, Presence<NonNullJson>>> }
  | { readonly kind: 'patch'; readonly changes: Readonly<Record<string, Change<NonNullJson>>> }
  | { readonly kind: 'document'; readonly value: Json };

/** RPC の戻り値（形は 2 つ。定型 RPC は行の列・複合 RPC は文書 1 つ）。 */
export type RpcReturn =
  | { readonly shape: 'rows'; readonly rows: readonly Json[] }
  | { readonly shape: 'document'; readonly document: Json };

