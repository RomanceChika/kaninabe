/**
 * 画面検証器(S1〜S10)のテスト用ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器のテストはファイル I/O を行わず、
 * 入力をテスト内でリテラル構築する。ここではその定型部分(location の埋め草・
 * 省略可能フィールドの扱い・レイアウトの平坦化)だけを引き受ける。
 * ドメイン側(SpecModel)の構築は model-builder.ts、query_spec は query-builder.ts を使う。
 *
 * ガードサービスは S5 が式の解析結果そのものを見るため、スタブではなく実物を注入する
 * (文法の正は 1 つであり、テストが別の文法を持つと検査の意味が変わるため)。
 */

import type { SpecModel } from '../../lib/model/types.js';
import type { QuerySpec } from '../../lib/model/query/types.js';
import { buildTcRegistry } from '../../lib/testcase/registry.js';
import { collectTcEntries } from '../../lib/spec-index/sources.js';
import { createGuardServices } from '../../lib/guard/services.js';
import { expandChromeNavigations } from '../../lib/model/screen/expand-chrome.js';
import type { ScreenContext } from '../../lib/screen/verifier.js';
import type { AppRoutesModel } from '../../lib/model/screen/app-types.js';
import type { AuthSpecModel } from '../../lib/model/auth/types.js';
import type { UsecaseSpecModel } from '../../lib/model/usecase/types.js';
import type { TestScanResult } from '../../lib/testcase/types-scan.js';
import type {
  ChromeSpec,
  LayoutSlot,
  RequiredState,
  ScreenInput,
  ScreenLayout,
  ScreenSmoke,
  ScreenSpec,
  ScreenTestCase,
} from '../../lib/model/screen/types.js';
import { specModel } from './model-builder.js';
import { TEST_LAYOUT } from './platform.js';
import { TEST_ROOTS } from './product-roots.js';

/** 全画面検証器テストで共有してよい(状態を持たない)。 */
export const SCREEN_CTX: ScreenContext = {
  roots: TEST_ROOTS,
  layout: TEST_LAYOUT,
  guards: createGuardServices(),
  manualOperations: new Set(),
  operationInputs: new Map(),
  confirmRequiredOperations: new Set(),
  reachabilityGaps: [],
  blockedInputs: [],
};

/** 部品 1 つの宣言。文字列は素の部品、マッピングは排他表示(variants)や表示名(label)を持つ部品。 */
export type ComponentInit =
  | string
  | {
      readonly name: string;
      readonly variant?: string;
      readonly group?: number;
      readonly label?: string;
      /** 生成物の宣言(`form` は `action` と、`table` / `detail` は `reads` と組で書く。S17 / S18 のテスト用)。 */
      readonly kind?: 'form' | 'table' | 'detail' | 'actions' | 'platform_read' | 'platform_actions';
      /** `kind: form` の部品が載せる操作(文字列 1 つか一覧)。 */
      readonly action?: string | readonly string[];
      /** 部品が出す読みの query_spec ID(`kind: table` / `detail` は必須・`kind: form` は選択肢の出どころ)。 */
      readonly reads?: string;
      /** `kind: table` / `detail` が出す欄(省略 = 全欄)。 */
      readonly shows?: readonly string[];
      /** `kind: table` が行をその場で編集する操作(S19 のテスト用)。 */
      readonly edit?: string;
      /** `kind: table` / `actions` がボタンにする操作の一覧(S19 のテスト用)。 */
      readonly buttons?: readonly string[];
      /** `kind: platform_read` が表にするプラットフォーム操作(S20 のテスト用)。 */
      readonly op?: string;
      /** `kind: platform_actions` が載せるプラットフォーム操作(S20 のテスト用)。 */
      readonly ops?: readonly string[];
      /** 行ごとのボタンにするプラットフォーム操作(S20 のテスト用)。 */
      readonly rowActions?: readonly string[];
    };

/** スロットの宣言(スロット名 → コンポーネント名の並び)。入れ子は `owner` で表す。 */
export interface SlotInit {
  /** スロットの局所名(例: header / body.center)。 */
  readonly slot: string;
  readonly components: readonly ComponentInit[];
  /** 入れ子の親コンポーネント名(省略時はトップレベル)。 */
  readonly owner?: string;
  /** 入れ子の親スロットのフルパス(省略時はトップレベル)。 */
  readonly under?: string;
}

