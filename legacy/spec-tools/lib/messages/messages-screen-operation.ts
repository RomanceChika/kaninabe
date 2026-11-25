/**
 * S19(操作を載せる部品 — `kind: table` の `edit` / `actions`・`kind: actions`・確認の器)の書き間違いの**文面**(事実 → 日本語)。
 *
 * 判定そのもの(どの部品の宣言が書き間違いか)は `lib/screen/verifiers/s19-operation-component.ts` にある。
 * ここは事実を受けて字面を組むだけで、文言の層に置く。
 */

/** 操作を載せる部品の書き間違い(事実。文面は持たない)。 */
export type OperationComponentProblem =
  /** chrome の部品に `kind: actions` を書いた(chrome は操作を持たない外枠)。 */
  | { readonly kind: 'in_chrome'; readonly chrome: string; readonly component: string }
  /** `edit` / `actions` の操作が、その画面の `actions`(重ね表示を含む)に居ない。 */
  | {
      readonly kind: 'not_declared';
      readonly screen: string;
      readonly component: string;
      readonly attribute: 'edit' | 'actions';
      readonly operation: string;
      readonly declared: readonly string[];
    }
  /** `edit` の操作が編集(update)でない。 */
  | { readonly kind: 'edit_not_update'; readonly screen: string; readonly component: string; readonly operation: string }
  /** `edit` の操作の対象が、`reads` の source のエンティティでない。 */
  | {
      readonly kind: 'edit_wrong_source';
      readonly screen: string;
      readonly component: string;
      readonly operation: string;
      readonly entity: string;
      readonly source: string;
    }
  /** `edit` の操作が確認を要る(行の保存に確認の器は無い)。 */
  | { readonly kind: 'edit_confirm'; readonly screen: string; readonly component: string; readonly operation: string }
  /** `edit` の操作が `runner: manual`(実行計画の外)で、行の入力欄の集合を仕様から導けない。 */
  | { readonly kind: 'edit_manual'; readonly screen: string; readonly component: string; readonly operation: string }
  /** `actions` の要素が作成か編集(作成はフォーム・編集は `edit`)。 */
  | {
      readonly kind: 'button_wrong_shape';
      readonly screen: string;
      readonly component: string;
      readonly operation: string;
      readonly shape: 'create' | 'update';
    }
  /** `actions` の要素が、`reads` の source の状態機械のイベントでも、source の削除でもない。 */
  | {
      readonly kind: 'button_wrong_source';
      readonly screen: string;
      readonly component: string;
      readonly operation: string;
      readonly source: string;
    }
  /** `actions` の要素が、対象の識別子(`id`)のほかの入力を要る(行のボタンは `{ id }` だけで呼ぶ)。 */
  | {
      readonly kind: 'button_extra_input';
      readonly screen: string;
      readonly component: string;
      readonly operation: string;
      readonly fields: readonly string[];
    }
  /** `kind: actions` の `reads` が、その画面の `reads` の要素でない。 */
  | {
      readonly kind: 'read_not_in_reads';
      readonly screen: string;
      readonly component: string;
      readonly read: string;
      readonly declared: readonly string[];
    }
  /** `kind: actions` の `reads` が 1 行を返す読み(`returns: one`)でない。 */
  | {
      readonly kind: 'read_not_one';
      readonly screen: string;
      readonly component: string;
      readonly read: string;
      readonly returns: string;
    }
  /** 確認を要る操作を載せた部品を `opened_by` に持つ重ね表示が無い(その操作を `actions` に含むもの)。 */
  | { readonly kind: 'confirm_without_overlay'; readonly screen: string; readonly component: string; readonly operation: string }
  /** 1 つの確認の重ね表示が、同じ部品が載せる確認が要る操作を 2 つ以上持つ(確認ダイアログの testid が重複する)。 */
  | {
      readonly kind: 'overlay_shared';
      readonly screen: string;
      readonly component: string;
      readonly overlay: string;
      readonly operations: readonly string[];
    }
  /** 確認の重ね表示が、確認の器(`body.center` の `confirm_bar`)を持たない。 */
  | {
      readonly kind: 'overlay_not_confirm_bar';
      readonly screen: string;
      readonly component: string;
      readonly operation: string;
      readonly overlay: string;
    };

/** 指摘の文面(message と suggestion)。 */
export interface OperationComponentWords {
  readonly message: string;
  readonly suggestion: string;
}

/**
 * 書き間違い 1 つの文面(事実 → 日本語)。
 *
 * @param problem 書き間違い(事実)
 * @returns 指摘の message と suggestion
 */
