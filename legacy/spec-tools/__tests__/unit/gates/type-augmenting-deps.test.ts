/**
 * **型を拡張する依存は、木の中で版が 1 つ**であることの突合。
 *
 * 束 ①-c でこれが破れて 1 日潰した: ワークスペースに `vitest` が 2 本あり(ルート 4.1.11 /
 * `app/node_modules` 4.1.10。指定はどちらも `^4.1.10` で、入れた時期の違いだけ)、実行時
 * パッケージの `declare module 'vitest'` がルートの版に当たる一方で app のテストは入れ子の版を
 * 見ていたため、同じ名前が**別のモジュール**になり `TS2664: Invalid module name in augmentation` で
 * app の `tsc` が落ちた。版を揃えると消える。
 *
 * ここが見るのは 2 つである。
 *   1. **宣言が同じ**こと(テストを実行する木の `package.json` の指定が 1 字も違わない。
 *      母集合はルートの `workspaces` + ワークスペースに入れない木(`docs` / `legacy/spec-tools`)から導出し、そのうち `test` / `test:*` を持つ木)—— 浮動の `^` のままでも、
 *      指定が同じなら別の日に install しても同じ範囲を引く
 *   2. **lock が 1 本に解けている**こと(木ごとに `vitest` の実体が 1 つで、版が一致する)
 *
 * `npm ls` を叩かずロックファイルを読むのは、**外に出ない・速い・結果が決定的**だからである
 * (`npm ls` は同じ不変条件を別の口から聞く)。**手元の `node_modules` とロックの乖離は
 * `npm ci` が引き受ける** —— CI は必ず `npm ci` を実行するので、ロックのとおりに入る。素手で
 * `npm i` を叩いて木を汚した場合はここは緑のままなので、そのときは `npm ci` で揃えること。`legacy/spec-tools` は
 * ワークスペースの外なので実体は 2 つあるが(ADR-0013。検査器のツールチェーンを製品のビルドに混ぜない)、
 * **版が同じなら型は同じ**である。`docs`(VitePress だけ。`test` を持たず `vitest` も宣言しない)も同じ表に並べて
 * おくので、docs が将来テストを持つ日には版の突合に入る(その日は docs の lock も `LOCKFILES` に並ぶ)。
 *
 * @see ../../../../rules/decisions/common/ADR-0013-framework-runtime-package.md
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** リポジトリルート(このファイルは legacy/spec-tools/__tests__/unit/gates/ にある)。 */
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** リポジトリルート相対のファイルを読む。 */
function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf-8');
}

/** 型を拡張する依存(`declare module` の相手)。増えたらここに足す。 */
const TYPE_AUGMENTED = ['vitest'] as const;

/** ワークスペースに入れない木(ADR-0013)。自分の `package.json` と lockfile を持つ。 */
const OUTSIDE_WORKSPACES = ['docs', 'legacy/spec-tools'] as const;

/**
 * その依存を宣言している `package.json`(リポジトリルート相対)を**導出する**。
 *
 * 列挙しない —— 5 本目のパッケージが `vitest` を宣言した日に黙って外へ出るのを避ける
 * (この束が W1 / lint / K1 で塞いだのと同じ形。束 ①-c-c のレビュー指摘)。並ぶのは
 * **ルートの `workspaces` から来る木**と、ワークスペースに入れない木(ADR-0013)である。
 *
 * @returns `package.json` のリポジトリルート相対パス(ルート → workspaces → ワークスペース外の順)
 */
function manifests(): readonly string[] {
  const root: unknown = JSON.parse(read('package.json'));
  const { workspaces } = root as { workspaces?: readonly string[] };
  return [
    'package.json',
    ...(workspaces ?? []).map((dir) => `${dir}/package.json`),
    // ワークスペースに入れない木(検査器のツールチェーンを製品のビルドに混ぜない)。
    // 木の外に別の実体を持つので、版を揃える相手としてはここに並ぶ。
    ...OUTSIDE_WORKSPACES.map((dir) => `${dir}/package.json`),
  ];
}

/**
 * その `package.json` の木が**テストを実行する**か(`test` / `test:*` のスクリプトを持つか)。
 *
 * これが「その木にこの依存が要る」の述語である —— `framework/lint-config` は lint だけの
 * パッケージなので `vitest` を持たない。**数を書かずに集合を導出する**ことで、
 * 「宣言している木が全部そろっている」を緩めずに検査できる(束 ①-c-d の独立レビュー:
 * `toBeGreaterThan(1)` に緩めた形は、`framework/runtime` から `vitest` を消しても緑になった)。
 *
 * @param file `package.json` のリポジトリルート相対パス
 * @returns テストを実行するなら true
 */
function runsTests(file: string): boolean {
  const manifest: unknown = JSON.parse(read(file));
  const { scripts } = manifest as { scripts?: Record<string, string> };
  return Object.keys(scripts ?? {}).some((name) => name === 'test' || name.startsWith('test:'));
}

/** ロックファイル(ルート 1 本 + テストを実行するワークスペース外の木ごとに 1 本)。 */
const LOCKFILES = [
  'package-lock.json',
  ...OUTSIDE_WORKSPACES.filter((dir) => runsTests(`${dir}/package.json`)).map((dir) => `${dir}/package-lock.json`),
];

/** `package.json` の依存の宣言(dependencies と devDependencies を 1 つに畳む)。 */
function declaredDeps(file: string): Readonly<Record<string, string>> {
  const manifest: unknown = JSON.parse(read(file));
  const { dependencies, devDependencies } = manifest as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { ...dependencies, ...devDependencies };
}

/** ロックファイルが解いた、そのパッケージの版の一覧(重複は畳まない)。 */
function resolvedVersions(file: string, name: string): readonly string[] {
  const lock: unknown = JSON.parse(read(file));
  const { packages } = lock as { packages?: Record<string, { version?: string }> };
  return Object.entries(packages ?? {})
    .filter(([path]) => path.endsWith(`node_modules/${name}`))
    .map(([, entry]) => entry.version)
    .filter((version): version is string => version !== undefined);
}

describe('型を拡張する依存は木の中で版が 1 つ', () => {
  for (const name of TYPE_AUGMENTED) {
    it(`${name} の指定が、テストを実行する木すべてで同じ(母集合も導出)`, () => {
      const files = manifests();
      const specs = files.map((file) => ({ file, spec: declaredDeps(file)[name] }));
      const declared = specs.filter((entry) => entry.spec !== undefined);
      // **数ではなく集合で見る。** 「テストを実行する木」が母集合であり、そこから 1 本でも
      // 宣言が落ちたら赤くなる(落ちてもルートから hoist されて動くので、緩いと気づけない)。
      const expected = files.filter((file) => runsTests(file));

      expect(declared.map((entry) => entry.file), JSON.stringify({ declared, expected })).toEqual(expected);
      expect(new Set(declared.map((entry) => entry.spec)).size, JSON.stringify(declared)).toBe(1);
    });

    it(`${name} が木ごとに 1 本へ解けていて、木のあいだで版が同じ`, () => {
      const perTree = LOCKFILES.map((file) => ({ file, versions: resolvedVersions(file, name) }));

      for (const tree of perTree) {
        expect(tree.versions.length, `${tree.file} が ${name} を ${String(tree.versions.length)} 本に解いている`).toBe(1);
      }
      expect(new Set(perTree.flatMap((tree) => tree.versions)).size, JSON.stringify(perTree)).toBe(1);
    });
  }
});
