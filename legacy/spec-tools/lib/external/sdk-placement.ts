/**
 * X1 の (d) **外部の SDK の置き場の閉世界**(点検 9 回目 B9-4)。
 *
 * B8-1 の直しは ESLint の層の境界(app / composition / components の外部パッケージの許可表)だけで、基盤の層(infrastructure)は
 * 外部パッケージの全部を引けた。lint の文言どおり SDK の呼び出しを infrastructure へ移し、それを**集約名のディレクトリ**
 * (`infrastructure/{集約}/`)に置くと、X1 の (b)(直下のディレクトリの分類)も (c)(adapter_root の下のファイルの宣言)も
 * X8(宣言したアダプタに閉包が届くか)も見ず、有料の連携の関門を全部通らずに外へ出られた。
 *
 * ここは製品の木(配置の `source-root`。テスト・`__tests__`・fake を除く)の**全ファイルの値の import** を AST で読み、2 つを見る ——
 *   (i) 宣言した SDK のパッケージ(外部連携の `sdk_packages` と土台の `sdkPackages`)は、その置き場(`adapter_root` / 土台の
 *       ディレクトリ)の下か、`client_ui` に名指したファイル(名指した包みだけ)でしか引けない
 *   (ii) 基盤の層の下のファイルが引く外部パッケージは、宣言した SDK(置き場の中)か枠の基盤のパッケージ(配置の
 *       `foundationPackages`)でなければならない(**宣言の無い SDK は赤**。Node の組み込み・仕組みの部品 `@kaninabe/*`・ソースの根の別名・相対は外部ではない)
 *   (iii) **外へ送る口**(`outbound-primitives.ts` の閉じた表: `safeFetch`・Node の通信の組み込み・`undici`)は、置き場(全部の外部連携の
 *       `adapter_root` と土台)の下でしか値で引けない(点検 10 回目 B10-3。SDK を REST に替えて集約名のディレクトリから外へ出る形を閉じる)
 * 指定子が字句でない動的 import / `require` は行き先が決まらないので赤(fail-closed)。型だけの import は実行時に何も呼ばないので見ない。
 *
 * 同じ表を ESLint の層の境界も読む(生成物 `sdk-homes.json`。`@kaninabe/lint-config/policies` の `sdkHomeBoundaries`)。
 * **アプリの語彙は 1 語も持たない**。
 */

import { builtinModules } from 'node:module';
import path from 'node:path';
import { FRAMEWORK_CODE_EXTENSIONS, isFile, toRelative, walkFiles } from '../io/paths.js';
import { readText } from '../io/read-text.js';
import type { Finding } from '../kernel/finding.js';
import { foundationPackagesOf, productSdkHomes } from '../model/framework-base-dirs.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import { anyPackageMatches, classifySpecifier } from '../model/external/sdk-packages.js';
import { outboundPrimitiveOf } from '../model/external/outbound-primitives.js';
import { layoutModule, layoutPath, layoutScan } from '../model/product/layout.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';
import { importsOfSource } from '../semantics/import-graph.js';

/** Node の組み込みの名前(`fs` など。`node:` の接頭辞の無い綴りも組み込みとして扱う)。 */
const BUILTINS: ReadonlySet<string> = new Set(builtinModules);

/** 置き場 1 つ(リポジトリルート相対のディレクトリ)。 */
interface Home {
  readonly owner: string;
  readonly dir: string;
  readonly packages: readonly string[];
}

/** (d) の入力。 */
export interface SdkPlacementInput {
  readonly catalog: ExternalCatalogSpec;
  readonly repoRoot: string;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}

/** テスト・fake・テスト支援を走査から除く。 */
function isProductSource(name: string): boolean {
  if (!FRAMEWORK_CODE_EXTENSIONS.some((extension) => name.endsWith(extension))) return false;
  return !/\.(test|spec|fake)\.[cm]?[jt]sx?$/u.test(name) && !name.endsWith('.d.ts');
}

/** パスがディレクトリの下か(区切りは `/`)。 */
function under(file: string, dir: string): boolean {
  return file.startsWith(`${dir}/`);
}

/** 外へ送る口を置き場の外で引いた 1 か所。 */
interface PrimitiveUse {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly primitive: string;
}

/**
 * 外へ送る口を置き場の外で値として引いた指摘。
 *
 * @param input (d) の入力
 * @param finding 指摘を X1 の形に組む関数
 * @param use 引いた場所と口
 * @param homes 置き場
 * @returns 指摘
 */
function primitiveFinding(input: SdkPlacementInput, finding: (args: Omit<Finding, 'verifier' | 'severity'>) => Finding, use: PrimitiveUse, homes: readonly Home[]): Finding {
  return finding({
    message:
      `${use.file}:${use.line} が外へ送る口 ${use.specifier} を値として引いています。外へ送る口(safeFetch・Node の通信の組み込み・undici)を置いてよいのは、` +
      `外部連携の adapter_root と土台の下だけです(${homes.map((home) => home.dir).join(' / ') || '置き場の宣言なし'})`,
    location: input.catalog.location,
    suggestion:
      '送信を、その相手の外部連携の adapter_root の下のアダプタに置き(相手が無ければ external.md の vocabulary.service に足す)、integrations の adapter / port に宣言する。有料の連携なら宣言した口(runPaidEntry)から呼ぶ',
    counterexample: { file: use.file, line: String(use.line), specifier: use.specifier, primitive: use.primitive },
  });
}