/** 平坦なスロット宣言から ScreenLayout を作る(パーサーと同じくフルパスを組み立てる)。 */
export function layout(file: string, slots: readonly SlotInit[]): ScreenLayout {
  const built: LayoutSlot[] = slots.map((slot) => {
    const path =
      slot.owner === undefined ? slot.slot : `${slot.under ?? 'body.center'}.${slot.owner}.${slot.slot}`;
    return {
      slot: slot.slot,
      path,
      owner: slot.owner ?? null,
      components: slot.components.map((component) => {
        const name = typeof component === 'string' ? component : component.name;
        const location = { file, pointer: `layout.${path}.${name}` };
        if (typeof component === 'string') return { name, location };
        return {
          name,
          ...(component.label === undefined ? {} : { label: component.label }),
          ...(component.variant === undefined
            ? {}
            : { variant: { group: component.group ?? 0, key: component.variant, location } }),
          ...(component.kind === undefined ? {} : { kind: component.kind }),
          ...(component.action === undefined
            ? {}
            : {
                actionRefs: [component.action].flat().map((id, index) => ({
                  id,
                  location: { file, pointer: `layout.${path}.${name}.action[${index}]` },
                })),
              }),
          ...(component.reads === undefined
            ? {}
            : { readRef: { id: component.reads, location: { file, pointer: `layout.${path}.${name}.reads` } } }),
          ...(component.shows === undefined
            ? {}
            : {
                showRefs: component.shows.map((id, index) => ({
                  id,
                  location: { file, pointer: `layout.${path}.${name}.shows[${index}]` },
                })),
              }),
          ...(component.edit === undefined
            ? {}
            : { editRef: { id: component.edit, location: { file, pointer: `layout.${path}.${name}.edit` } } }),
          ...(component.buttons === undefined
            ? {}
            : {
                buttonRefs: component.buttons.map((id, index) => ({
                  id,
                  location: { file, pointer: `layout.${path}.${name}.actions[${index}]` },
                })),
              }),
          ...(component.op === undefined
            ? {}
            : { platformOpRef: { id: component.op, location: { file, pointer: `layout.${path}.${name}.op` } } }),
          ...(component.ops === undefined
            ? {}
            : {
                platformOpRefs: component.ops.map((id, index) => ({
                  id,
                  location: { file, pointer: `layout.${path}.${name}.ops[${index}]` },
                })),
              }),
          ...(component.rowActions === undefined
            ? {}
            : {
                rowActionRefs: component.rowActions.map((id, index) => ({
                  id,
                  location: { file, pointer: `layout.${path}.${name}.row_actions[${index}]` },
                })),
              }),
          location,
        };
      }),
      location: { file, pointer: `layout.${path}` },
    };
  });
  return { declared: true, slots: built, location: { file, pointer: 'layout' } };
}

