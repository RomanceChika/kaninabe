/**
 * 仕様の要素を **公理 / 導出 / 受け入れ** に分ける(book-human-face.md §7-2)。
 *
 * 人が読まなければならないのは「機械に照合相手が無い宣言」だけである。要素は **種類で** 決まるので、
 * 宣言は増やさず、ここが種類の表を持つ。ブックの章(上段 = 公理 / 下段 = 導出)・手引き(必読 N)・
 * `spec:diff`(公理側の差分)が**同じ表**を読む —— 生成器の中に印の規則を散らさない。
 *
 * - **公理** … 人が意味を判定する(外の世界との一致。機械は照合相手を持たない)。必読
 * - **受け入れ** … 機械が疑い、人が理由をつけて通した(または、まだ通していない)。必読
 * - **導出** … 公理から機械が出した(検査・突合が公理との一致を保証する)。参照
 *
 * **宣言が要る要素は無い**(種類で決まらないものは無かった)。導出のはずが人の手で書かれたもの
 * (`hooks` / 手書きのアダプタ)は、コード側の注釈(`@spec` / `@tc`)が公理に結び、A 群がその結びを見る
 * ので、導出に置く。手で書いた**理由**がある(`runner: manual` / `handwritten`)ものは受け入れである。
 *
 * 純粋関数と定数だけ(意味解析の層)。**アプリの語彙は 1 語も持たない。**
 * 標識の割り付け(付いている仕様の種類 → 要素の種類・読み手)は `reading-sign.ts`。
 *
 * @oversize 要素の ID → 読み方の分類(`READING_ELEMENTS`)と、要素の ID → 読み手(`READING_READERS`)は、同じ要素の全数を 2 つの面から宣言する
 * 同じ種類の表で、1 要素を足す日に 2 枚の同じ行を並べて足す。1 か所で並べて読めば、要素の足し忘れ(片方だけ)を目で見つけられる。
 * @split-review 割る案は 1 つ。分類の表と読み手の表を別ファイルにする案: 2 枚は同じキーの全数を要求する(片方に足して片方を忘れる事故は
 * 構造テスト `reading-class.test.ts` が見る)ので、割ると行を足すたびに 2 つのファイルを開くことになり、食い違いの検出がテストだけに寄る。
 * 採らず、表のまま 1 枚に置く。
 */

/** 読み方の分類。 */
export type ReadingClass = 'axiom' | 'derived' | 'accepted';

/**
 * 読み手(その項目を読んで判断する人)。**業務** = 業務の判断をする人 / **開発者**。
 *
 * 項目の**種類**で決まる(`READING_READERS`。宣言は増やさない)。公理は業務の判断で、受け入れは種類によって
 * 分かれる —— 理由が業務の規定(`accept:`)なら業務、仕組みの置き場の手書き・定型外の操作・確認の上書き・
 * リントの受け入れ・構造の警告なら開発者が通した理由と未処理である。
 */
export type ReadingReader = 'business' | 'developer';

