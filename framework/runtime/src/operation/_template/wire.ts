/**
 * **入口の正規化**（`unknown` → DB に運べる `Json` / 欄の 3 値）と、`RpcArg` → JSON の符号化。
 *
 * 実行器が受け取る値（入力・計算値・読んだ事実）は `unknown` である。これを DB の口に渡す前に、
 * **この 1 か所**で「運べる形」に直すか、呼び出し側の誤りとして止める。`JSON.stringify` が黙って
 * 落とす・書き換える値（`undefined` の鍵・`NaN` が `null` になる・`toJSON` を持つ任意の物）に
 * **頼らない** —— 自前で辿るので、何が運ばれ何が拒まれるかがこのファイルだけで決まる。
 *
 * | 値 | 扱い |
 * |---|---|
 * | 欄の `undefined` | `Presence` は `absent`・`Change` は `unchanged`（欄の外では拒否） |
 * | 配列の中・入れ子の鍵の `undefined` | 拒否（`JSON.stringify` は配列では `null`・鍵では落とす。どちらも偶然） |
 * | `NaN` / `±Infinity` | 拒否（`JSON.stringify` は `null` にする） |
 * | `Date` | ISO 8601 の文字列（`toISOString()`。日時の規約 datetime.md。不正な日付・西暦 0〜9999 年の外は拒否） |
 * | `BigInt` / 関数 / `Symbol` | 拒否 |
 * | 素のオブジェクト・配列・文字列・有限数・真偽・`null` | そのまま（再帰。深さは `MAX_WIRE_DEPTH` まで） |
 * | 鍵が `Symbol` のオブジェクト・追加のプロパティを持つ配列 | 拒否（黙って落とさない） |
 * | それ以外のオブジェクト（`Map` / `Set` / クラスの実体 / 循環 / 深すぎる入れ子） | 拒否 |
 *
 * 拒否は呼び出し側（計画の配線か入力）の誤りなので `ProgrammingError` で止める。業務上の拒否
 * （`ActionResult`）にはしない。
 */

import type { Change, Json, NonNullJson, Presence, RpcArg } from '@kaninabe/runtime/ports';

/** 呼び出し側の誤り（運べない値を渡した）。業務上の拒否ではなく、直すのはコードである。 */
export class ProgrammingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgrammingError';
  }
}

/**
 * 運べる入れ子の深さの上限（これを超えるとスタックを使い切る前に拒否する）。
 *
 * 入力は境界の zod を通った値なので、現実の入れ子はこれよりずっと浅い。
 */
export const MAX_WIRE_DEPTH = 64;

/** 素のオブジェクトか（`Object.prototype` か `null` が原型。クラスの実体・`Map` 等を除く）。 */
function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 値を 1 つ辿る（`path` は拒否の文面に載せる場所。`ancestors` は循環の検出）。 */
function walk(value: unknown, path: string, ancestors: readonly object[]): Json {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new ProgrammingError(`有限でない数は運べません: ${path}`);
      return value;
    case 'undefined':
      throw new ProgrammingError(`undefined は運べません（欄の外・配列の中・入れ子の鍵）: ${path}`);
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new ProgrammingError(`${typeof value} は運べません: ${path}`);
    default:
      return walkObject(value as object | null, path, ancestors);
  }
}

/** `Date` を ISO 8601 の文字列にする（西暦 0〜9999 年の外は `toISOString` が拡張年表記にするので拒否）。 */
function walkDate(value: Date, path: string): string {
  if (Number.isNaN(value.getTime())) throw new ProgrammingError(`不正な日付は運べません: ${path}`);
  const year = value.getUTCFullYear();
  if (year < 0 || year > 9999) throw new ProgrammingError(`ISO 8601 の 4 桁の年に収まらない日付は運べません: ${path}`);
  return value.toISOString();
}

/** `typeof` が `object` の値（`null`・`Date`・配列・素のオブジェクト）を辿る。 */
function walkObject(value: object | null, path: string, ancestors: readonly object[]): Json {
  if (value === null) return null;
  if (value instanceof Date) return walkDate(value, path);
  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) throw new ProgrammingError(`素の JSON でないオブジェクトは運べません: ${path}`);
  if (ancestors.includes(value)) throw new ProgrammingError(`循環した値は運べません: ${path}`);
  if (ancestors.length >= MAX_WIRE_DEPTH) throw new ProgrammingError(`入れ子が深すぎて運べません（${MAX_WIRE_DEPTH} 段まで）: ${path}`);
  const inner = [...ancestors, value];
  const ownKeys = Reflect.ownKeys(value);
  if (isArray) {
    const items = Array.from(value as readonly unknown[], (item, index) => walk(item, `${path}[${index}]`, inner));
    // 添字と `length` 以外の自前の鍵（追加のプロパティ・`Symbol` の鍵）は `JSON` に載らない。黙って落とさない。
    if (ownKeys.length !== items.length + 1) throw new ProgrammingError(`配列の追加のプロパティは運べません: ${path}`);
    return items;
  }
  if (ownKeys.some((key) => typeof key === 'symbol')) throw new ProgrammingError(`Symbol の鍵は運べません: ${path}`);
  const record = value as Readonly<Record<string, unknown>>;
  // `fromEntries` は鍵を自前のデータ属性として作る（`__proto__` という鍵が原型を書き換えない）。
  return Object.fromEntries(Object.keys(record).map((key) => [key, walk(record[key], `${path}.${key}`, inner)]));
}

