/**
 * **実行時に書き換えさせない生成の定数**の一覧(1 か所)と、生成物がその一覧どおりに凍結しているかの関所。
 *
 * 生成した定数は型の上では readonly でも実体は書き換えられ、任意のモジュールの最上位の `Object.assign` で
 * 以後の要求の全部に効く(点検 7 回目 B7-5)。B7-5 の直しは `BROWSER_DEFENSE` と `PAID_ENTRIES` の 2 本を
 * 生成器ごとに凍らせただけで、帰り道の着地 `AUTH_LANDING_PATHS` は凍っておらず、最上位の 1 行で
 * サインイン後の着地を外の URL にできた(点検 8 回目 B8-4)。8 回目の一覧も、転送・リンクの規則が安全の根とする
 * `screenRoutes` と認可の表(`ROLE_*`・`AUTHENTICATED_WHEN`)・遷移の表示の表(`NAVIGATION_VISIBILITY`)を落としていた
 * (点検 9 回目 B9-7)。生成器ごとに選ぶ形では、新しい定数の凍らせ忘れが黙って通る —— ここに**安全に関わる定数の名前を全部**並べ、
 * 生成の共通の出口(`cli/generate-docs.ts`)が書く前に一覧の定数が `deepFreeze(…)` で初期化されていることを見る
 * (凍っていなければ何も書かずに止める)。
 *
 * **一覧の決め方(ここが唯一の正)**。値が次のどれかに使われる生成の定数は一覧に載せる:
 *   1. 転送先・リンク先の正(規則や部品が「生成した経路だから安全」と信じる値。`screenRoutes`・`AUTH_LANDING_PATHS`・`AUTH_ENTRY_PATHS`)
 *   2. 認可・関門の判断(どの役が立つか・どの画面に入れるか・何を表示するか・どの操作を誰がどの値で起こせるか)。名前の一覧は
 *      `ROLE_*`・`AUTHENTICATED_WHEN`・`AUTH_GATES`・`SIGN_IN_BRANCHES`・`NAVIGATION_VISIBILITY`・`runtimeBindings`(実行器が読む束)。ファイルの一覧は
 *      engine の規則表(`{機械}.transitions.ts` の `by` / guard・`{集約}.creates.ts` の `self`・`{集約}.writes.ts`・`{集約}.deletes.ts`)・
 *      実行計画(`operation-plans.ts`・`usecase-plans.ts` の引数の供給元 `{ kind: 'actor' }`)・セッションの写し(`session-profile.ts` の `SESSION_FIELDS`)
 *   3. 応答の守り・上限・待ち時間(`BROWSER_DEFENSE`・`PAID_ENTRIES`・`EXTERNAL_EXPECTATIONS`)
 *   4. 見張りの正(書き換えると見張りが黙る)。名前の一覧は `rpcExpectations`・`personalColumnsByTable`。ファイルの一覧は
 *      **見張りの期待の生成物の全部**(`*-expectations.ts` —— RLS・ACL・API・data_table・DDL・索引・個人列・構造の期待)と、
 *      遷移が書く列の期待(`transition-writes.ts`)
 * 原始値(文字列 1 つ)の定数は凍結の対象が無いので載せない。**一覧の外に置くもの**: 表示・入力の形(`*.labels.ts`・`*.schema.ts`・
 * トークン・testid)は書き換えても認可・見張りに届かない。見張りの世界の材料(`*-worlds.ts`)は期待ではなく試験の入力で、
 * 大きく(製品で 600KB 近い)・`Object.keys` の派生の定数を持つので、凍結は BACKLOG に置いた(理由もそこに書く)。
 * 名前の一覧に載せるのは名前が生成器の語彙で決まる定数で、名前が集約ごとに変わる表(engine の規則表)はファイルの一覧で載せる。
 * 生成器を足す・ファイルの名前を変えるときは、この 4 つのどれに当たるかを先に決めてここに書く。
 *
 * **隣の定数も漏らさない**(ファイル単位の閉世界)。一覧の定数を 1 本でも出す生成物のファイルと、ファイルの一覧に当たる生成物のファイルは
 * 「安全の表のファイル」であり、そのファイルが外へ出す定数は全部、`deepFreeze(…)`・原始値のリテラル・凍った値の別名のどれかで初期化する
 * (隣に足した表の凍らせ忘れ・`Object.freeze` の浅い凍結・`new Map` を関所が止める)。外へ出す値は構文木で読み、読めない形
 * (`export *`・再 export・分割代入・`export let`・`export function` など)は通さない。`deepFreeze` の引数はリテラルで閉じる(`Map` / `Set`・getter は凍らない)(`frozen-exports.ts`。点検 11・12 回目 A11-2 / A12-4)。一覧と実際の生成物の突き合わせ
 * (一覧の名前が生成物に実在すること・ファイルの一覧のどれもが生成物に当たること・安全の根として規則が信じる名前が一覧に載ること)は
 * 単体テストが見る。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない**(定数の名前は生成器の語彙)。
 */

