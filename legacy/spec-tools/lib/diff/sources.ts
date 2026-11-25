/**
 * 「差分の元」の一覧 —— **どの生成物を比べると意味の差が出るか**の宣言。
 *
 * ここだけがパスを知っており、読み方(git / ワークツリー)は I/O 層に渡す。
 * 元に選ぶ条件は 1 つ、**書き方の差を持たないこと**である —— 仕様(YAML)の差を直接読むと
 * 並び替え・コメントの変更が意味の変更と混ざるが、生成物は意味だけを持つ(設計メモ §0)。
 *
 * 各行の `why` は「**なぜそれが意味を持つか**」の 1 行であり、軸を足したくなったとき
 * 「その生成物に意味が畳まれているか」を先に問うための宣言である。
 * **読まない生成物にも理由を書く**(`IGNORED_SOURCES`) —— 一覧に無いものが「まだ考えて
 * いない」なのか「考えた上で落とした」なのかが読めないと、軸の穴が穴のまま残る。
 *
 * 純粋であり I/O を持たない。**アプリの語彙は 1 語も持たない。**
 */

import type { DiffAxis } from './types.js';
import { bookPath, generatedPath } from '../model/product/paths.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * 生成物の置き場と結果表の置き場(リポジトリルート相対)。
 *
 * **どちらも製品が宣言した根から組み立てる。** 差分の元は製品の生成物であり、その住所を
 * 差分器が綴りで知っていてはならない(W3)。
 */
function generatedDir(roots: ProductRoots): string {
  return generatedPath(roots);
}

/** 結果表の元データの置き場(読み物の中の位置は仕組みが決めている形)。 */
function resultsDir(roots: ProductRoots): string {
  return bookPath(roots, 'assets/results');
}

/** 規則の表の接尾辞(権限の軸の第 2 の元。`rules.ts` が家族ごとの読み方を持つ)。 */
export const RULE_SUFFIX = {
  creates: '.creates.ts',
  writes: '.writes.ts',
  deletes: '.deletes.ts',
  transitions: '.transitions.ts',
} as const;

/** 差分の元 1 本。 */
export interface DiffSource {
  /** どの軸の材料か(表示用。1 本が複数の軸を養うこともある)。 */
  readonly axes: readonly DiffAxis[];
  /** 1 本のファイル、またはディレクトリ直下の接尾辞そろい。 */
  readonly kind: 'file' | 'glob';
  /** `kind: 'file'` ならパス、`kind: 'glob'` ならディレクトリ。 */
  readonly path: string;
  /** `kind: 'glob'` のときの接尾辞。 */
  readonly suffix?: string;
  /** なぜそれが意味を持つか(1 行)。 */
  readonly why: string;
}

/**
 * 差分の元の全数(これ以外は読まない)。
 *
 * 仕様(`docs/specs/**`)はここに**入れない** —— 意味は生成物に畳まれており、仕様を直接
 * 読むと書き方の差が混ざる。
 */
