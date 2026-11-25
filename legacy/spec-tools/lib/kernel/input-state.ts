/**
 * 検査への入力の状態(未選択 / 阻害 / 読込済み)と、検査の結果の区別(未実施 / 阻害 / 実行)。
 *
 * **なぜ要るのか。** 以前の規約は「読めない環境では壊れない」で、検査への入力が任意の欄
 * (`TraceInput.jobs?` など)だと、その欄が無いときに検査が**何も言わずに通った**。仕様の種類を
 * 絞って使う製品には「全部確認済み」に見える一方、**採ったのに読めていない**製品でも同じ見え方になる。
 * ここでは入力を 3 つに分ける。
 *
 *   - **未選択(unselected)** … 製品がその種類を採っていない(`product.md` の `uses` に無い)。
 *     選択は呼び手の明示の入力であり、**ファイルが無いことから推定しない**。
 *   - **阻害(blocked)** … 採ったのに検査へ渡せない(読み込みが無い・置き場が無い・読めない・壊れている)。
 *   - **読込済み(loaded)** … 検査に渡せる。**0 件の空のカタログもここ**(0 件を検査したことは、検査しなかったことと違う)。
 *
 * 検査の結果も 3 つに分ける: 未実施(skipped)/ 阻害(blocked)/ 実行(executed)。
 * **実行は合格を意味しない**(違反は `verifierFindings` に載る)。読み込みの診断(`loaderFindings`)と
 * 検査の診断(`verifierFindings`)は別々に持ち、全体の Finding へ足すときに読み込みの診断を
 * 二重に数えない(読み込みの診断は読み込んだ側がすでに全体へ足している)。
 *
 * 方針:
 *   - カタログが得られても、**モデルから仕様を落としていれば** blocked(欠けたモデルで「無いこと」を主張する検査を回すと
 *     「見た」と誤って報告する)。読み込みの error が残っていることとは別: id の不一致のように、読めた上での違反はモデルを欠かさないので、
 *     読込済みとして検査を回す(その error は読み込んだ側の検査が従来どおり出す)
 *   - 落とした数は必ず数える(`dropped` は `number`。「数えられない読み込み」という口は持たない — 数えない読み込みが
 *     型で書けると、error が残るだけで阻害にする別の基準が裏口として残る)
 *   - warning だけなら実行する
 *   - 検査が投げた例外は成功に変換せず、そのまま伝える
 *
 * **出典**: 外部レビュー の隔離試作 `st-input-state-prototype/input-state.ts`
 * (sha256 9b139b5d6223e68eee89976d6943657d9c9fe282a7609c383e046e40db133311)。型と契約はそのまま採り、
 * 置き場の名前(`lib/kernel/`。診断の系統の一部で、`Finding` と同じ層)と日本語の注釈だけを層の規約に合わせた。
 */

import type { Finding } from '../kernel/finding.js';

/**
 * 既存のローダーの結果の形(`available` / `catalog` / `findings`)。
 * 選択は**呼び手の明示の方針**で決める(この形からは推定しない)。
 */
export interface CatalogLoad<T> {
  readonly model: { readonly available: boolean; readonly catalog: T | null };
  readonly findings: readonly Finding[];
  /** 読めずにモデルへ入れなかった仕様・宣言の数(ローダーが数える)。0 なら、`findings` に error が残っていてもモデルは欠けていない。 */
  readonly dropped: number;
}

/**
 * 「読めたか」(`available`)だけを持つモデル(`QuerySpecModel` のように、カタログの欄を別に持たない種類)を、
 * 読み込みの結果の形へ写す。`available: false` は欠けている(`missing`)扱いで、0 件のカタログとは違う。
 *
 * @param model 読み込んだモデル
 * @param findings その種類の読み込みの診断(省略は空)
 * @param dropped ローダーが数えた、モデルへ入れずに捨てた仕様・宣言の数(省略は 0 = 落としていない)
 */
export function availableLoad<T extends { readonly available: boolean }>(
  model: T,
  findings: readonly Finding[] = [],
  dropped = 0,
): CatalogLoad<T> {
  return { model: { available: model.available, catalog: model.available ? model : null }, findings, dropped };
}

/** 検査が要る入力が渡せなかった理由。 */
export type BlockedReason = 'not-loaded' | 'missing' | 'load-failed' | 'invalid';

/**
 * 選択したのに無い入力は阻害であり、未選択とは推定しない。
 *
 * 阻害のうち**仕様を落とした**もの(`reason: 'invalid'`)だけは、読めた分のモデルを `partial` に持つ。検査は読込済みでなければ回さないのが
 * 原則(欠けたモデルで「無いこと」を主張すると偽の error を生む)だが、**表ごとに自己完結の検査**(欠けた分があっても偽の error を
 * 生まない)は、この部分のモデルで回せる。部分のモデルを使う検査は、使うと宣言したもの(登録の `needsWhole: false`)だけである。
 */
export type CatalogInput<T> =
  | { readonly state: 'unselected'; readonly findings: readonly Finding[] }
  | { readonly state: 'blocked'; readonly reason: BlockedReason; readonly findings: readonly Finding[]; readonly partial?: T }
  | { readonly state: 'loaded'; readonly value: T; readonly findings: readonly Finding[] };

/**
 * 選択と読み込みの結果から入力の状態を決める。読み込みの診断は状態に関わらず保つ。
 *
 * @param selection 製品がその種類を採っているか(`product.md` の `uses` から決めた明示の値)
 * @param load 読み込みの結果(未選択なら省略してよい。選択したのに無いなら `not-loaded`)
 */