import { DEEP_FREEZE } from './code-emit.js';
import { readFileExports } from './frozen-exports.js';

/** 凍結する定数 1 本(名前と、書き換えられたら何が崩れるか)。 */
export interface FrozenConstant {
  readonly name: string;
  readonly why: string;
}

/** 実行時に書き換えさせない生成の定数(安全に関わるものの全部)。 */
export const FROZEN_CONSTANTS: readonly FrozenConstant[] = [
  { name: 'BROWSER_DEFENSE', why: '応答の見出し(CSP・枠の埋め込み・no-store)。書き換えると全応答の防御が外れる(B7-5)' },
  { name: 'PAID_ENTRIES', why: '有料の口の本文の上限・役・枠。書き換えると上限と認可が外れる(B7-5)' },
  { name: 'AUTH_LANDING_PATHS', why: 'OAuth の帰り道の着地。書き換えるとサインイン後の転送先を外の URL にできる(B8-4)' },
  { name: 'AUTH_ENTRY_PATHS', why: '認証の口(callback / start / logout)の経路。書き換えるとログインのフォームの送り先が変わる(B8-4)' },
  { name: 'SIGN_IN_BRANCHES', why: 'サインインの決定表(着地と実行する操作)。書き換えると着地・起こす操作が変わる(B8-4)' },
  { name: 'AUTH_GATES', why: '画面の関門の全数。書き換えると関門の見張りの母集合が変わる(B8-4)' },
  { name: 'EXTERNAL_EXPECTATIONS', why: '外部連携の待ち時間・再試行。書き換えると待ち時間の上限が外れる(B8-4)' },
  { name: 'rpcExpectations', why: 'RPC の本文の期待(rpc-parity の正)。書き換えると見張りが黙る(B8-4)' },
  { name: 'personalColumnsByTable', why: '個人列の表(rpc-parity の scrub の要求)。書き換えると消去の見張りが黙る(B8-4)' },
  { name: 'screenRoutes', why: '画面の経路の表。転送・リンクの規則が安全の根とし、書き換えると生成した経路の転送・リンクを外の URL にできる(B9-7)' },
  { name: 'ROLE_IMPLICATIONS', why: 'ロールの含意の閉包。書き換えると先読みの認可が変わる(B9-7)' },
  { name: 'ROLE_GATES', why: 'ロールが立つ行の条件。書き換えると役の関門の先読みが外れる(B9-7)' },
  { name: 'AUTHENTICATED_WHEN', why: '既定のログインロールが立つ行の条件。書き換えると認証の関門の先読みが外れる(B9-7)' },
  { name: 'GLOBAL_ROLES', why: 'グローバルロールの対応表。書き換えると未ログイン・既定のロールの解決が変わる(B9-7)' },
  { name: 'ROLE_IDS', why: 'ロール ID の恒等表。書き換えると仕組み側の役の参照が別の役を指す(B9-7)' },
  { name: 'NAVIGATION_VISIBILITY', why: '遷移の表示の可否(入場条件)。書き換えると関門のある画面への遷移が誰にでも出る(B9-7)' },
  { name: 'runtimeBindings', why: '実行器へ渡す束(ロールの表・多要素認証の要求)。書き換えると凍った表の参照を丸ごと差し替えられる(A11-2)' },
];