export function diffSources(roots: ProductRoots): readonly DiffSource[] {
  return [
  {
    axes: ['permission', 'operations'],
    kind: 'glob',
    path: resultsDir(roots),
    suffix: '.json',
    why: '結果表の全列挙。操作 × 実行者 × 状態 × 境界 → 可否と理由が 1 行ずつ並ぶので、権限の意味はここに畳まれている',
  },
  {
    axes: ['permission'],
    kind: 'glob',
    path: generatedDir(roots),
    suffix: RULE_SUFFIX.creates,
    why: '作成の規則。結果表が world を作れない集約ではこちらだけが「誰が作れるか」を持つ',
  },
  {
    axes: ['permission'],
    kind: 'glob',
    path: generatedDir(roots),
    suffix: RULE_SUFFIX.writes,
    why: '編集の規則。ロール × 欄の組み合わせが「誰が何を書き換えられるか」そのもの',
  },
  {
    axes: ['permission'],
    kind: 'glob',
    path: generatedDir(roots),
    suffix: RULE_SUFFIX.deletes,
    why: '削除の規則。消せる相手と条件はここにしかない',
  },
  {
    axes: ['permission', 'notifications'],
    kind: 'glob',
    path: generatedDir(roots),
    suffix: RULE_SUFFIX.transitions,
    why: '遷移の by・端・条件(権限)と効果 effects(通知の発火元)。どちらもこの表にしかない',
  },
  {
    axes: ['operations'],
    kind: 'file',
    path: generatedPath(roots, `operation-plans.ts`),
    why: '実行計画の鍵が「計画を導出できた操作」の全数であり、操作そのものの出入りがここに出る',
  },
  {
    axes: ['operations'],
    kind: 'file',
    path: generatedPath(roots, `usecase-plans.ts`),
    why: '保存点の実行計画の鍵。複数手順をまとめて実行する経路の出入りがここに出る',
  },
  {
    axes: ['rows'],
    kind: 'file',
    path: generatedPath(roots, `rls-expectations.ts`),
    why: 'select ポリシーの名前が「どの表の行をどのロールがどの範囲で読めるか」を綴りで持ち、条件本文の差し替えは migration の在処に出る',
  },
  {
    axes: ['columns'],
    kind: 'file',
    path: generatedPath(roots, `api-expectations.ts`),
    why: '外に出る面(ビュー)の列・隠し列が解ける相手・外から呼べる RPC の閉世界',
  },
  {
    axes: ['notifications'],
    kind: 'file',
    path: generatedPath(roots, `notifications.ts`),
    why: '送る通知の閉世界。宛先・発火のしかたが 1 本ずつ宣言されている',
  },
  {
    axes: ['notifications'],
    kind: 'file',
    path: generatedPath(roots, `roles.ts`),
    why: 'ロールの含意(A は必ず B である)。宛先が広がったか狭まったかの**順序**をここから取る。この表だけが動いても行は出さない',
  },
  {
    axes: ['screens'],
    kind: 'file',
    path: generatedPath(roots, `screens.ts`),
    why: '画面が起こせると宣言した操作・出ていける先・入場の関門(サインインと見るロール)',
  },
  ];
}

/**
 * 文の名詞を ID の羅列にしないための表示名(**判定には使わない**)。
 *
 * 表示名だけが動いた版で差分の行が出てはならないので、元の一覧とは分けて持つ。
 */
export function labelSources(roots: ProductRoots): readonly DiffSource[] {
  return [
  {
    axes: [],
    kind: 'glob',
    path: generatedDir(roots),
    suffix: '.labels.ts',
    why: '状態とイベントの表示名(仕様の label の写し)',
  },
  ];
}

/** 読まない生成物 1 本(または 1 群)と、その理由。 */
export interface IgnoredSource {
  /** パス、または接尾辞の綴り。 */
  readonly path: string;
  /** なぜ 6 軸の元にしないか(1 行)。 */
  readonly why: string;
}

/**
 * **読まない生成物と、その理由。**
 *
 * 6 軸(設計メモ §1)の外にある生成物であり、「まだ考えていない」ではなく「考えた上で
 * 落とした」ことをここで報告する。軸を増やす議論はこの一覧の行を消すことから始まる。
 */
