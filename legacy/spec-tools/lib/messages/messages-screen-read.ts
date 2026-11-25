/**
 * S18(`kind: table` / `detail` の部品の読みと欄、`kind: form` の参照欄の選択肢)の**文面**(事実 → 日本語)。
 *
 * 判定そのもの(どの部品の宣言が書き間違いか)は `lib/screen/verifiers/s18-read-component.ts` にある。
 * ここは事実を受けて字面を組むだけで、文言の層に置く(`messages-screen-form.ts` と対)。
 */

/** 部品の種類(文面に出す)。 */
type ReadKind = 'table' | 'detail' | 'form';

/** 読みを載せる部品の書き間違い(事実。文面は持たない)。 */
export type ReadComponentProblem =
  /** chrome の部品に書いた(chrome は読みを持たない)。 */
  | { readonly kind: 'in_chrome'; readonly chrome: string; readonly component: string; readonly part: ReadKind }
  /** 部品の `reads` が、その画面の `reads` に居ない。 */
  | {
      readonly kind: 'not_in_reads';
      readonly screen: string;
      readonly component: string;
      readonly part: ReadKind;
      readonly read: string;
      readonly declared: readonly string[];
    }
  /** 読みの返し方(`returns`)が部品の種類に合わない。 */
  | {
      readonly kind: 'wrong_returns';
      readonly screen: string;
      readonly component: string;
      readonly part: ReadKind;
      readonly read: string;
      readonly returns: 'one' | 'many';
    }
  /** `kind: form` の読みが選択肢の形(projection が `[id, 表示名 1 欄]`)でない。 */
  | {
      readonly kind: 'not_options';
      readonly screen: string;
      readonly component: string;
      readonly read: string;
      readonly projection: readonly string[];
    }
  /** 選択肢の読みの表示名(第 2 列)が、source の集約が宣言した `display_field` と違う。 */
  | {
      readonly kind: 'options_label';
      readonly screen: string;
      readonly component: string;
      readonly read: string;
      readonly source: string;
      readonly label: string;
      readonly displayField: string;
    }
  /** `shows` の欄が、読みの projection にも 1 件に決まる併読にも無い。 */
  | {
      readonly kind: 'unknown_show';
      readonly screen: string;
      readonly component: string;
      readonly read: string;
      readonly show: string;
      readonly candidates: readonly string[];
    }
  /** `shows` の欄が `ref`(他の行を指す id)。 */
  | {
      readonly kind: 'ref_show';
      readonly screen: string;
      readonly component: string;
      readonly read: string;
      readonly show: string;
    }
  /** 選択肢の読みの source を指す ref の欄が、載せる操作の入力に無い。 */
  | {
      readonly kind: 'no_ref';
      readonly screen: string;
      readonly component: string;
      readonly action: string;
      readonly read: string;
      readonly source: string;
    }
  /** 選択肢の読みの source を指す ref の欄が、載せる操作の入力に 2 つ以上ある(どの欄の選択肢か決まらない)。 */
  | {
      readonly kind: 'ambiguous_ref';
      readonly screen: string;
      readonly component: string;
      readonly action: string;
      readonly read: string;
      readonly source: string;
      readonly fields: readonly string[];
    }
  /** 生成の表(`kind: table`)を持つ画面が `states.requires` に `empty` を宣言していない。 */
  | { readonly kind: 'empty_undeclared'; readonly screen: string; readonly tables: readonly string[] };

/** 指摘の文面(message と suggestion)。 */
export interface ReadComponentWords {
  readonly message: string;
  readonly suggestion: string;
}

/** 種類の呼び名。 */
const PART_WORDS: Readonly<Record<ReadKind, string>> = {
  table: 'kind: table',
  detail: 'kind: detail',
  form: 'kind: form',
};

/** 部品の種類が要る返し方。 */
const RETURNS_WORDS = { table: 'many', detail: 'one', form: 'many' } as const;

/**
 * 書き間違い 1 つの文面(事実 → 日本語)。
 *
 * @param problem 書き間違い(事実)
 * @returns 指摘の message と suggestion
 */