export function operationComponentProblemWords(problem: OperationComponentProblem): OperationComponentWords {
  switch (problem.kind) {
    case 'in_chrome':
      return {
        message: `chrome ${problem.chrome} の部品 ${problem.component} に kind: actions は書けません`,
        suggestion: 'chrome は操作を持たない外枠である。ボタンは画面の layout の部品に書く',
      };
    case 'not_declared':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の ${problem.attribute} の ${problem.operation} が、この画面の actions にありません`,
        suggestion:
          `画面の actions(または overlays[].actions)に ${problem.operation} を足す(いまある操作: ${listWords(problem.declared)})。` +
          '画面が起こすと宣言していない操作を、部品が載せてよい道理は無い',
      };
    case 'edit_not_update':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の edit ${problem.operation} は編集(update)ではありません`,
        suggestion:
          'edit は行をその場で編集する操作で、{エンティティ}.update の予約 ID だけを指す。遷移や削除は actions のボタンにする',
      };
    case 'edit_wrong_source':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の edit ${problem.operation} は ${problem.entity} の編集ですが、reads の source は ${problem.source} です`,
        suggestion: `edit は reads の source(${problem.source})の編集にする。別のエンティティの行を編集する表なら、その読みを reads にする`,
      };
    case 'edit_confirm':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の edit ${problem.operation} は確認が要る操作ですが、行の保存に確認の器はありません`,
        suggestion:
          '行をその場で保存する形に確認の重ね表示は付けられない。編集を確認つきにしたいなら、kind: form の部品(確認の器を持てる)にする',
      };
    case 'edit_manual':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の edit ${problem.operation} は runner: manual の操作で、編集する表を生成できません`,
        suggestion:
          'manual の操作は実行計画の外にある(定型では書けない)ので、行の入力欄の集合を仕様から導けない。' +
          'この部品は kind を書かない手書きの部品にする。計画で走るように仕様を直せる(runner を外せる)なら、' +
          'A15 が runner: manual の宣言を error にするので、そちらを先に直す',
      };
    case 'button_wrong_shape':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の actions の ${problem.operation} は${problem.shape === 'create' ? '作成' : '編集'}で、行のボタンにできません`,
        suggestion:
          '行のボタンにできるのは状態機械の遷移と削除(delete)だけである。作成は kind: form・編集は表の edit で書く',
      };
    case 'button_wrong_source':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の actions の ${problem.operation} は、reads の source(${problem.source})の遷移でも削除でもありません`,
        suggestion:
          `行のボタンは、その行の ${problem.source} の状態機械のイベントか、${problem.source} の削除に限る。別のエンティティの操作は、その行を出す表のボタンにする`,
      };
    case 'button_extra_input':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の actions の ${problem.operation} は ${listWords(problem.fields)} の入力を要り、行のボタンにできません`,
        suggestion:
          '行のボタンが渡すのは対象の識別子(id)だけである。理由の欄などの入力を集める操作は kind: form の部品にする' +
          '(入力が要らない形に操作を直せるなら、action_spec の input を id だけにする)',
      };
    case 'read_not_in_reads':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の reads ${problem.read} が、この画面の reads にありません`,
        suggestion: `画面の reads に ${problem.read} を足す(いまある読み: ${listWords(problem.declared)})。画面が読むと宣言した経路だけを部品が出せる`,
      };
    case 'read_not_one':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の reads ${problem.read} は returns: ${problem.returns} で、kind: actions には使えません`,
        suggestion: 'kind: actions は 1 行に対するボタン列なので、reads は returns: one の読み(詳細の読みと同じもの)を指す',
      };
    case 'confirm_without_overlay':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} が載せる ${problem.operation} は確認が要る操作ですが、確認の重ね表示がありません`,
        suggestion:
          `overlays に、opened_by: ${problem.component} と actions: [${problem.operation}] を持つ重ね表示を足す` +
          '(layout は body.center に confirm_bar を置く。確認の見出しを変えたいときは overlay の label)。' +
          '確認が要らない業務なら、action_spec の ux: { confirm: none, reason } で上書きする(理由が要る)',
      };
    case 'overlay_shared':
      return {
        message: `画面 ${problem.screen} の重ね表示 ${problem.overlay} が、${problem.component} の確認が要る操作 ${listWords(problem.operations)} を 1 つにまとめています`,
        suggestion:
          '確認の重ね表示は操作 1 つにつき 1 つ(確認ダイアログの testid は重ね表示で決まるので、まとめると重複する)。' +
          '操作ごとに overlay を分け、それぞれ opened_by と actions を書く',
      };
    case 'overlay_not_confirm_bar':
      return {
        message: `画面 ${problem.screen} の重ね表示 ${problem.overlay}(${problem.component} の ${problem.operation} の確認)に、確認の器 body.center の confirm_bar がありません`,
        suggestion:
          '確認の重ね表示は layout の body.center に confirm_bar を置く(実行 / やめるの葉は生成物がその下に出す)。他の部品は並べてよいが、confirm_bar は要る',
      };
  }
}

/** 候補の並び(空なら「なし」)。 */
function listWords(items: readonly string[]): string {
  return items.length === 0 ? 'なし' : items.join(' / ');
}