/**
 * 値を DB に運べる `Json` に直す（直せなければ `ProgrammingError`）。
 *
 * 欄の外では `undefined` を運べない —— 欄なら `presenceOf` / `changeOf` を使う。
 *
 * @param value - 実行器が持つ値（入力・計算値・読んだ事実）
 * @param path - 拒否の文面に載せる場所の名前
 * @returns 運べる形の JSON
 */
export function toWire(value: unknown, path = '$'): Json {
  return walk(value, path, []);
}

/** 欄の `undefined`（送られていない）を持たない素のオブジェクトの写しにする（素のオブジェクト以外はそのまま）。 */
function withoutAbsentFields(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row) || row instanceof Date || !isPlainObject(row)) return row;
  // `Symbol` の鍵は写しで消えるので、先に `toWire` が拒む形のまま残す（黙って落とさない）。
  if (Reflect.ownKeys(row).some((key) => typeof key === 'symbol')) return row;
  return Object.fromEntries(Object.entries(row).filter(([, field]) => field !== undefined));
}

/**
 * 複合 RPC の入力（操作 ID → その手順の欄の record）を、DB に運べる形にする。
 *
 * 手順の欄の `undefined` は「送られていない」で、鍵ごと運ばない（旧い口の `JSON.stringify` と同じ。
 * 複合 RPC の SQL は鍵の有無で見る）。欄の中の値は `toWire` と同じ規則で辿る —— 欄の中の
 * `NaN` や配列の中の `undefined` などは `JSON.stringify` に黙って落とさせず、`ProgrammingError` で止める。
 *
 * @param input - 手順の操作 ID を鍵にした入力
 * @param path - 拒否の文面に載せる場所の名前
 * @returns 運べる形の入力（正当な値では旧い口の JSON と同じ）
 */
export function toWireInput(input: Readonly<Record<string, unknown>>, path = 'input'): Readonly<Record<string, Json>> {
  const steps = Object.fromEntries(
    Object.entries(input)
      .filter(([, row]) => row !== undefined)
      .map(([op, row]) => [op, withoutAbsentFields(row)]),
  );
  return toWire(steps, path) as Readonly<Record<string, Json>>;
}

/**
 * 作成の欄の 3 値にする（`undefined` = 送られていない・`null` = 空で送られた・それ以外 = 値）。
 *
 * @param value - 入力の 1 欄
 * @param path - 拒否の文面に載せる場所の名前
 * @returns 欄の 3 値（`value` は null を持たない）
 */
export function presenceOf(value: unknown, path = '$'): Presence<NonNullJson> {
  if (value === undefined) return { kind: 'absent' };
  const wire = toWire(value, path);
  return wire === null ? { kind: 'null' } : { kind: 'value', value: wire };
}

/**
 * 編集の欄の 3 値にする（`undefined` = 変更しない・`null` = 空にする・それ以外 = 値にする）。
 *
 * @param value - 入力の 1 欄
 * @param path - 拒否の文面に載せる場所の名前
 * @returns 欄の 3 値（`set` は null を持たない）
 */
export function changeOf(value: unknown, path = '$'): Change<NonNullJson> {
  if (value === undefined) return { kind: 'unchanged' };
  const wire = toWire(value, path);
  return wire === null ? { kind: 'clear' } : { kind: 'set', value: wire };
}

/**
 * 欄の 3 値を 1 つの値に畳む（送られていないのも `null`）。
 *
 * 最上位の引数は署名が固定で未指定を持てない。作成の `record` の全欄出しも同じ畳み方である。
 *
 * @param presence - 欄の 3 値
 * @returns `absent` と `null` は `null`・値はその値
 */
export function collapsePresence(presence: Presence<NonNullJson>): Json {
  return presence.kind === 'value' ? presence.value : null;
}

/**
 * `RpcArg` 1 本を、PostgREST に渡す JSON に符号化する。
 *
 * **旧い口（`rpc.call` の引数は JSON）へ運ぶための 1 か所**である。`record` は全欄を出し
 * （`absent` も `null`）、`patch` は `unchanged` の鍵を出さない（生成 SQL は `p_changes ? k` で見る）。
 *
 * @param arg - 引数の意味
 * @returns 運ぶ JSON
 */
export function rpcArgToJson(arg: RpcArg): Json {
  switch (arg.kind) {
    case 'value':
    case 'document':
      return arg.value;
    case 'record':
      return Object.fromEntries(Object.entries(arg.fields).map(([key, presence]) => [key, collapsePresence(presence)]));
    case 'patch':
      return Object.fromEntries(
        Object.entries(arg.changes).flatMap(([key, change]): [string, Json][] => {
          if (change.kind === 'unchanged') return [];
          return [[key, change.kind === 'clear' ? null : change.value]];
        }),
      );
  }
}

/**
 * 名前付き引数の全部を符号化する。
 *
 * @param args - 引数名 → 意味
 * @returns 引数名 → 運ぶ JSON
 */
export function rpcArgsToJson(args: Readonly<Record<string, RpcArg>>): Readonly<Record<string, Json>> {
  return Object.fromEntries(Object.entries(args).map(([name, arg]) => [name, rpcArgToJson(arg)]));
}