/**
 * 外部の SDK の置き場の閉世界を検証する(実装の木が無ければ 0 件)。
 *
 * @param input カタログ・リポジトリルート・根・配置
 * @param finding 指摘を X1 の形に組む関数
 * @returns 違反のリスト(ファイル順・出現順)
 */
export function checkSdkPlacement(input: SdkPlacementInput, finding: (args: Omit<Finding, 'verifier' | 'severity'>) => Finding): Finding[] {
  const source = layoutPath(input.layout, input.roots.app, 'source-root');
  if (source === null) return [];
  const infrastructure = layoutScan(input.layout, input.roots.app, 'infrastructure')?.dir ?? null;
  const services = input.catalog.vocabulary.service;
  const homes: readonly Home[] = [
    ...services.map((term) => ({ owner: `外部連携 ${term.id} の adapter_root`, dir: term.adapterRoot, packages: term.sdkPackages })),
    ...productSdkHomes(input.layout, input.roots.app).map((home) => ({ owner: `土台 ${home.path}(${home.role})`, dir: home.path, packages: home.packages })),
  ];
  const clientUi = new Map(services.flatMap((term) => term.clientUi.map((row) => [row.file, row.packages] as const)));
  const foundation = foundationPackagesOf(input.layout);
  const sourceModule = layoutModule(input.layout, 'source-root');
  const aliases = sourceModule === null ? [] : [`${sourceModule}/`];
  const findings: Finding[] = [];

  for (const [file] of clientUi) {
    if (isFile(path.join(input.repoRoot, file))) continue;
    findings.push(
      finding({
        message: `client_ui に名指した ${file} が実在しません`,
        location: input.catalog.location,
        suggestion: '実在するクライアントの部品のパス(リポジトリルート相対)に直すか、client_ui の行を消す',
        counterexample: { client_ui: file },
      }),
    );
  }

  const root = path.join(input.repoRoot, source);
  for (const absolute of walkFiles(root, isProductSource)) {
    const file = toRelative(input.repoRoot, absolute);
    if (file.split('/').includes('__tests__')) continue;
    for (const raw of importsOfSource(file, readText(absolute))) {
      if (raw.kind === 'type') continue;
      if (raw.opaque === true) {
        findings.push(
          finding({
            message: `${file}:${raw.line} の動的 import / require の指定子が字句ではありません(${raw.specifier || '引数なし'})。読み込む外部パッケージが字面から決まらない`,
            location: input.catalog.location,
            suggestion: '指定子を字句(文字列リテラル)で書く。外部の SDK なら external.md の sdk_packages に宣言し、その adapter_root の下で静的に import する',
            counterexample: { file, line: String(raw.line), specifier: raw.specifier },
          }),
        );
        continue;
      }
      const primitive = outboundPrimitiveOf(raw.specifier);
      if (primitive !== null) {
        if (!homes.some((home) => under(file, home.dir))) findings.push(primitiveFinding(input, finding, { file, line: raw.line, specifier: raw.specifier, primitive }, homes));
        continue;
      }
      const classified = classifySpecifier(raw.specifier, BUILTINS, aliases);
      if (classified.kind !== 'package' || classified.name === null) continue;
      const name = classified.name;
      const owners = homes.filter((home) => anyPackageMatches(home.packages, name));
      if (owners.length > 0) {
        if (owners.some((home) => under(file, home.dir))) continue;
        if ((clientUi.get(file) ?? []).includes(name)) continue;
        findings.push(
          finding({
            message: `${file}:${raw.line} が SDK のパッケージ ${raw.specifier} を値として引いています。置いてよいのは ${owners.map((home) => `${home.owner}(${home.dir})`).join(' / ')} の下だけです`,
            location: input.catalog.location,
            suggestion: `SDK の呼び出しを ${owners[0]?.dir ?? 'adapter_root'} の下のアダプタに置き、integrations の adapter / port に宣言して、有料の連携なら宣言した口(runPaidEntry)から呼ぶ。自サイトの口とだけ話すクライアントの部品なら external.md の client_ui に名指す`,
            counterexample: { file, line: String(raw.line), specifier: raw.specifier },
          }),
        );
        continue;
      }
      if (infrastructure === null || !under(file, infrastructure) || anyPackageMatches(foundation, name)) continue;
      findings.push(
        finding({
          message: `${file}:${raw.line} が宣言の無い外部パッケージ ${raw.specifier} を値として引いています(基盤の層が引ける外部パッケージは、宣言した SDK と枠の基盤のパッケージだけ)`,
          location: input.catalog.location,
          suggestion: `外部サービスの SDK なら external.md の vocabulary.service に sdk_packages: [${name}] を宣言し、その adapter_root の下に置く。接続層の SDK なら置き場の配置の土台の sdkPackages に足す`,
          counterexample: { file, line: String(raw.line), specifier: raw.specifier },
        }),
      );
    }
  }
  return findings;
}