/** 凍結するファイル 1 種(生成物のファイル名の形と、書き換えられたら何が崩れるか)。 */
export interface FrozenFile {
  /** 人が読む形(`{集約}.creates.ts` など)。 */
  readonly shape: string;
  /** ファイル名(ディレクトリを除く)に当てる形。 */
  readonly pattern: RegExp;
  readonly why: string;
}

/** 生成物の名前の 1 区切り(集約名・機械名)。 */
const SEGMENT = '[a-z][a-z0-9_]*';

/**
 * 実行時に書き換えさせない生成物のファイル(名前が集約ごとに変わる表・隣に表を並べるファイル。決め方 2・4。点検 10 回目 A10-5)。
 * ファイルの `export const` は全部ファイル単位の閉世界で凍らせる。
 */
export const FROZEN_FILES: readonly FrozenFile[] = [
  { shape: '{機械}.transitions.ts', pattern: new RegExp(`^${SEGMENT}\\.transitions\\.ts$`, 'u'), why: 'engine の遷移の表(by・guard)。書き換えると遷移の認可の判断が変わる(A10-5)' },
  { shape: '{集約}.creates.ts', pattern: new RegExp(`^${SEGMENT}\\.creates\\.ts$`, 'u'), why: 'engine の作成の表(by・when・self)。書き換えると作成の認可と実行者への縛りが変わる(A10-5)' },
  { shape: '{集約}.writes.ts', pattern: new RegExp(`^${SEGMENT}\\.writes\\.ts$`, 'u'), why: 'engine の編集の表(by・fields・when)。書き換えると編集の認可が変わる(A10-5)' },
  { shape: '{集約}.deletes.ts', pattern: new RegExp(`^${SEGMENT}\\.deletes\\.ts$`, 'u'), why: 'engine の削除の表(by・when)。書き換えると削除の認可が変わる(A10-5)' },
  { shape: 'operation-plans.ts', pattern: /^operation-plans\.ts$/u, why: '単発の操作の実行計画(引数の供給元)。書き換えると実行者で埋める引数を入力に替えられる(A10-5)' },
  { shape: 'usecase-plans.ts', pattern: /^usecase-plans\.ts$/u, why: '保存点の実行計画(引数の供給元)。書き換えると実行者で埋める引数を入力に替えられる(A10-5)' },
  { shape: 'session-profile.ts', pattern: /^session-profile\.ts$/u, why: 'セッションの写しの欄(claim と actor.{欄} の先読みの正)。書き換えると先読みの役・境界が変わる(A10-5)' },
  { shape: '*-expectations.ts', pattern: /^[a-z][a-z0-9-]*-expectations\.ts$/u, why: '見張りの期待(RLS・ACL・API・data_table・DDL・索引・個人列・構造・RPC・外部連携)。書き換えると見張りが黙る(A10-5)' },
  { shape: 'transition-writes.ts', pattern: /^transition-writes\.ts$/u, why: '遷移が書く列・状態の列の期待。書き換えると遷移の書き込みの見張りが黙る(A10-5)' },
];

/** 一覧の名前の集合。 */
const NAMES: ReadonlySet<string> = new Set(FROZEN_CONSTANTS.map((constant) => constant.name));

/**
 * そのファイルがファイルの一覧に当たるか(当たる種類。当たらなければ undefined)。
 *
 * @param file 生成物のファイルのパス
 * @returns 当たったファイルの種類
 */
export function frozenFileOf(file: string): FrozenFile | undefined {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return FROZEN_FILES.find((entry) => entry.pattern.test(base));
}

/**
 * 一覧の定数の初期化子を凍結で包む(生成器が使う 1 本)。
 *
 * @param literal 初期化子の式(`as const satisfies …` を含んでよい)
 * @returns `deepFreeze(…)`
 */
