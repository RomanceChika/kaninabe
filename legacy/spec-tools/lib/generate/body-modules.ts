/**
 * 生成物の**本文が import する先**(モジュール指定)を、置き場の配置から引く口(部品化 ③-e1)。
 *
 * 生成物の本文(Server Action ・組み立ての根・フォーム ・生成テスト ・ハーネスのアダプタ)は、生成物の根の下のモジュールと、製品が手で書く接続点
 * (時計・認証の組み立て・DB への口の束・UI 部品・hooks ・純関数)を import する。その**指定子の綴り**(別名の接頭辞・ソースの根の基準)は、アプリの枠の後段が
 * 配置の値として持つ(`lib/targets/<後段>/layout.ts`)。ここが持つのは「どの役割のどのキーを引くか」だけで、生成器は指定子の文字列を自分では書かない
 * (配置を差し替えれば、同じ本文の生成器が別の綴りの指定子を出す)。
 *
 * - **生成物の根の下**(`generated(名前)`)は、役割ではなく**製品の宣言の `roots.generated`** が決める(置き場を配置にも書くと、同じ事実が二重になり食い違える)。
 *   指定子は「ソースの根の別名 + `roots.generated` のソースの根からの相対 + 名前」。
 * - **手書きの接続点**は配置の役割(`operation-hooks` ほか)の `module`。
 *
 * 決められなければ前提の失敗で止める(`layout-placement.ts`。名指すのは配置の定義の検査 — 配置に無い役割・基準が辿れない配置は、選ぶ根の 1 回の検査が先に止める)。
 * 純関数で、実装の木を持たない製品では呼ばれない(呼び手が先に何も出さずに返す)。
 */

import type { GenerateContext } from '../gen-kit/generator.js';
import type { SourceLocation } from '../kernel/source-location.js';
import { LAYOUT_DEFINITION_CHECK, placedModule, placedPath } from './layout-placement.js';
import { preconditionFailure } from '../kernel/generator-precondition.js';
import { generatedModuleOf, pathWithin, sourceRootPath } from '../model/product/layout.js';
import type { LayoutRole } from '../model/product/layout.js';

/** 本文を書く側の出どころ(前提の失敗が名指す。人が読む名前と、その元の仕様の位置)。 */
export interface BodyOrigin {
  /** 人が読む出どころ(例: `画面 sample のフォーム`)。 */
  readonly what: string;
  /** 出どころの仕様の位置。 */
  readonly location: SourceLocation;
}

/** 生成物の本文が import する先の解決(役割 + キー → モジュール指定)。 */
export interface BodyModules {
  /** 生成物の根の下のモジュール(`名前` は拡張子なし。例: `jobs` ・`{表}.labels`)。 */
  generated(name: string): string;
  /** ソースの根の下のファイル(リポジトリルート相対のパス。拡張子 `.ts` は落とす)。ソースの根の外のパス・`.ts` でないパスは前提の失敗で止める。 */
  sourceFile(path: string): string;
  /** 操作の hooks(操作 ID `{集約}.{イベント}`)。 */
  operationHooks(operation: string): string;
  /** `computes` が名指す手書きの純関数(参照)。 */
  computes(ref: string): string;
  /** 画面の入場判定の手書きの純関数。 */
  preflight(): string;
  /** 手書きの UI 部品(拡張子なしのファイル名)。 */
  component(file: string): string;
  /** 認証の組み立ての根。 */
  auth(): string;
  /** 時計の口。 */
  clock(): string;
  /** DB への口の束を組む配線。 */
  dbPorts(): string;
  /** リクエスト前段のセッションの更新。 */
  sessionRefresh(): string;
  /** 認証基盤の操作の配線先(手書きのポートの配線。キーはポートの型名)。 */
  platformBinding(port: string): string;
  /** 認証基盤の操作の配線先の、生成テストの場面(手書きの `{配線}.scenario`。配線の指定子に接尾辞を足した綴り)。 */
  platformScenario(port: string): string;
  /** 認証基盤の操作の組み立ての根(生成物。キーは操作 ID)。 */
  platformComposition(operation: string): string;
}

/** 文脈のうち、指定子の解決に要る欄(配置と製品の根)。 */
export type BodyModulesContext = Pick<GenerateContext, 'layout' | 'roots'>;

