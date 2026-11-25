import type { FormValues } from './form';

/**
 * 編集中の行(フォーム)が **`router.refresh()` で最新の値を受け取ったとき**の入力欄の扱い。
 *
 * 正の出どころは `form-changes.ts` の契約(`changedFields`: **編集を始めたときの値と違う欄だけ**を送る)である。
 * 生成の編集フォーム・行エディタは、`useState` で 1 回だけ初期化した `values` と、**毎レンダー最新の props から
 * 作り直した「初期値」**を比べていた。`key={row.id}` の行は refresh で remount しないので、他の人の更新が届くと
 * 触っていない欄が「変更あり」になり、**古い値を再送して他の人の変更を上書き**し、監査ログの `payload` にも
 * 混ざっていた。ここは、その「初期値」を**欄ごとに覚えている値(`baseline`)**に置き換えるための純粋な判定である
 * (React に依存しない — jsdom を採らない方針なので、この形に切り出して `vitest` だけで確かめる)。
 *
 * ## 約束
 *
 * - **触っていない欄は最新に追従する**(`values` が `baseline` と同じ欄は、最新の値へ `baseline` ごと進む)。
 * - **触った欄は手元の値を守る**(最新が変わっていても、`values` も `baseline` も動かさない)。
 * - **両方が変わった欄は「競合」として返す**(黙って片方を選ばない。解決は {@link resolveConflict} が起こす)。
 * - **入力は変更しない**(新しいオブジェクトを返す)。
 *
 * ## 導出であって、状態ではない(`useEffect` を使わない理由)
 *
 * 呼び出し側は {@link reconcileFormDraft} を**毎レンダー**呼び、その結果を描く(`state` には最新の props を
 * 覚えさせない)。導出は `state` を更新しないので、再描画のループも、旧い値を 1 フレーム見せることも起きない。
 * 代わりに次の性質がある — **最新の値が続けて変わると、途中を 1 つずつ反映した場合と結果が違うことがある**
 * (例: 触った欄の最新が手元の値と**たまたま一致**したあとで別の値に変わると、導出は「競合」と読むが、
 * 一致した時点で `baseline` を進めていれば「追従」になる)。**違うときは安全側(競合として人に見せる)**に寄る
 * ので、この方式を採る。最新の値を `state` に覚えて 1 回ごとに進める方式は、複雑さが増えるわりに得るものが無い。
 *
 * ## 保存の直後に旧い値を見せない(`held`)
 *
 * 保存に成功してから最新が届くまでの 1 回の再描画は、まだ**保存前の props**のままである。そこで導出すると、触っていない扱いの
 * 欄(`values` = `baseline` = 送った値)が旧い最新へ追従して、**入力欄が一瞬旧い値に戻る**(保存に失敗したように見える)。
 * そのため {@link acceptSaved} は、送った欄について「**保存した時点でまだ旧かった最新の値**」を `held` に覚える。判定は
 * `held` と同じ値の最新が届いている間だけ**手元も `baseline` も動かさず、競合にもしない**(`keep`)。最新が変わって
 * `held` と違えば通常の判定に戻る。`held` は欄ごとに、その欄を編集({@link editField})・解決({@link resolveConflict})・
 * 次にその欄を送る保存({@link acceptSaved})をしたときに消費される(**送らなかった欄の `held` は次の保存でも持ち越す**)。
 *
 * **許容する穴**: 最新が届いたあとで、他の人が**元の値(`held` と同じ値)へ戻した**場合、その間にこちらがその欄を触っていなければ
 * 追従し損ねる(次の操作で解消する。上書きは起きない — `baseline` も送信値なので `changedFields` に出ない)。描画中に
 * 「最新が変わったら `held` を捨てる」guarded な `setState` を入れれば塞げるが、設計が避けた複雑さなので採らない。
 * 同じ型で、**`held` の寿命は「その欄を次に送るまで」である**: refresh が届いて通常の判定に戻ったあとも、その欄を送る(または編集・解決する)
 * まで `held` は残るので、そのあいだに他の人が欄を**旧値(`held` と同じ値)へ戻しても追従しない**(次の編集で解消する。
 * `incoming !== held` で `held` を落とす案は冪等性の全列挙に響くので採らない)。
 *
 * ここに置くのは**入力欄の文字列の扱い**だけで、業務ルール(何が妥当か)は 1 つも書かない。
 * **DB の同時更新の制御ではない** — 競合を見つけるのは画面が最新を受け取ったときだけで、サーバーは列ごとの
 * 期待値の比較を持たない。
 */