/** screen_spec 1 件を作る。name から id・relPath・ファイルパスを既定で導く。 */
export function screenSpec(init: {
  name: string;
  label?: string;
  route?: string;
  group?: string;
  for?: readonly string[];
  chrome?: string;
  entryPoint?: boolean;
  requiresAuth?: boolean;
  subject?: string;
  precondition?: string;
  onFail?: string;
  reads?: readonly string[];
  actions?: readonly string[];
  usecases?: readonly string[];
  /** この画面が露出するプラットフォーム操作の id(S20 / S21 のテスト用)。 */
  platformOps?: readonly string[];
  navigations?: readonly { on: string; to: string; viaChrome?: string }[];
  overlays?: readonly OverlayInit[];
  slots?: readonly SlotInit[];
  requires?: readonly RequiredState[];
  testCases?: readonly ScreenTestCase[];
  smoke?: readonly { summary: string; file: string; testName: string }[];
  /** UX 原則の受け入れ(`ux:`。reason を省略すると既定の理由が入る)。 */
  ux?: readonly { principle: string; subject?: string; reason?: string }[];
}): ScreenSpec {
  const group = init.group ?? 'sample';
  const relPath = `${group}/${init.name}.md`;
  const file = `docs/specs/frontend/screens/${relPath}`;
  return {
    id: screenId(init.name),
    name: init.name,
    ...(init.label === undefined ? {} : { label: init.label }),
    route: init.route ?? `/${init.name}`,
    ...(init.chrome === undefined
      ? {}
      : { chrome: { id: init.chrome, location: { file, pointer: 'chrome' } } }),
    forRoles: init.for ?? ['member'],
    entryPoint: init.entryPoint ?? false,
    requiresAuth: init.requiresAuth ?? false,
    ...(init.subject === undefined
      ? {}
      : { subject: { entity: init.subject, location: { file, pointer: 'subject' } } }),
    ...(init.precondition === undefined
      ? {}
      : { precondition: { source: init.precondition, location: { file, pointer: 'precondition' } } }),
    ...(init.onFail === undefined
      ? {}
      : {
          onFail: {
            raw: `redirect(${init.onFail})`,
            screen: init.onFail,
            location: { file, pointer: 'on_fail' },
          },
        }),
    reads: (init.reads ?? []).map((id, index) => ({
      id,
      location: { file, pointer: `reads[${index}]` },
    })),
    actions: (init.actions ?? []).map((id, index) => ({
      id,
      location: { file, pointer: `actions[${index}]` },
    })),
    usecases: (init.usecases ?? []).map((id, index) => ({
      id,
      location: { file, pointer: `usecases[${index}]` },
    })),
    platformOps: (init.platformOps ?? []).map((id, index) => ({
      id,
      location: { file, pointer: `platform_ops[${index}]` },
    })),
    navigations: (init.navigations ?? []).map((navigation, index) => ({
      ...navigation,
      location: { file, pointer: `navigations[${index}]` },
    })),
    overlays: (init.overlays ?? []).map((overlay, index) => ({
      id: overlay.id,
      layout: layout(file, overlay.slots ?? [{ slot: 'body.center', components: ['dialog_body'] }]),
      ...(overlay.openedBy === undefined ? {} : { openedBy: overlay.openedBy }),
      ...(overlay.label === undefined ? {} : { label: overlay.label }),
      actions: (overlay.actions ?? []).map((id, at) => ({
        id,
        location: { file, pointer: `overlays[${index}].actions[${at}]` },
      })),
      platformOps: (overlay.platformOps ?? []).map((id, at) => ({
        id,
        location: { file, pointer: `overlays[${index}].platform_ops[${at}]` },
      })),
      closesOn: overlay.closesOn ?? [],
      location: { file, pointer: `overlays[${index}]` },
    })),
    layout: layout(file, init.slots ?? [{ slot: 'body.center', components: ['content'] }]),
    requiredStates: init.requires ?? [],
    testCases: init.testCases ?? [],
    smoke: (init.smoke ?? []).map((entry, index) => screenSmoke(file, index, entry)),
    ux: (init.ux ?? []).map((decl, index) => ({
      principle: decl.principle,
      subject: decl.subject ?? '',
      reason: decl.reason ?? 'この画面ではこの UX でよいと判断したため',
      location: { file, pointer: `ux[${index}]` },
    })),
    relPath,
    location: { file },
  };
}

/** smoke[] の 1 件を作る(S11 のテスト用)。 */
function screenSmoke(
  file: string,
  index: number,
  entry: { summary: string; file: string; testName: string },
): ScreenSmoke {
  const raw = `${entry.file}::${entry.testName}`;
  return {
    summary: entry.summary,
    implementation: { raw, file: entry.file, testName: entry.testName },
    location: { file, pointer: `smoke[${index}]` },
  };
}

/** 画面名から id を導く(パーサーと同じ規則)。 */
export function screenId(name: string): string {
  return `screen-${name.split('_').join('-')}`;
}

/** 重ね表示 1 件の宣言。 */
export interface OverlayInit {
  readonly id: string;
  readonly openedBy?: string;
  /** 確認の見出し。 */
  readonly label?: string;
  readonly actions?: readonly string[];
  /** この重ね表示が発火するプラットフォーム操作(S20 のテスト用)。 */
  readonly platformOps?: readonly string[];
  readonly closesOn?: readonly string[];
  readonly slots?: readonly SlotInit[];
}

/** chrome_spec 1 件を作る。 */
export function chromeSpec(init: {
  name: string;
  label?: string;
  slots?: readonly SlotInit[];
  navigations?: readonly { on: string; to: string }[];
}): ChromeSpec {
  const relPath = `${init.name}.md`;
  const file = `docs/specs/frontend/chrome/${relPath}`;
  return {
    id: `chrome-${init.name.split('_').join('-')}`,
    name: init.name,
    ...(init.label === undefined ? {} : { label: init.label }),
    layout: layout(file, init.slots ?? [{ slot: 'header', components: ['app_header'] }]),
    navigations: (init.navigations ?? []).map((navigation, index) => ({
      ...navigation,
      location: { file, pointer: `navigations[${index}]` },
    })),
    relPath,
    location: { file },
  };
}

/**
 * ScreenInput を組み立てる。省略した入力は「空」になる。
 *
 * テストケース ID 台帳は渡された仕様から自動で構築し、共有クロームの遷移も
 * ローダーと同じ規則で展開する(検査が見るモデルを、実際に流れてくるものと同じ形に保つため)。
 */
