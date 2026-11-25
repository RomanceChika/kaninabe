/**
 * レイアウト(部品・スロット)と、他の仕様への参照 1 件の型。
 *
 * 型の本体(`types.ts`)から分けてあるのは、部品の属性が「生成物の形が増えるたびに」伸びる変更点であり、
 * 画面仕様の型の他の部分と変更の理由が違うからである(`types.ts` はここから再輸出する)。
 */

import type { SourceLocation } from '../types.js';
import type { ComponentKind } from './types-component.js';

/**
 * 他の仕様への参照 1 件(`reads` の query_spec id / `actions` のドメインイベント ID)。
 *
 * 参照は「他の仕様の名前を 1 つ書く」だけなので、節ごとに型を分けても持つ情報は同じになる。
 * 位置を要素まで持つのは、実在検査(S2)が「どの行を直すか」まで示せるようにするため。
 */
export interface ScreenRef {
  readonly id: string;
  readonly location: SourceLocation;
}


/**
 * 排他表示グループへの所属(`variants:` で宣言した部品)。
 *
 * 同じスロットに並んでいても「同時には出ない」部品があり、それを平坦な並びで書くと
 * ワイヤーフレームも testid も「両方が同時に居る」と誤読する。所属を部品側に持たせるのは、
 * **testid のパスに排他の状態名を含めない**ためである(DOM 上はどちらか一方しか存在せず、
 * パスに状態名が入るとテストが「どちらが出ているか」を先に知らないと部品を引けなくなる)。
 */
export interface VariantMembership {
  /**
   * 同じスロット内の何番目の `variants:` ブロックか(0 始まり)。
   * 同じ番号を持つ部品どうしが排他であり、番号が違えば互いに独立である。
   */
  readonly group: number;
  /** 排他の状態名(自由語彙の snake_case)。どの状態でその部品が出るかは仕様では縛らない。 */
  readonly key: string;
  readonly location: SourceLocation;
}

/** レイアウトのスロットに載るコンポーネント 1 つ。 */
export interface LayoutComponent {
  /** コンポーネント名(snake_case)。testid のスロットパスの末尾になる。 */
  readonly name: string;
  /**
   * UI の表示名(画面の見出し・部品名。任意)。`- page_title: { label: 催し一覧 }` の形で書く。
   * state_spec の `events[].label` と同じ流儀 — 実装は内部名(testid の骨格)で配線し、表示文字列は
   * 生成物経由でこの label を引く。無ければ従来どおり文言は実装の自由。
   */
  readonly label?: string;
  /** 排他グループに属するなら、その所属(`variants:` の下に書かれた部品)。 */
  readonly variant?: VariantMembership;
  /**
   * この部品が**生成物**であることの宣言(任意。ADR-0015)。値域は `ComponentKind`
   * (`form` / `table` / `detail` / `actions` / `platform_read` / `platform_actions`)。
   * **書かなければ手書きの部品**(層 c)である — 手書きが既定で、生成物にするときだけ宣言する
   * (免除の語は作らない)。`form` は `actionRefs` と、`table` / `detail` は `readRef` と組になる。
   */
  readonly kind?: ComponentKind;
  /**
   * `kind: form` の部品が載せる操作(`action:` に書かれたもの。ドメインイベント ID / 予約 ID)。
   *
   * 文字列 1 つでも一覧でも読み取る — **「1 部品 1 操作」は S17 が数える**(パーサーが弾くと
   * 「2 つ書いた」という違反が S17 の表から消え、検査の所在が文書と実装でずれる)。
   */
  readonly actionRefs?: readonly ScreenRef[];
  /**
   * 部品が出す**読み**(`reads:` に書かれた query_spec の ID。画面の `reads` の要素。ADR-0015 の改訂)。
   *
   * `kind: table` / `detail` では必須(どの読みの行を出すか)。`kind: form` では任意で、参照の欄の
   * 選択肢の出どころ(`[id, 表示名]` の 2 欄の読み)を指す。1 部品 1 本(文字列 1 つ。一覧はパーサー(S0)が弾く)。
   */
  readonly readRef?: ScreenRef;
  /**
   * `kind: table` / `detail` の部品が出す欄(`shows:` に書かれたもの)。`{欄}` か併読の `{併読名}.{欄}`。
   *
   * 省略(`undefined`)は「読みの projection のうち id と ref の欄を除く全欄(併読は `{併読名}.{欄}`)」。
   * 実在と ref でないことは S18 が見る。
   */
  readonly showRefs?: readonly ScreenRef[];
  /** `kind: table` が行をその場で編集する操作(`edit:`。`shape: update` の操作 1 つ。`shows` とは併せて書けない — S0 / S19)。 */
  readonly editRef?: ScreenRef;
  /** `kind: table` / `actions` がボタンにする操作(`actions:`。遷移のイベントか予約 ID の `delete` — S19)。 */
  readonly buttonRefs?: readonly ScreenRef[];
  /** `kind: platform_read` が表にするプラットフォーム操作(`op:`。`read` の操作 1 つ — S20)。 */
  readonly platformOpRef?: ScreenRef;
  /** `kind: platform_actions` が載せるプラットフォーム操作(`ops:`。`do` の操作 — S20)。 */
  readonly platformOpRefs?: readonly ScreenRef[];
  /** `kind: platform_read` / `table` の行ごとのボタンにするプラットフォーム操作(`row_actions:`。`do` の操作 — S20)。 */
  readonly rowActionRefs?: readonly ScreenRef[];
  readonly location: SourceLocation;
}

/**
 * レイアウトのスロット 1 つ(平坦化したもの)。
 *
 * `slot` は書かれたままのキー列(`header` / `body.center` など)であり、
 * **値域かどうかの判定はここでは行わない**(S6 の役目)。パーサーが弾いてしまうと
 * 「知らないスロットを書いた」という違反が S6 の表に現れず、検査の所在が分からなくなる。
 */
export interface LayoutSlot {
  /** スロットの局所名(値域の判定に使う)。例: `header` / `body.center`。 */
  readonly slot: string;
  /**
   * 宣言の根からのフルパス。例: `body.center` / `body.center.own_entry.footer`。
   *
   * 平坦化しても**親を失わない**ようにフルパスで持つ。同じ部品名が 2 か所に現れても
   * 一意に復元でき、そのまま testid の骨格(`{name}.{フルパス}.{部品}`)になる
   * (C-2 の testid 定数生成が、この 1 本の文字列だけを頼りにできる)。
   */
  readonly path: string;
  /** 入れ子の親コンポーネント名。トップレベルのスロットは null。 */
  readonly owner: string | null;
  readonly components: readonly LayoutComponent[];
  readonly location: SourceLocation;
}

/** 3×3 スロット + 入れ子のレイアウト宣言(平坦化して保持する)。 */
export interface ScreenLayout {
  /**
   * `layout` の宣言そのものがあったか。
   *
   * 「キーが無い」(S0 がエラーにする)と「書いたが中身が空」(S6 がエラーにする)を区別するために持つ。
   * 区別しないと、1 つの書き忘れに 2 つのエラーが出る。
   */
  readonly declared: boolean;
  readonly slots: readonly LayoutSlot[];
  readonly location: SourceLocation;
}