/**
 * 編集中のフォームの入力。`baseline` は**各欄が「いま画面に載っている最新」として最後に受け入れた値**、
 * `values` は入力欄の現在値(どちらも欄の名前 → 入力欄の文字列)。
 */
export interface FormDraft<K extends string> {
  /** 各欄で最後に受け入れた「保存済みの値」(送る欄の判定は、これと `values` の差で行う)。 */
  readonly baseline: FormValues<K>;
  /** 入力欄の現在値。 */
  readonly values: FormValues<K>;
  /**
   * 保存した時点で、まだ旧かった最新の値(欄ごと。{@link acceptSaved} が書く)。同じ値の最新が届いている間は、その欄を動かさない。
   * 無い欄・空のときは持たない(`held` の鍵ごと無い)。
   */
  readonly held?: Readonly<Partial<Record<K, string>>>;
}

/** 最新の値(欄の名前 → 入力欄の文字列)。**無い欄は判定の外**(`undefined` を混ぜない)。 */
export type FormIncoming<K extends string> = Readonly<Partial<Record<K, string>>>;

/** 競合の解き方。`theirs` = 最新の値を取る / `mine` = 手元の値を残して上書きする。 */
export type ConflictChoice = 'theirs' | 'mine';

/** {@link reconcileFormDraft} の結果。 */
export interface FormReconciliation<K extends string> {
  /** 最新を取り込んだあとの入力。 */
  readonly draft: FormDraft<K>;
  /** 競合している欄(`fields` の順)。 */
  readonly conflicts: readonly K[];
}

/**
 * 入力の組を作る。`held` が空・無いときは `held` の鍵を持たせない(同じ状態を 1 つの形で表す)。
 *
 * @param baseline - 各欄で最後に受け入れた値
 * @param values - 入力欄の現在値
 * @param held - 保存した時点でまだ旧かった最新の値(空なら持たない)
 * @returns 入力
 */
function draftOf<K extends string>(
  baseline: FormValues<K>,
  values: FormValues<K>,
  held: Readonly<Partial<Record<K, string>>> | undefined,
): FormDraft<K> {
  const empty = held === undefined || Object.keys(held).length === 0;
  return empty ? { baseline, values } : { baseline, values, held };
}

/**
 * `held` から欄を 1 つ外す(外して空になれば `undefined`)。
 *
 * @param held - 外す前の `held`
 * @param field - 外す欄
 * @returns 外したあとの `held`
 */
function withoutHeld<K extends string>(
  held: Readonly<Partial<Record<K, string>>> | undefined,
  field: K,
): Readonly<Partial<Record<K, string>>> | undefined {
  if (held === undefined) return undefined;
  const rest: Partial<Record<K, string>> = { ...held };
  delete rest[field];
  return rest;
}

/** 欄 1 つの判定。`follow` は最新へ追従(値を持つ)・`conflict` は競合・`keep` は手元だけが変わった・`skip` は判定できない。 */
type Stance =
  | { readonly kind: 'follow'; readonly remote: string }
  | { readonly kind: 'conflict' | 'keep' | 'skip' };

