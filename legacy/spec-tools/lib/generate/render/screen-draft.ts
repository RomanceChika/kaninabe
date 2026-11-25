/**
 * 編集のフォーム・行エディタの**2 層の入力**(`baseline` / `values`)の字面。screen-form-body.ts と screen-table-edit-row.ts が
 * 共有する(`screen-form-fields.ts` は欄まわりの字面、ここは `router.refresh()` で届く最新との突き合わせの字面)。
 *
 * 入力の扱いの正は `@kaninabe/runtime/form-refresh`(純関数。理由は冒頭の doc)で、ここはそれを呼ぶ字面だけを持つ。
 * アプリの語彙は 1 語も持たない(W1)。
 */

import { docComment } from '../../gen-kit/code-emit.js';
import { RUNTIME_FORM_REFRESH_MODULE } from './runtime-modules.js';

/**
 * 編集のフォーム・編集する表の**競合の葉の名前**(`{部品}.{欄}.{葉}`)。refresh で届いた最新が、編集中の欄を他の人が
 * 先に変えていたとき(実行時に起きる)に、その欄の近くに出る知らせと 2 択(最新を取る / 自分の値で上書き)。
 */
export const CONFLICT_LEAF = 'conflict';

/** 競合の解き方 1(最新を取る)のボタンの葉の名前。 */
export const TAKE_THEIRS_LEAF = 'take_theirs';

/** 競合の解き方 2(自分の値で上書き)のボタンの葉の名前。 */
export const KEEP_MINE_LEAF = 'keep_mine';

/** 競合の葉の全数(欄ごとに `{欄}.{葉}`。葉の表の `conflictLeaves`)。 */
export const CONFLICT_LEAVES: readonly string[] = [CONFLICT_LEAF, TAKE_THEIRS_LEAF, KEEP_MINE_LEAF];

/**
 * 編集のフォーム・行エディタが読み込む行(refresh 後の入力の扱いと、競合の表示の部品)。
 *
 * @returns import 文の行
 */
export function draftImportLines(): readonly string[] {
  return [
    `import { acceptSaved, editField, reconcileFormDraft, resolveConflict } from '${RUNTIME_FORM_REFRESH_MODULE}';`,
    `import type { ConflictChoice, FormDraft } from '${RUNTIME_FORM_REFRESH_MODULE}';`,
    "import { FormConflict } from './form-conflict';",
  ];
}

/**
 * 成功のあとに、送った値を保存済みの値として覚える文(`onSuccess` の中身。編集のフォームと行エディタが共有する)。
 *
 * 第 3 引数 `start` は**保存した時点の最新**(この描画の props から作った値)で、`acceptSaved` が `held` に覚える —
 * refresh が届くまでの再描画は旧い props のままなので、覚えないと入力欄が一瞬旧い値に戻る(`form-refresh.ts` の冒頭)。
 * 実行器は成功のあとに `onSuccess` → `refresh()` の順で呼ぶ(runner-core.ts)ので、最新が届くより前に呼べる。
 */
export const ACCEPT_SAVED_STATEMENT = 'setDraft((current) => acceptSaved(current, sentValues(sent), start))';

/**
 * 編集できる欄の一覧・送った入力の写し(モジュールの先頭の宣言)。編集のフォームと行エディタが共有する。
 * 競合の文言と見た目は共有の部品(`form-conflict.tsx`。screen-form-conflict.ts)が持つ。
 * `TEXT_FIELDS` / `FLAG_FIELDS` / `startValues` / `Input` の宣言のあとに置く。
 *
 * @returns ソースの行
 */
export function renderDraftSupport(): readonly string[] {
  return [
    docComment(['編集できる欄(文字列・数値・選択の欄 → チェックボックスの欄の順)。refresh で届いた最新との突き合わせの対象。']),
    'const EDIT_FIELDS: readonly string[] = [...TEXT_FIELDS, ...FLAG_FIELDS];',
    '',
    docComment([
      '送った入力を、入力欄の文字列に直す(送った欄だけ。送っていない欄は含めない)。',
      '成功のあとに「送った値を保存済みの値として覚える」ために使う — 実行器は成功のあとに `onSuccess` → `refresh()` の順で',
      '呼ぶので、自分の保存の結果が最新として届くより前に覚えられる(覚えないと、自分の保存が「他の人の変更」に見える)。',
    ]),
    'function sentValues(sent: Readonly<Partial<Input>>): Record<string, string> {',
    '  const strings = startValues(sent);',
    '  const sentFields = Object.entries(sent)',
    '    .filter(([, value]) => value !== undefined)',
    '    .map(([field]) => field);',
    "  return Object.fromEntries(EDIT_FIELDS.filter((field) => sentFields.includes(field)).map((field) => [field, strings[field] ?? '']));",
    '}',
    '',
  ];
}

/**
 * コンポーネントの中の 2 層の入力(`draft` の state・最新を取り込んだ `view` の導出・変更した欄・欄の編集と競合の解決・
 * 競合の表示)。編集のフォームと行エディタが共有する。`shown` の宣言のあとに置く。
 *
 * **`useEffect` は使わない**: 最新の props(`start`)を state に覚えず、毎レンダー `reconcileFormDraft` で導出する。
 * 導出は state を更新しないので、再描画のループも、旧い値を 1 フレーム見せることも起きない(`form-refresh.ts` の冒頭が理由)。
 *
 * @param startArg - `startValues` に渡す、最新の props から作る初期値の引数(フォームは `initial`・行は `initialOf(item)`)
 * @returns ソースの行(`values` / `changed` / `view` / `edit` / `resolveField` / `conflictView` が使えるようになる)
 */
export function renderDraftLines(startArg: string): readonly string[] {
  return [
    `  const start = startValues(${startArg});`,
    '  const [draft, setDraft] = useState<FormDraft<string>>(() => ({ baseline: start, values: start }));',
    '  const view = reconcileFormDraft(draft, start, EDIT_FIELDS);',
    '  const values = view.draft.values;',
    // 送るのは**baseline と違う欄だけ**(最新の props との差ではない)。変更が無いあいだは送れない。
    '  const changed = changedFields(view.draft.baseline, values, EDIT_FIELDS.filter(shown));',
  ];
}

/**
 * 欄の編集・競合の解決・競合の表示の関数(送信中は 2 択も押せない — 呼び側の送信中の判定を引数 `pending` で受ける)。
 *
 * @returns ソースの行
 */
export function renderDraftHandlers(): readonly string[] {
  return [
    // 最新を取り込んだ入力(`view`)を土台に積む。その欄の `held` はここで消費される(保存した欄以外の `held` は残る)。
    '  /** 入力欄の編集。最新を取り込んだ入力(`view`)を土台に積む。 */',
    '  function edit(field: string, next: string): void {',
    '    setDraft(editField(view.draft, field, next));',
    '  }',
    '',
    '  /** 競合を 1 つ解く(最新を取る / 自分の値で上書き)。 */',
    '  function resolveField(field: string, choice: ConflictChoice): void {',
    '    setDraft(resolveConflict(view.draft, start, field, choice));',
    '  }',
    '',
    '  /** 競合している欄の知らせと、解き方の 2 択(競合していなければ何も出さない。見た目は共有の部品)。 */',
    '  function conflictView(field: string, pending: boolean): ReactNode {',
    '    if (!view.conflicts.includes(field)) return null;',
    '    return (',
    '      <FormConflict testId={`${TESTID}.${field}`} pending={pending} onResolve={(choice) => resolveField(field, choice)} />',
    '    );',
    '  }',
  ];
}
