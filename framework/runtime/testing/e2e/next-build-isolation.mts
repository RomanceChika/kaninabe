import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * E2E 系（スモーク・撮影走査・ウォーカー）が `next build` を打つときの、専用ビルド先の解決。
 *
 * `npm run dev` と E2E 系が同じ `.next` を取り合うと、同時実行でビルドが壊れる
 * （BACKLOG「E2E の next build が .next を npm run dev と共有」2026-08-19）。
 * `next.config.ts` は `NEXT_DIST_DIR` / `NEXT_TSCONFIG_PATH` の 2 つの環境変数で
 * ビルド先を切り替えられるようにしてあるので、ここはその値を各 `*.config.mts` に配る。
 *
 * **tsconfig も分けて逃がす理由**: Next は `distDir` を変えるたびに、その distDir 用の
 * `{distDir}/types/**\/*.ts` を tsconfig の `include` へ自動追記する（実測）。既定の
 * `tsconfig.json`（コミット対象）をそのまま使うと、E2E 系を実行するたびにコミット済み
 * ファイルが汚れる。使い捨ての tsconfig（`tsconfig.json` を `extends` するだけの薄いファイル）
 * を distDir と対にして用意し、そちらを追記対象にする。
 */

/** `next.config.ts` に渡す 2 つの環境変数。 */
export interface NextBuildIsolationEnv {
  readonly NEXT_DIST_DIR: string;
  readonly NEXT_TSCONFIG_PATH: string;
}

/**
 * 指定した名前専用のビルド先を用意し、webServer.env に渡す値を返す。
 *
 * 使い捨て tsconfig が無ければ作る（`tsconfig.json` を `extends` するだけ。中身は Next が
 * 自分で追記するので、こちらは骨だけを用意すれば足りる）。冪等 — 既にあれば触らない
 * （Next が追記した `include` を毎回上書きで消さないため）。
 *
 * @param name - 用途名（`e2e` / `shots` / `walk`）。distDir は `.next-{name}`、
 *               tsconfig は `tsconfig.next-{name}.json` になる
 * @param appRoot - アプリのパッケージルート（使い捨て tsconfig を置く場所）。**利用側が渡す** ——
 *                  ここは仕組み側のパッケージであり、自分の置き場から利用側の根は数えられない
 *                  （ADR-0013 の規律。第 2 段では `node_modules/` の中に居る）
 * @returns `webServer.env` にそのまま展開できる環境変数の組
 */
export function nextBuildIsolationEnv(name: string, appRoot: string): NextBuildIsolationEnv {
  const tsconfigFile = `tsconfig.next-${name}.json`;
  const tsconfigPath = join(appRoot, tsconfigFile);
  if (!existsSync(tsconfigPath)) {
    writeFileSync(tsconfigPath, '{\n  "extends": "./tsconfig.json"\n}\n', 'utf8');
  }
  return { NEXT_DIST_DIR: `.next-${name}`, NEXT_TSCONFIG_PATH: tsconfigFile };
}
