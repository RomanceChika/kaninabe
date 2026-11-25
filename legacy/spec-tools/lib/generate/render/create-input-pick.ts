/**
 * **作成の入力欄を生成 zod スキーマから借りる**ときの、欄の振り分け(単発の操作の入力 `code-operation-inputs.ts` と、保存点の手順の入力
 * `code-usecase-inputs.ts` が同じ 1 本を呼ぶ。fix25s)。
 *
 * 作成の欄は `{entity}InputSchema`(作成入力の部品)から借りる。ただし `supplied_by: db` の欄はそこに無い(code-zod.ts が外す)。
 * 作成の入力に現れてよい `supplied_by: db` の欄は、表の `derives` が `mode: insert_at` で埋める末尾の番号だけで(V17 (a) の例外。
 * 持ち主は model/data/types.ts の `insertAtColumnsOf`)、それは**任意**(空なら DB が末尾に振る)である —— 行の形の制約(範囲)は
 * `{entity}RowSchema` の同じ欄にあるので、そこから借りて `.partial()` にする(制約は 1 つも再宣言しない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef } from '../../model/types.js';
import { isInputAbsent } from '../../model/types.js';
import { toCamelCase } from '../../gen-kit/code-emit.js';

/** 作成の欄の振り分け。 */
export interface CreateInputPick {
  /** 作成入力の部品(`{entity}InputSchema`)から借りる欄(宣言順)。 */
  readonly given: readonly string[];
  /** 行のスキーマ(`{entity}RowSchema`)から任意で借りる欄(`supplied_by: db` でも作成の入力に現れる欄。宣言順)。 */
  readonly positional: readonly string[];
}

/**
 * 作成の入力欄(`id` を除く)を、借りる先ごとに分ける。
 *
 * @param keys 作成の入力欄(action_spec の `input` の順)
 * @param fields その集約の欄(entity_spec)
 * @returns 振り分け
 */
export function splitCreateKeys(keys: readonly string[], fields: readonly FieldDef[]): CreateInputPick {
  const absent = new Set(fields.filter((field) => isInputAbsent(field)).map((field) => field.name));
  const picked = keys.filter((key) => key !== 'id');
  return { given: picked.filter((key) => !absent.has(key)), positional: picked.filter((key) => absent.has(key)) };
}

/**
 * 振り分けた欄の spread の並び(`...{entity}InputSchema.pick({…}).shape` と `...{entity}RowSchema.pick({…}).partial().shape`)。
 *
 * @param entity エンティティ名
 * @param pick 振り分け
 * @returns spread の式(空なら空)
 */
export function createPickSpreads(entity: string, pick: CreateInputPick): readonly string[] {
  const camel = toCamelCase(entity);
  const keysOf = (keys: readonly string[]): string => keys.map((key) => `${key}: true`).join(', ');
  return [
    ...(pick.given.length === 0 ? [] : [`...${camel}InputSchema.pick({ ${keysOf(pick.given)} }).shape`]),
    ...(pick.positional.length === 0 ? [] : [`...${camel}RowSchema.pick({ ${keysOf(pick.positional)} }).partial().shape`]),
  ];
}