/**
 * 欄 1 つについて、最後に受け入れた値・手元の値・最新の値から扱いを決める。
 *
 * **3 つのどれかが無い欄は判定の外(`skip`)**にする。無い値を空文字や `undefined` で埋めて比べると、
 * 触っていない欄が変更や競合として現れる(旧い判定が犯した誤りと同じ形)。
 *
 * **先頭の 1 分岐**: 最新が `held`(保存した時点でまだ旧かった値)のままなら、まだ自分の保存が届いていない旧い最新なので、
 * 手元も `baseline` も動かさず競合にもしない(`keep`)。
 *
 * @param previous - 最後に受け入れた値
 * @param local - 手元の値
 * @param remote - 最新の値
 * @param held - 保存した時点でまだ旧かった最新の値(無ければ `undefined`)
 * @returns 欄の扱い
 */
function stanceOf(
  previous: string | undefined,
  local: string | undefined,
  remote: string | undefined,
  held: string | undefined,
): Stance {
  if (held !== undefined && held === remote) return { kind: 'keep' };
  if (previous === undefined || local === undefined || remote === undefined) return { kind: 'skip' };
  if (local === previous || local === remote) return { kind: 'follow', remote };
  return { kind: remote === previous ? 'keep' : 'conflict' };
}

/**
 * 最新の値を取り込み、競合している欄を返す。
 *
 * 欄ごとに次のとおり(`previous` = `current.baseline`・`local` = `current.values`・`remote` = `incoming`):
 *
 * - `remote === held`(保存した時点でまだ旧かった最新が、そのまま届いている) → そのまま残す(競合にもしない)。
 * - `local === previous` または `local === remote` → `remote` に同期する(`baseline` と `values` の両方。触っていない欄と、
 *   同じ値に着地した欄)。
 * - `remote !== previous`(手元も最新も変わった) → 競合。`values` も `baseline` も**そのまま**残す。
 * - それ以外(手元だけが変わった) → そのまま残す。
 * - `incoming` に無い欄・`current` に無い欄 → 飛ばす。
 *
 * 同じ引数なら同じ結果で、**結果をもう一度この関数に渡しても変わらない**(冪等)。
 *
 * @param current - いまの入力(`baseline` と `values`)
 * @param incoming - 最新の値(`startValues(最新の行)` の形)
 * @param fields - 判定する欄(編集できる欄。ここに無い欄は触らない)
 * @returns 取り込んだあとの入力と、競合している欄
 */
export function reconcileFormDraft<K extends string>(
  current: FormDraft<K>,
  incoming: FormIncoming<K>,
  fields: readonly K[],
): FormReconciliation<K> {
  const baseline: Record<K, string> = { ...current.baseline };
  const values: Record<K, string> = { ...current.values };
  const conflicts: K[] = [];
  for (const field of fields) {
    const stance = stanceOf(current.baseline[field], current.values[field], incoming[field], current.held?.[field]);
    if (stance.kind === 'follow') {
      baseline[field] = stance.remote;
      values[field] = stance.remote;
    } else if (stance.kind === 'conflict') {
      conflicts.push(field);
    }
  }
  return { draft: draftOf(baseline, values, current.held), conflicts };
}

/**
 * 競合している欄だけを返す(表示のための導出。{@link reconcileFormDraft} の `conflicts` と同じ計算)。
 *
 * @param current - いまの入力
 * @param incoming - 最新の値
 * @param fields - 判定する欄
 * @returns 競合している欄(`fields` の順)
 */
export function conflictsOf<K extends string>(
  current: FormDraft<K>,
  incoming: FormIncoming<K>,
  fields: readonly K[],
): readonly K[] {
  return fields.filter(
    (field) => stanceOf(current.baseline[field], current.values[field], incoming[field], current.held?.[field]).kind === 'conflict',
  );
}