/**
 * 要素の種類 → 分類(これが全部)。
 *
 * 1 行 1 種類で、表にない種類は型で書けない。公理のうち、章の上段に項目として並べて数えるのは、
 * 不変条件(`invariant.*`)・アクセスの宣言(`access.*`)・状態の意味と要約の文(`state.summary` /
 * `entity.summary` / `machine.summary`)・計算の例の表(`computes.example`)の 4 種類である(数え方は
 * `reading-axioms.ts`)。計算される欄(`computes`)の**宣言**は**導出**に置く(`computes.declaration`): 宣言は欄と
 * 純関数の名前だけで、式は DSL の外の純関数の中にあり、人が判定する対象が宣言に無い。書き手の側は access の
 * 「システムが書く欄」で必読に入る。**式の代わりに人が判定する対象は例の表**である: 「この入力ならこの値」の行は
 * 外の世界(業務の規則)との一致を人が見るもので、機械は生成したテストで純関数との一致だけを保証する
 * (だから公理に置く)。状態の表示名とイベントの意味(`state.label` / `transition.meaning`)は、
 * 状態の段に畳まれて出ており、別には数えない(`spec:diff` の公理の側では差分を見る)。
 *
 * **通知・ジョブ・画面の層**(束 ブック ⑧-b)も同じ表に載る。各層の公理は「外の世界との一致を人が判定する宣言」で、
 * 通知は誰に何をどの強さで知らせるか、ジョブはいつ・何を基準に・何をし・失敗したらどうするか、画面は誰が入れて・何を読み・
 * 何を束ね・何を出すか(同時には出ない表示を含む)である。発火元・実装・登録・テスト・遷移・testid・プレビューは**導出**。
 * 受け入れの理由を書く欄が仕様に無い層は、理由つき 0 件と言う(欄を作る話は別)。受け入れの種類を足すのは、読み手が違うときだけ
 * (`job.not_scheduled_reason` は cron を結線する運用の判断なので開発者。`accept.reason` は業務)。
 *
 * **認証・設定・保証・可視性・操作の層**(束 ブック ⑧-c)。認証は決定表の分岐・着地・関門(誰がどこへ着き、通れない人がどうなるか)、
 * 設定は値の意味と無いときの挙動と値の性質・要求度の語(値そのものは出さない)、保証は「起こりえない」と主張する性質が公理。
 * 決定表の**軸**は種類で分かれる: 値・持つ行(`when` / `optional`)をこの仕様が直接宣言する軸(`kind: enum`)は**公理**
 * (`auth.condition`。照合相手が無く、全域性検査 H1 は宣言を前提にする側)。値の全体を状態機械や enum の欄が決める
 * 主語の軸(`kind: state` / `kind: field`)だけが**導出**(`auth.axis`)。
 * 実装・テスト・連携の表・雛形との対応・執行者・変異の目録は導出。設定の「雛形に載せない理由」(`config.not_in_template_reason`)は
 * 開発者が通した理由。**可視性と操作の章に公理は無い**: 可視性の宣言(`access.*`)は集約の章が、操作の確認の上書き・定型外の理由は
 * 集約の章の受け入れが既に数えているので、2 章は導出の表(横断の見方)だけを持つ(同じ ID を二度必読に数えない)。
 */
export const READING_ELEMENTS = {
  // --- 公理(人が意味を判定する) ---
  'invariant.statement': 'axiom',
  'invariant.formal': 'axiom',
  'state.label': 'axiom',
  'state.summary': 'axiom',
  'entity.summary': 'axiom',
  'machine.summary': 'axiom',
  'transition.meaning': 'axiom',
  'access.filters': 'axiom',
  'access.when': 'axiom',
  'usecase.budget': 'axiom',
  'computes.example': 'axiom',
  'sign.domain': 'axiom',
  'notification.audience': 'axiom',
  'notification.mention': 'axiom',
  'notification.summary': 'axiom',
  'job.schedule': 'axiom',
  'job.due_from': 'axiom',
  'job.summary': 'axiom',
  'job.on_failure': 'axiom',
  'screen.for': 'axiom',
  'screen.precondition': 'axiom',
  'screen.reads': 'axiom',
  'screen.actions': 'axiom',
  'screen.parts': 'axiom',
  'screen.variants': 'axiom',
  'auth.condition': 'axiom',
  'auth.branch': 'axiom',
  'auth.landing': 'axiom',
  'auth.gate': 'axiom',
  'config.summary': 'axiom',
  'config.absence': 'axiom',
  'config.kind': 'axiom',
  'config.requirement': 'axiom',
  'guarantee.statement': 'axiom',
  // --- 受け入れ(機械が疑い、人が理由をつけて通した / まだ通していない) ---
  'accept.reason': 'accepted',
  'accept.example': 'accepted',
  'handwritten.reason': 'accepted',
  'runner.reason': 'accepted',
  'ux.override.reason': 'accepted',
  'lint.exception.reason': 'accepted',
  'finding.pending': 'accepted',
  'sign.decision': 'accepted',
  'job.not_scheduled_reason': 'accepted',
  'config.not_in_template_reason': 'accepted',
  // --- 導出(機械が公理から出した) ---
  'invariant.enforced_by': 'derived',
  'invariant.tests': 'derived',
  'transition.table': 'derived',
  'transition.matrix': 'derived',
  'execution.plan': 'derived',
  'rpc.body': 'derived',
  'rls.policy': 'derived',
  'api.view': 'derived',
  'screen.wiring': 'derived',
  'result.table': 'derived',
  'parity.expectation': 'derived',
  'computes.declaration': 'derived',
  'hooks.body': 'derived',
  'adapter.handwritten': 'derived',
  'notification.source': 'derived',
  'notification.tests': 'derived',
  'job.implementation': 'derived',
  'job.source': 'derived',
  'job.tests': 'derived',
  'screen.navigation': 'derived',
  'screen.testid': 'derived',
  'screen.preview': 'derived',
  'screen.tests': 'derived',
  'auth.axis': 'derived',
  'auth.implementation': 'derived',
  'auth.tests': 'derived',
  'config.integration': 'derived',
  'config.target': 'derived',
  'config.template': 'derived',
  'config.crypto': 'derived',
  'config.logging': 'derived',
  'config.log_events': 'derived',
  'config.log_fields': 'derived',
  'guarantee.enforcer': 'derived',
  'guarantee.tests': 'derived',
  'guarantee.mutation': 'derived',
  'visibility.matrix': 'derived',
  'visibility.personal': 'derived',
  'visibility.query': 'derived',
  'action.operation': 'derived',
  'action.exception': 'derived',
} as const satisfies Readonly<Record<string, ReadingClass>>;

