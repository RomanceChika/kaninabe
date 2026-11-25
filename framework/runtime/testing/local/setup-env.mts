import { AsyncLocalStorage } from 'node:async_hooks';
import { inject } from 'vitest';
import { applyEnv, ensureLocalSupabase, type SupabaseRoot, type SupabaseStatus } from './local-supabase.mjs';

/**
 * 各テストファイルのワーカーで、ローカル Supabase の接続情報を環境変数に載せる。
 *
 * `globalSetup` はテスト本体とは別のプロセス／スレッドで動くため、そこで設定した環境変数は
 * テストに届かない。**が、`provide` した値は届く**ので、CLI（`supabase status`）を叩くのは
 * globalSetup の 1 回だけにし、ここでは受け取った値を環境変数へ写すだけにする
 * （以前はテストファイルごとに CLI を起動していて、`setup` の大半がその時間だった）。
 *
 * 受け取れなかったときだけ自分で解決する —— globalSetup を持たない設定（単発の実行など）でも
 * 壊れないための保険であり、通常経路ではここは通らない。
 */
function resolveStatus(): SupabaseStatus {
  // **`try` に入れるのは宣言を読むところだけ。** ここに CLI の起動まで入れると、
  // `supabase status` / `start` の失敗や CLI の版違いまで「宣言が要ります」という**事実より狭い
  // 診断**に化ける（束 ①-c-b のレビュー指摘。真因は `cause` に残るが、見出しが嘘になる）。
  let root: SupabaseRoot;
  try {
    const provided = inject('supabaseStatus');
    if (provided !== undefined) return provided;
    // globalSetup を持たない構成（単発の実行など）。CLI を実行する場所も製品の宣言から取る
    // —— 仕組み側は製品の根を持たない（ADR-0013）。
    root = inject('supabaseRoot');
  } catch (cause) {
    throw new Error(
      'ローカル Supabase の接続情報を解決できません。設定に globalSetup（@kaninabe/runtime/testing/local/global-setup）か、' +
        'provide.supabaseRoot の宣言が要ります。',
      { cause },
    );
  }
  // 起動の失敗はそのまま上げる（ここで包むと「宣言が無い」に化ける）。
  return ensureLocalSupabase(root);
}

applyEnv(resolveStatus());

/**
 * Next.js の内部モジュール（`next/dist/server/app-render/async-local-storage.js`）は、
 * `globalThis.AsyncLocalStorage`（Edge ランタイムが注入するもの）が無いと、常に `undefined` を
 * 返すだけのフェイク実装にフォールバックする。Node の vitest 環境ではこのグローバルが無いため、
 * `cookies()` 等のリクエスト単位 API は原理的に「文脈が無い」を返し続け、
 * `src/app/__tests__/request-context.ts`（Server Action を実物のまま呼ぶハーネス）が
 * 動かない。**setupFiles はテストファイル自身の import より先に評価される**ため、
 * ここで 1 度だけ設定しておけば、以後どのテストファイルが `next/headers` を
 * 静的 import しても間に合う（ハーネス側の動的 import だけでは、対象の Server Action を
 * 先に静的 import した時点で手遅れになる。実測済み）。
 *
 * この 1 行は他のテストに対しては無害である（`globalThis.AsyncLocalStorage` は既定で
 * 未設定なので、Node 本来の実装を注入するだけで既存の挙動を変えない）。
 */
(globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage ??= AsyncLocalStorage;