/**
 * 保存に成功した直後の入力。**送った欄の `baseline` を、送った値へ進める**(`values` は動かさない)。
 *
 * 自分の保存の結果が refresh で届いたとき、それを「他の人の変更」と読ませないために要る。実行器は成功のあとに
 * `onSuccess` → `refresh()` の順で呼ぶ(`runner-core.ts`)ので、`refresh` が最新を運んでくるより前にここで
 * `baseline` を送った値に進められる。保存中に打ち足した入力(`values` は送った値と違う)は、そのまま残る。
 *
 * `staleIncoming` を渡すと、送った欄について**保存した時点の最新(まだ旧い値)を `held` に覚える**。refresh が届くまでの
 * 再描画は旧い props のままなので、`held` が無いと旧い最新へ追従して入力欄が一瞬旧い値に戻る(冒頭の「`held`」)。
 * 送った値と同じ旧値は覚えない(追従しても同じ値で、覚えると穴だけが増える)。`staleIncoming` が無い呼び方は `held` を作らない
 * (従来どおり)。**今回送った欄の `held` は作り直す**(消費)が、**送らなかった欄の `held` は持ち越す**(refresh が届く前に
 * 別の欄を続けて保存しても、前の保存の欄が一瞬旧い値に戻らない)。
 *
 * @param current - いまの入力
 * @param sent - 送った欄の値(入力欄の文字列に直したもの。送っていない欄は含めない)
 * @param staleIncoming - 保存した時点の最新の値(保存前の props から作った `FormIncoming`。省略可)
 * @returns `baseline` を進め `held` を覚えた入力(`current` に無い欄は無視する)
 */
export function acceptSaved<K extends string>(
  current: FormDraft<K>,
  sent: FormIncoming<K>,
  staleIncoming?: FormIncoming<K>,
): FormDraft<K> {
  const baseline: Record<K, string> = { ...current.baseline };
  const held: Partial<Record<K, string>> = { ...current.held };
  for (const field of Object.keys(current.baseline) as K[]) {
    const value = sent[field];
    if (value === undefined) continue;
    baseline[field] = value;
    delete held[field];
    const stale = staleIncoming?.[field];
    if (stale !== undefined && stale !== value) held[field] = stale;
  }
  return draftOf(baseline, current.values, held);
}

/**
 * 入力欄を 1 つ編集する(`values` の 1 欄だけを書き換える。`baseline` は動かさない)。その欄の `held` は消費される。
 *
 * 呼び出し側は、最新を取り込んだ入力(`reconcileFormDraft` が返した入力)を `current` に渡す。**他の欄の `held` は残す** —— 保存の
 * 直後に別の欄を打っても、保存した欄が旧い値に戻らない。
 *
 * @param current - いまの入力(最新を取り込んだあと)
 * @param field - 編集した欄
 * @param next - 入力欄の新しい文字列
 * @returns 編集したあとの入力
 */
export function editField<K extends string>(current: FormDraft<K>, field: NoInfer<K>, next: string): FormDraft<K> {
  const values: Record<K, string> = { ...current.values };
  values[field] = next;
  return draftOf(current.baseline, values, withoutHeld(current.held, field));
}

/**
 * 競合を 1 つ解く。
 *
 * - `theirs`(最新を取る): `baseline` も `values` も最新の値にする(手元の編集を捨てる)。
 * - `mine`(自分の値で上書きする): `baseline` だけを最新の値にする(手元の値は残り、次の保存で送られる)。
 *
 * どちらも `baseline` が最新に追いつくので、その欄は競合でなくなる。競合でない欄に使っても害は無いが、
 * 呼ぶのは {@link conflictsOf} が返した欄だけにする。`incoming` に無い欄は何もしない。その欄の `held` は消費される。
 *
 * @param current - いまの入力
 * @param incoming - 最新の値
 * @param field - 解く欄
 * @param choice - 解き方
 * @returns 解いたあとの入力
 */
export function resolveConflict<K extends string>(
  current: FormDraft<K>,
  incoming: FormIncoming<K>,
  field: NoInfer<K>,
  choice: ConflictChoice,
): FormDraft<K> {
  const remote = incoming[field];
  if (remote === undefined) return current;
  const baseline: Record<K, string> = { ...current.baseline };
  baseline[field] = remote;
  const values: Record<K, string> = { ...current.values };
  if (choice === 'theirs') values[field] = remote;
  return draftOf(baseline, values, withoutHeld(current.held, field));
}