/** ソースの根の下のファイルの指定を決められないときに名指す検査(受信口のアダプタのパスを見る X 群の閉世界の検査)。 */
const SOURCE_FILE_CHECK = 'X1';

/** 役割ごとの、前提の失敗に載せる呼び名。 */
const ROLE_LABELS: Readonly<Partial<Record<LayoutRole, string>>> = {
  'operation-hooks': '操作の hooks',
  'computes-module': '手書きの純関数',
  'preflight-module': '入場判定の純関数',
  'shared-component': '手書きの UI 部品',
  'auth-composition': '認証の組み立ての根',
  'system-clock': '時計の口',
  'db-ports': 'DB への口の束を組む配線',
  'session-refresh': 'リクエスト前段のセッションの更新',
  'platform-binding': '認証基盤の操作の配線先',
  'platform-op-composition': '認証基盤の操作の組み立ての根',
};

/**
 * 生成物の本文が import する先の解決を作る。
 *
 * @param ctx 生成の文脈(配置と製品の根だけ見る)
 * @param origin 本文を書く側の出どころ(置き場を決められないときに指す)
 * @returns 役割 + キー → モジュール指定の解決(決められなければ前提の失敗で止める)
 */
export function bodyModulesOf(ctx: BodyModulesContext, origin: BodyOrigin): BodyModules {
  const { layout, roots } = ctx;
  const through = (role: LayoutRole, key?: string): string =>
    placedModule(layout, {
      role,
      ...(key === undefined ? {} : { key }),
      what: `${origin.what}が import する${ROLE_LABELS[role] ?? role}`,
      location: origin.location,
      verifier: LAYOUT_DEFINITION_CHECK,
    });
  const generatedModule = (name: string): string => {
    const found = generatedModuleOf(layout, roots, name);
    if (found !== null) return found;
    const what = `${origin.what}が import する生成物 ${name === '' ? '(名前が空)' : name}`;
    return preconditionFailure(LAYOUT_DEFINITION_CHECK, [
      {
        message:
          name === ''
            ? `${what} の import の指定を決められません(生成物のモジュールの名前が空です)`
            : `${what} の import の指定を決められません(配置に source-root の置き場と module が無いか、製品の roots.generated(${roots.generated})が配置の source-root の外にあります)`,
        suggestion: '製品の宣言の roots.generated を、アプリの枠の後段の配置の source-root の中に置く(配置の定義の検査 — 選ぶ根の 1 回 — が先に止める)',
        counterexample: { generated: roots.generated, sourceRoot: sourceRootPath(layout, roots) ?? '(なし)' },
        location: origin.location,
      },
    ]);
  };
  const sourceFileModule = (path: string): string => {
    const placement = { what: `${origin.what}が import するソース ${path}`, location: origin.location, verifier: LAYOUT_DEFINITION_CHECK };
    const alias = placedModule(layout, { role: 'source-root', ...placement });
    const source = placedPath(layout, roots, { role: 'source-root', ...placement });
    const inside = pathWithin(source, path);
    if (inside !== null && inside !== '' && path.endsWith('.ts')) return `${alias}/${inside.replace(/\.ts$/, '')}`;
    return preconditionFailure(SOURCE_FILE_CHECK, [
      {
        message: `${placement.what} の import の指定を決められません(${inside === null || inside === '' ? `パスが配置の source-root(${source})の中のファイルではありません` : 'パスの拡張子が .ts ではありません'})`,
        suggestion: `製品の仕様が書くパス(連携の adapter)を、配置の source-root(${source})の下の .ts のファイルにそろえる(アダプタの実在は X1 が見る)`,
        counterexample: { path, sourceRoot: source },
        location: origin.location,
      },
    ]);
  };
  return {
    generated: generatedModule,
    sourceFile: sourceFileModule,
    operationHooks: (operation) => through('operation-hooks', operation),
    computes: (ref) => through('computes-module', ref),
    preflight: () => through('preflight-module'),
    component: (file) => through('shared-component', file),
    auth: () => through('auth-composition'),
    clock: () => through('system-clock'),
    dbPorts: () => through('db-ports'),
    sessionRefresh: () => through('session-refresh'),
    platformBinding: (port) => through('platform-binding', port),
    platformScenario: (port) => `${through('platform-binding', port)}.scenario`,
    platformComposition: (operation) => through('platform-op-composition', operation),
  };
}