export function ignoredSources(roots: ProductRoots): readonly IgnoredSource[] {
  return [
  {
    path: generatedPath(roots, `auth.ts`),
    why: 'サインイン時の分岐の決定表。**6 軸の外**(関門は画面の軸が `requiresAuth` / 見るロールで見る)。決定表そのものを軸にするなら「入場」の 7 軸目を開ける議論が要る',
  },
  {
    path: generatedPath(roots, `jobs.ts`),
    why: 'ジョブのカタログ。誰が何をできるかではなく「いつ走るか」であり、権限・可視・公開のどれにも畳めない',
  },
  {
    path: generatedPath(roots, `config.ts`),
    why: '設定カタログ。値は環境に属し、仕様の意味ではない(鮮度と双方向は K1 / K2 が見る)',
  },
  {
    path: generatedPath(roots, `external-expectations.ts`),
    why: '外部連携の宣言。外へ出る情報の差は「公開される欄」に近いが、**面が違う**(API スキーマではなく相手先)。軸を分けるかは別の議論',
  },
  {
    path: generatedPath(roots, `paid-entries.ts`),
    why: '有料の口の定数表(本文の上限・口を使える役・枠を消費する RPC)。口の Route Handler が共通の入口へ渡す値の出どころで、誰が何をできるかの宣言ではない(役は外部連携の宣言 `authz` が持ち、口の実装が表を読んでいるかは X8 が見る)',
  },
  {
    path: generatedPath(roots, `*.schema.ts`),
    why: '入力の zod。**受け取る形**であって誰に何が見えるかではない(公開される欄は API の期待表が持つ)',
  },
  {
    path: generatedPath(roots, `invariants.ts`),
    why: '不変条件の文面。破れないことの宣言であって、誰ができるかの宣言ではない(6 軸の外。公理の側の差分 `axioms.ts` が別に読む)',
  },
  {
    path: generatedPath(roots, `query-windows.ts`),
    why: '読み取りのスコープ条件。見える**行**の判定は RLS の期待表が持ち、スコープ条件はその上の絞り込みである(二重に数えない)',
  },
  {
    path: generatedPath(roots, `testids.ts`),
    why: 'テストケースの宣言。人が読む意味を 1 つも持たない',
  },
  ];
}

/** 結果表の元データか(パスの規則で判る)。 */
export function isResultsPath(path: string, roots: ProductRoots): boolean {
  return path.startsWith(`${resultsDir(roots)}/`) && path.endsWith('.json');
}

/** 遷移表の生成物か。 */
export function isTransitionsPath(path: string, roots: ProductRoots): boolean {
  return path.startsWith(`${generatedDir(roots)}/`) && path.endsWith(RULE_SUFFIX.transitions);
}

/** 規則の表(作成 / 編集 / 削除 / 遷移)か。 */
export function isRulesPath(path: string, roots: ProductRoots): boolean {
  if (!path.startsWith(`${generatedDir(roots)}/`)) return false;
  return Object.values(RULE_SUFFIX).some((suffix) => path.endsWith(suffix));
}

/** 表示名の生成物か。 */
export function isLabelsPath(path: string, roots: ProductRoots): boolean {
  return path.startsWith(`${generatedDir(roots)}/`) && path.endsWith('.labels.ts');
}

/** パスから機械・集約の名前を取る(`{名前}.transitions.ts` / `{名前}.labels.ts` / `{名前}.json`)。 */
export function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.indexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

/** 元のパス(ロールの表示名と含意の在処)。 */
export function roleLabelsPath(roots: ProductRoots): string {
  return generatedPath(roots, 'roles.ts');
}

/** 元のパス(実行計画)。 */
export function operationPlansPath(roots: ProductRoots): string {
  return generatedPath(roots, 'operation-plans.ts');
}

/** 元のパス(保存点の実行計画)。 */
export function usecasePlansPath(roots: ProductRoots): string {
  return generatedPath(roots, 'usecase-plans.ts');
}

/** 元のパス(RLS の期待)。 */
export function rlsExpectationsPath(roots: ProductRoots): string {
  return generatedPath(roots, 'rls-expectations.ts');
}

/** 元のパス(外に出る surface の期待)。 */
export function apiExpectationsPath(roots: ProductRoots): string {
  return generatedPath(roots, 'api-expectations.ts');
}

/** 元のパス(通知の閉世界)。 */
export function notificationsPath(roots: ProductRoots): string {
  return generatedPath(roots, 'notifications.ts');
}

/** 元のパス(画面の配線)。 */
export function screensPath(roots: ProductRoots): string {
  return generatedPath(roots, 'screens.ts');
}