export function frozen(literal: string): string {
  return `${DEEP_FREEZE}(${literal})`;
}

/** 生成物のファイル 1 本の内容(セクションの並び)。 */
export interface FrozenSection {
  readonly content: string;
}

/** 凍結の関所が止めた 1 件。 */
export interface FrozenRefusal {
  readonly file: string;
  readonly reason: string;
}

/** 関所が読む TypeScript のファイルか。 */
const TYPESCRIPT_FILE = /\.(?:ts|tsx|mts)$/u;

/**
 * 生成物が一覧の定数を凍結しているかを見る(凍っていない一覧の定数と、安全の表のファイルの凍っていない隣の定数を名指す)。
 *
 * 見るのは TypeScript の生成物だけである。一覧の定数が出てくるファイル・ファイルの一覧に当たるファイル(安全の表のファイル)は、
 * 外へ出す定数を全部 `deepFreeze(…)`・原始値・凍った値の別名のどれかで初期化する(ファイル単位の閉世界)。外へ出す値は
 * `frozen-exports.ts` が構文木で読み、**読めない形は通さず赤にする**(点検 11 回目 A11-2)。`deepFreeze(…)` を使う
 * 安全の表のファイルには補助の関数の定義(`DEEP_FREEZE_HELPER` と同じ字面)も要る(関数を消して同名の素通しに差し替える形も止める)。
 *
 * @param byFile 生成物のファイル → セクション
 * @returns 止めた理由(ファイル順)
 */
export function unfrozenConstantRefusals(byFile: ReadonlyMap<string, readonly FrozenSection[]>): readonly FrozenRefusal[] {
  const refusals: FrozenRefusal[] = [];
  for (const [file, sections] of byFile) {
    if (!TYPESCRIPT_FILE.test(file)) continue;
    const content = sections.map((section) => section.content).join('\n');
    const read = readFileExports(file, content);
    const kind = frozenFileOf(file);
    const named = [...read.constants.map((constant) => constant.name), ...read.declared, ...read.unreadableNames].some((name) => NAMES.has(name));
    if (kind === undefined && !named) continue;
    for (const form of read.unreadable) {
      refusals.push({ file, reason: `安全の表のファイルの ${form} は読めない形です(凍っていると言えないので止める)。生成器は export const 名前 = ${DEEP_FREEZE}(…) の形で書く` });
    }
    for (const name of read.exportedFunctions) {
      refusals.push({ file, reason: `安全の表のファイルの関数 ${name} は読めない形です(戻り値に可変の表を返せるので止める)。生成器は凍った定数として書く` });
    }
    for (const { name, state } of read.constants) {
      if (state === 'frozen') continue;
      if (NAMES.has(name)) {
        refusals.push({ file, reason: `生成の定数 ${name} が ${DEEP_FREEZE}(…) で初期化されていません(${whyOf(name)})。生成器は frozen(…) で包む` });
      } else if (state === 'unfrozen') {
        refusals.push({
          file,
          reason:
            kind === undefined
              ? `安全の表のファイルの定数 ${name} が ${DEEP_FREEZE}(…) で初期化されていません(一覧の定数と同じファイルの表は全部凍らせる)。生成器は frozen(…) で包むか、原始値・別名にする`
              : `安全の表のファイル(${kind.shape})の定数 ${name} が ${DEEP_FREEZE}(…) で初期化されていません(${kind.why})。生成器は frozen(…) で包むか、原始値・別名にする`,
        });
      }
    }
    const usesFreeze = read.constants.some(({ name, state }) => NAMES.has(name) || state === 'frozen');
    if (usesFreeze && !read.helper) {
      refusals.push({ file, reason: `凍結する定数を持つのに補助の関数 ${DEEP_FREEZE} の定義がありません(生成器は DEEP_FREEZE_HELPER を置く)` });
    }
  }
  return refusals.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** 一覧の理由。 */
function whyOf(name: string): string {
  return FROZEN_CONSTANTS.find((constant) => constant.name === name)?.why ?? '';
}