export function catalogInput<T>(selection: 'unselected' | 'selected', load?: CatalogLoad<T>): CatalogInput<T> {
  const findings = load?.findings ?? [];
  if (selection === 'unselected') return { state: 'unselected', findings };
  if (load === undefined) return { state: 'blocked', reason: 'not-loaded', findings };
  if (!load.model.available) return { state: 'blocked', reason: 'missing', findings };
  if (load.model.catalog === null) return { state: 'blocked', reason: 'load-failed', findings };
  if (hasDroppedSpecs(load)) return { state: 'blocked', reason: 'invalid', findings, partial: load.model.catalog };
  return { state: 'loaded', value: load.model.catalog, findings };
}

/** 読み込みでモデルから仕様を落としたか。 */
function hasDroppedSpecs<T>(load: CatalogLoad<T>): boolean {
  return load.dropped > 0;
}

/**
 * 入力が読込済みならその値(未選択・阻害なら undefined)。
 *
 * 「あれば読む」側(検査の本体が読む入力)へ渡す形。**undefined は「事実として無い」とも「分からない」とも読めてしまう**ので、
 * 呼び手は入力の状態も見て、未選択(事実として無い)と阻害(分からない)を区別して報告する(`unusableOf`)。
 *
 * @param input 入力の状態
 */
export function inputValue<T>(input: CatalogInput<T>): T | undefined {
  return input.state === 'loaded' ? input.value : undefined;
}

/**
 * 読込済みの値だけを写す(未選択・阻害はそのまま。読み込みの診断も保つ)。
 *
 * 別の種類の入力から、その一部(例: 認証フローの関門の一覧)だけを取り出して渡すときに使う。
 * 写した先でも**未選択は事実として無い・阻害は分からない**の区別が失われない。
 *
 * @param input 入力の状態
 * @param convert 読込済みの値の写し方
 */
export function mapCatalogInput<T, U>(input: CatalogInput<T>, convert: (value: T) => U): CatalogInput<U> {
  if (input.state === 'unselected') return input;
  if (input.state === 'blocked') {
    const { partial, ...rest } = input;
    return partial === undefined ? rest : { ...rest, partial: convert(partial) };
  }
  return { state: 'loaded', value: convert(input.value), findings: input.findings };
}

/**
 * 使えなかった入力 1 件(名前は種類の名前)。未選択 = 製品が採っていない / 阻害 = 採ったのに検査へ渡せない。
 * 関係の層の `gaps`・検査の `gaps`・実行ログの行の書き方(`verify/check-run-report.ts`)が共有する構造の型。
 */
export type UnusableInput =
  | { readonly input: string; readonly state: 'unselected' }
  | { readonly input: string; readonly state: 'blocked'; readonly reason: BlockedReason };

/**
 * 入力の状態から、使えなかった入力の記録を作る(読込済みなら null)。
 *
 * @param input 入力の状態
 * @param name 入力の名前(種類の名前。例: `data_tables`)
 */
export function unusableOf<T>(input: CatalogInput<T>, name: string): UnusableInput | null {
  if (input.state === 'unselected') return { input: name, state: 'unselected' };
  if (input.state === 'blocked') return { input: name, state: 'blocked', reason: input.reason };
  return null;
}

/**
 * 検査が、使えなかった入力のために**見ていないこと**の記録(入力 1 つ分)。
 *
 * 検査が 2 つ以上の種類を入力に取るとき(例: 実行計画はジョブとテーブル仕様を読む)、使えなかった入力ごとに 1 件ずつ持つ。
 * 検査の全体にも、一部の対象の判定(例: 副作用がジョブに依る操作)にも使う**唯一の形**で、見ていないことを文で言う
 * (文末の句点は付けない)。判定を出さなかった対象を名指せるなら `subjects` に挙げる。
 */
export interface InputGapNote {
  /** 使えなかった入力。 */
  readonly gap: UnusableInput;
  /** その入力が使えないために見ていないこと(文末。句点は付けない)。 */
  readonly consequence: string;
  /** 判定を出さなかった対象(検査が数える単位の名前。重複なし。名指せないなら省略)。 */
  readonly subjects?: readonly string[];
}

/** 検査の結果。完了は合格ではない。読み込みの診断と検査の診断は別々に持つ。 */
export type CheckRun = {
  readonly loaderFindings: readonly Finding[];
  readonly verifierFindings: readonly Finding[];
} & (
  | { readonly status: 'skipped'; readonly reason: 'unselected' }
  | { readonly status: 'blocked'; readonly reason: BlockedReason }
  | { readonly status: 'executed' }
);

/**
 * 検査関数を、使える入力にだけ回す(0 件の空のカタログも回す)。
 *
 * @param input 入力の状態
 * @param verify 検査の本体(入力が `loaded` のときだけ呼ぶ。投げた例外は握りつぶさない)
 */
export function runCatalogCheck<T>(input: CatalogInput<T>, verify: (value: T) => readonly Finding[]): CheckRun {
  const loaderFindings = input.findings;
  if (input.state === 'unselected') return { status: 'skipped', reason: 'unselected', loaderFindings, verifierFindings: [] };
  if (input.state === 'blocked') return { status: 'blocked', reason: input.reason, loaderFindings, verifierFindings: [] };
  return { status: 'executed', loaderFindings, verifierFindings: verify(input.value) };
}