export function readComponentProblemWords(problem: ReadComponentProblem): ReadComponentWords {
  switch (problem.kind) {
    case 'in_chrome':
      return {
        message: `chrome ${problem.chrome} の部品 ${problem.component} に ${PART_WORDS[problem.part]} は書けません`,
        suggestion:
          'chrome は読みを持たない外枠である(reads を書けない)。表・詳細は画面の layout の部品に書く',
      };
    case 'not_in_reads':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の reads ${problem.read} が、この画面の reads にありません`,
        suggestion:
          `画面の reads に ${problem.read} を足す(いまある読み: ${listWords(problem.declared)})。` +
          '画面が読むと宣言していない経路を、部品が出してよい道理は無い',
      };
    case 'wrong_returns':
      return {
        message:
          `画面 ${problem.screen} の部品 ${problem.component}(${PART_WORDS[problem.part]})の reads ${problem.read} は ` +
          `returns: ${problem.returns} で、${PART_WORDS[problem.part]} が出せる読みではありません`,
        suggestion:
          `${PART_WORDS[problem.part]} は returns: ${RETURNS_WORDS[problem.part]} の読みを出す。` +
          (problem.part === 'form'
            ? '参照の欄の選択肢は、複数行を返す読み(`[id, 表示名]`)を指す'
            : problem.part === 'table'
              ? '1 件を返す読み(returns: one)を出したいなら kind: detail にする'
              : '複数行を返す読み(returns: many)を出したいなら kind: table にする'),
      };
    case 'not_options':
      return {
        message:
          `画面 ${problem.screen} の部品 ${problem.component} の reads ${problem.read} の projection ` +
          `(${problem.projection.join(', ')})が、選択肢の形ではありません`,
        suggestion:
          'フォームの reads は参照の欄の選択肢の出どころで、projection は [id, 表示名の 1 欄] の 2 欄にする' +
          '(選択肢に要るのは値(id)と表示名だけで、他の欄は選択肢の読みの仕事ではない)',
      };
    case 'options_label':
      return {
        message:
          `画面 ${problem.screen} の部品 ${problem.component} の reads ${problem.read} の表示名の欄 ${problem.label} が、` +
          `${problem.source} の display_field(${problem.displayField})と違います`,
        suggestion:
          `選択肢の表示名は、集約が行の名前として宣言した欄(${problem.source} の display_field: ${problem.displayField})にそろえる。` +
          `読みの projection を [id, ${problem.displayField}] にする。同じ集約の行が、確認の本文と選択肢で別の名前に化けないための規則である`,
      };
    case 'unknown_show':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の shows ${problem.show} が、読み ${problem.read} の欄にありません`,
        suggestion:
          `shows には出せる欄を書く(いまある欄: ${listWords(problem.candidates)})。` +
          '併読の欄は {併読名}.{欄}(併読名は併読先のエンティティ名)で書く。1 行に複数が付く併読(枠 → 参加者など)は出せない',
      };
    case 'ref_show':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の shows ${problem.show} は ref の欄で、表・詳細に出せません`,
        suggestion:
          'ref の欄は他の行を指す id だけで、人が読める値ではない。併読の欄(例: venue.name)で書くか、shows から外す' +
          '(読みの includes に併読先を足せば、{併読名}.{欄} で出せる)',
      };
    case 'no_ref':
      return {
        message:
          `画面 ${problem.screen} の部品 ${problem.component} の reads ${problem.read}(source: ${problem.source})が、` +
          `載せる操作 ${problem.action} の入力のどの ref の欄の選択肢にもなりません`,
        suggestion:
          `選択肢の読みは、操作の入力に居る ref(${problem.source}) の欄の選択肢の出どころである。` +
          'その欄が操作の入力に無いなら reads を外す。読みを取り違えているなら、選択肢の読み(source が参照先のもの)を指す',
      };
    case 'ambiguous_ref':
      return {
        message:
          `画面 ${problem.screen} の部品 ${problem.component} の reads ${problem.read}(source: ${problem.source})が、` +
          `載せる操作 ${problem.action} の入力の ref の欄 ${problem.fields.join(' / ')} のどれの選択肢か決まりません`,
        suggestion:
          '1 つの選択肢の読みが効くのは、同じ参照先を指す欄が 1 つのときだけである(2 欄に同じ選択肢を黙って配ると、' +
          '片方の欄の意味を読みが決めてしまう)。欄ごとに別の読みが要るなら、その形(欄 → 読み)の拡張を起票する',
      };
    case 'empty_undeclared':
      return {
        message: `画面 ${problem.screen} は kind: table の部品(${problem.tables.join(' / ')})を持つのに、states.requires に empty がありません`,
        suggestion:
          '生成の表は行が 0 件のときの表示(空の葉)を必ず出す。画面の表示義務として states.requires に empty を宣言する' +
          '(宣言が無いと、空の状態の断片が作られず、空の表示を誰も確かめない)',
      };
  }
}

/** 候補の並び(空なら「なし」)。 */
function listWords(items: readonly string[]): string {
  return items.length === 0 ? 'なし' : items.join(' / ');
}