export function screenInput(
  init: {
    domain?: SpecModel;
    queries?: readonly QuerySpec[];
    /** query_spec を「まだ書いていない」状態にする(available: false)。 */
    queriesUnavailable?: boolean;
    screens?: readonly ScreenSpec[];
    chromes?: readonly ChromeSpec[];
    /** 実装側のルート(S7 の突合先)。省略時は「app/ がまだ無い」= S7 は何も見ない。 */
    app?: AppRoutesModel;
    /** app/ のテスト走査結果(S8 の突合先)。省略時は「app/ がまだ無い」= S8 は何も見ない。 */
    tests?: TestScanResult;
    /** UI 到達の免除宣言(S10 が読む screens/README.md のフロントマター相当)。 */
    unexposed?: readonly { event: string; reason?: string }[];
    /** 状態×ロールの到達の免除宣言(S13 が読む screens/README.md のフロントマター相当)。 */
    unreachableStates?: readonly { transition: string; state: string; role: string; reason?: string }[];
    /** 状態の可視性の免除宣言(S14 が読む screens/README.md のフロントマター相当)。 */
    unseenStates?: readonly { state: string; reason?: string }[];
    /** screen_spec を「まだ書いていない」状態にする(available: false)。 */
    screensUnavailable?: boolean;
    /** 読み込み済みの auth_spec(S13 が読む)。省略時は「auth_spec がまだ無い」。 */
    auth?: AuthSpecModel;
    /** 読み込み済みの usecase_spec(S16 が読む)。省略時は「タスクをまだ仕様化していない」。 */
    usecases?: UsecaseSpecModel;
  } = {},
): ScreenInput {
  const queries = {
    available: init.queriesUnavailable !== true,
    queries: init.queries ?? [],
  };
  const chromes = init.chromes ?? [];
  const screens = {
    available: init.screensUnavailable !== true,
    screens: expandChromeNavigations(init.screens ?? [], chromes),
    chromes,
    unexposed: (init.unexposed ?? []).map((decl) => ({
      event: decl.event,
      reason: decl.reason ?? '画面が未着手のため',
      location: { file: 'docs/specs/frontend/screens/README.md', pointer: `unexposed.${decl.event}` },
    })),
    unreachableStates: (init.unreachableStates ?? []).map((decl) => ({
      transition: decl.transition,
      state: decl.state,
      role: decl.role,
      reason: decl.reason ?? '到達する画面がまだ無いため',
      location: {
        file: 'docs/specs/frontend/screens/README.md',
        pointer: `unreachable_states.${decl.transition}/${decl.state}/${decl.role}`,
      },
    })),
    unseenStates: (init.unseenStates ?? []).map((decl) => ({
      state: decl.state,
      reason: decl.reason ?? 'まだ見せる読み取り経路が無いため',
      location: { file: 'docs/specs/frontend/screens/README.md', pointer: `unseen_states.${decl.state}` },
    })),
  };
  return {
    domain: init.domain ?? specModel([]),
    queries,
    screens,
    app: init.app ?? NO_APP,
    registry: buildTcRegistry(collectTcEntries({ queries, screens })),
    tests: init.tests ?? NO_TESTS,
    auth: init.auth ?? NO_AUTH,
    usecases: init.usecases ?? { available: false, usecases: [] },
  };
}

/** auth_spec を読めていない状態。S13 以外の検証器テストはこれを使う。 */
const NO_AUTH: AuthSpecModel = { available: false, flow: null };

/** app/ のテストを走査できていない状態。S8 以外の検証器テストはこれを使う。 */
const NO_TESTS: TestScanResult = {
  available: false,
  testFiles: [],
  annotations: [],
  actionFiles: [],
  operationFiles: [],
};

/** 実装(app/)を読めていない状態。S7 以外の検証器テストはこれを使う。 */
const NO_APP: AppRoutesModel = {
  available: false,
  routes: [],
  proxy: { available: false, file: 'app/src/proxy.ts', patterns: [] },
};

/**
 * 実ルート(S7 の入力)を組み立てる。
 *
 * @param init 実ルートの一覧と proxy の matcher(省略時は matcher を読めていない状態)
 * @returns S7 に渡す AppRoutesModel
 */
export function appRoutes(init: {
  routes: readonly string[];
  matcher?: readonly string[];
  metadata?: Readonly<Record<string, AppRoutesModel['routes'][number]['metadata']>>;
}): AppRoutesModel {
  return {
    available: true,
    routes: init.routes.map((route) => ({
      route,
      file: `app/src/app${route === '/' ? '' : route}/page.tsx`,
      metadata: init.metadata?.[route] ?? { kind: 'none' as const },
    })),
    proxy: {
      available: init.matcher !== undefined,
      file: 'app/src/proxy.ts',
      patterns: init.matcher ?? [],
    },
  };
}
