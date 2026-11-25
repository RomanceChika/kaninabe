/**
 * **外へ送る口の閉じた表**(点検 10 回目 B10-3)。表の正はこの 1 か所である。
 *
 * 9 回目 B9-4 の直しは外部の SDK の**パッケージ**を置き場(外部連携の `adapter_root`・土台)に閉じたが、外へ送る口そのもの
 * (`safeFetch`・Node の通信の組み込み・`undici`)は基盤の層のどこからでも引けた。SDK を REST に替えるだけで、集約名のディレクトリから
 * 有料の API を直に呼べた。そこで SDK と同じ置き場の閉世界を、この表の口にも掛ける —— 値で引いてよいのは置き場の下だけ。
 *
 * 読み手は 3 つで、どれもこの表を読む。
 *   - 検証器の X1 の (d)(`sdk-placement.ts`。製品の木の全部の import を走査する)
 *   - 生成器 `code-sdk-homes`(製品の生成物 `sdk-homes.json` の `outbound.primitives` に写す)
 *   - ESLint の `layer/outbound-primitive-home`(生成物から読む)。グローバルの `fetch` / `WebSocket` / `XMLHttpRequest` /
 *     `EventSource` / `navigator.sendBeacon` は `layer/no-external-network` が同じ置き場の外で止める(免除の住所は生成物の `outbound.homes`)
 *
 * **アプリの語彙は 1 語も持たない**。
 */

/**
 * 外へ送る口のモジュール(綴りは正規化した形。Node の組み込みは `node:` つき。下位パスは {@link outboundPrimitiveOf} が畳む)。
 * `node:dns` は名前の問い合わせそのものが外への送信になる(問い合わせの名前に値を載せられる)ので入れる。
 */
export const OUTBOUND_PRIMITIVE_MODULES: readonly string[] = Object.freeze([
  '@kaninabe/runtime/http/safe-fetch',
  'node:http',
  'node:https',
  'node:http2',
  'node:net',
  'node:tls',
  'node:dgram',
  'node:dns',
  'undici',
]);

/** 接頭辞 `node:` を付けずに書ける組み込みの名前(表の `node:` の行と同じ集合)。 */
const BARE_BUILTINS: ReadonlySet<string> = new Set(OUTBOUND_PRIMITIVE_MODULES.filter((module) => module.startsWith('node:')).map((module) => module.slice('node:'.length)));

/**
 * import の指定子が外へ送る口なら、表の綴りを返す(`https` → `node:https`・`node:dns/promises` → `node:dns`・`undici/types` → `undici`)。
 *
 * @param specifier import の指定子
 * @returns 表の綴り(外へ送る口でなければ null)
 */
export function outboundPrimitiveOf(specifier: string): string | null {
  const spelled = specifier.replace(/\.js$/u, '');
  if (OUTBOUND_PRIMITIVE_MODULES.includes(spelled)) return spelled;
  const bare = spelled.startsWith('node:') ? spelled.slice('node:'.length) : spelled;
  const head = bare.split('/')[0] ?? '';
  if (BARE_BUILTINS.has(head)) return `node:${head}`;
  if (head === 'undici') return 'undici';
  return null;
}