/** 要素の種類。 */
export type ReadingElement = keyof typeof READING_ELEMENTS;

/**
 * ある分類に属する要素の種類(型)。章が行や折りたたみを組むとき、**どの段に置くかは表が決める**ので、
 * 上段の行は `ElementsOf<'axiom'>`、下段の折りたたみは `ElementsOf<'derived'>` の種類しか受け取らない
 * (導出の種類を上段に置く・公理の種類を畳んで下段に置く、が型で書けない)。
 */
export type ElementsOf<C extends ReadingClass> = {
  [K in ReadingElement]: (typeof READING_ELEMENTS)[K] extends C ? K : never;
}[ReadingElement];

/**
 * 要素の種類 → 読み手(これが全部)。`READING_ELEMENTS` と同じ鍵で、表に無い種類は型で書けない。
 *
 * - 公理 … すべて業務(人が意味を判定する宣言は、業務の言葉で書かれている)
 * - 受け入れ … `accept:` の理由と「例:」は業務。手書き(`handwritten`)・定型外(`runner`)・確認の上書き(`ux`)・
 *   リントの受け入れ(`exceptions`)の理由は、実装の事情なので開発者。警告は `readerOfFinding` が検査の群で決める
 *   (ここでは開発者を既定にする)
 * - 標識 … 付いている仕様の種類で決める(`reading-sign.ts` の `SIGN_READER`。`sign.domain` は業務、`sign.decision` は置き場による)
 * - 導出 … 読まなくてよいので、読み手は決めない(開発者に置く。数えない)
 */
export const READING_READERS = {
  'invariant.statement': 'business',
  'invariant.formal': 'business',
  'state.label': 'business',
  'state.summary': 'business',
  'entity.summary': 'business',
  'machine.summary': 'business',
  'transition.meaning': 'business',
  'access.filters': 'business',
  'access.when': 'business',
  'usecase.budget': 'business',
  'computes.example': 'business',
  'sign.domain': 'business',
  'notification.audience': 'business',
  'notification.mention': 'business',
  'notification.summary': 'business',
  'job.schedule': 'business',
  'job.due_from': 'business',
  'job.summary': 'business',
  'job.on_failure': 'business',
  'screen.for': 'business',
  'screen.precondition': 'business',
  'screen.reads': 'business',
  'screen.actions': 'business',
  'screen.parts': 'business',
  'screen.variants': 'business',
  'auth.condition': 'business',
  'auth.branch': 'business',
  'auth.landing': 'business',
  'auth.gate': 'business',
  'config.summary': 'business',
  'config.absence': 'business',
  'config.kind': 'business',
  'config.requirement': 'business',
  'guarantee.statement': 'business',
  'accept.reason': 'business',
  'accept.example': 'business',
  'handwritten.reason': 'developer',
  'runner.reason': 'developer',
  'ux.override.reason': 'developer',
  'lint.exception.reason': 'developer',
  'finding.pending': 'developer',
  'sign.decision': 'developer',
  'job.not_scheduled_reason': 'developer',
  'config.not_in_template_reason': 'developer',
  'invariant.enforced_by': 'developer',
  'invariant.tests': 'developer',
  'transition.table': 'developer',
  'transition.matrix': 'developer',
  'execution.plan': 'developer',
  'rpc.body': 'developer',
  'rls.policy': 'developer',
  'api.view': 'developer',
  'screen.wiring': 'developer',
  'result.table': 'developer',
  'parity.expectation': 'developer',
  'computes.declaration': 'developer',
  'hooks.body': 'developer',
  'adapter.handwritten': 'developer',
  'notification.source': 'developer',
  'notification.tests': 'developer',
  'job.implementation': 'developer',
  'job.source': 'developer',
  'job.tests': 'developer',
  'screen.navigation': 'developer',
  'screen.testid': 'developer',
  'screen.preview': 'developer',
  'screen.tests': 'developer',
  'auth.axis': 'developer',
  'auth.implementation': 'developer',
  'auth.tests': 'developer',
  'config.integration': 'developer',
  'config.target': 'developer',
  'config.template': 'developer',
  'config.crypto': 'developer',
  'config.logging': 'developer',
  'config.log_events': 'developer',
  'config.log_fields': 'developer',
  'guarantee.enforcer': 'developer',
  'guarantee.tests': 'developer',
  'guarantee.mutation': 'developer',
  'visibility.matrix': 'developer',
  'visibility.personal': 'developer',
  'visibility.query': 'developer',
  'action.operation': 'developer',
  'action.exception': 'developer',
} as const satisfies Readonly<Record<ReadingElement, ReadingReader>>;

/** 要素の読み手。 */
export function readerOf(element: ReadingElement): ReadingReader {
  return READING_READERS[element];
}

/**
 * 検査の ID → その警告が疑っている要素(分類の表の鍵)。群では決まらず、疑う先の種類で読み手が決まるもの。
 *
 * Y5(タスクの手数の予算の超過)は、予算(`usecase.budget`。分類では公理 = 業務の規定)への疑いである。
 */
const FINDING_ELEMENT: Readonly<Record<string, ReadingElement>> = {
  Y5: 'usecase.budget',
};

/**
 * まだ通していない警告 1 件の読み手。
 *
 * 疑う先の要素が表で決まる検査(`FINDING_ELEMENT`)はその要素の読み手。そうでなければ検査の群の頭文字で決める —— V 群
 * (ドメイン仕様の意味の検査)は業務の宣言の疑いなので業務、それ以外(T・A・Y・S・Q・W…= 表の執行点・操作の配線・
 * 保存点の置き方などの構造)は開発者である。
 */
export function readerOfFinding(verifierId: string): ReadingReader {
  const element = FINDING_ELEMENT[verifierId];
  if (element !== undefined) return readerOf(element);
  return verifierId.startsWith('V') ? 'business' : 'developer';
}

/** 読み手の呼び名(手引きの見出しとカードに出す)。 */
export const READER_NAMES: Readonly<Record<ReadingReader, string>> = {
  business: '業務',
  developer: '開発者',
};

/** 要素の分類。 */
export function readingClassOf(element: ReadingElement): ReadingClass {
  return READING_ELEMENTS[element];
}

/** 分類に属する要素の種類(表の並び順)。 */
export function elementsOf(readingClass: ReadingClass): readonly ReadingElement[] {
  return (Object.keys(READING_ELEMENTS) as ReadingElement[]).filter((element) => READING_ELEMENTS[element] === readingClass);
}

/** 必読か(公理と受け入れ。導出は読まなくても公理の判定が変わらない)。 */
export function isRequiredReading(readingClass: ReadingClass): boolean {
  return readingClass !== 'derived';
}
