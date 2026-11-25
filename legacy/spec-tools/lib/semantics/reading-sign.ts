/**
 * 標識(手書きの段落・箇条)の読み方の割り付け。
 *
 * 標識は「どの仕様に付いているか」で分類と読み手が決まる。要素の種類の表(`reading-class.ts`)と同じ分類を引くので、
 * 標識の割り付けだけをここに切り出した(表そのものは `reading-class.ts` が唯一の置き場)。
 *
 * 純粋関数と定数だけ(意味解析の層)。**アプリの語彙は 1 語も持たない。**
 */

import { readingClassOf, type ReadingClass, type ReadingElement, type ReadingReader } from './reading-class.js';

/**
 * 標識(手書きの段落・箇条)が付いている仕様の種類。
 *
 * 標識は**人が書いた判断の場所**であり、導出ではない。付いている仕様が意味を宣言するもの(ドメインの
 * 4 ファイルとロール)なら、その公理への注記(公理の側)。それ以外 —— 操作・表・タスク・カタログなど
 * 公理から導いた置き場に書かれた判断 —— は、導出の置き場で人が下した判断の記録(受け入れの側)である。
 */
export type SignHost =
  | 'entity'
  | 'states'
  | 'invariants'
  | 'access'
  | 'roles'
  | 'action'
  | 'table'
  | 'usecase'
  | 'query'
  | 'surface'
  | 'notice'
  | 'catalog'
  | 'screen'
  | 'design';

/** 標識が付く仕様の種類 → 要素の種類。 */
export const SIGN_ELEMENT: Readonly<Record<SignHost, ReadingElement>> = {
  entity: 'sign.domain',
  states: 'sign.domain',
  invariants: 'sign.domain',
  access: 'sign.domain',
  roles: 'sign.domain',
  action: 'sign.decision',
  table: 'sign.decision',
  usecase: 'sign.decision',
  query: 'sign.decision',
  surface: 'sign.decision',
  notice: 'sign.decision',
  catalog: 'sign.decision',
  screen: 'sign.decision',
  design: 'sign.decision',
};

/** 標識の分類(付いている仕様の種類から決まる)。 */
export function signClassOf(host: SignHost): ReadingClass {
  return readingClassOf(SIGN_ELEMENT[host]);
}

/**
 * 標識の読み手(付いている仕様の種類から決まる)。
 *
 * **業務** … ドメインの 4 ファイル・ロール・操作・タスク・読み取り経路と外から届く surface(誰に何が見えるか)・
 * 画面・通知。利用者に見えるもの・誰が何をできるかは業務の判断である。
 * **開発者** … 表(data_table)の手書きの理由・設計(トークン)・カタログのうち通知以外(ジョブ・設定・認証・
 * 保証・外部連携)。
 */
export const SIGN_READER: Readonly<Record<SignHost, ReadingReader>> = {
  entity: 'business',
  states: 'business',
  invariants: 'business',
  access: 'business',
  roles: 'business',
  action: 'business',
  usecase: 'business',
  query: 'business',
  surface: 'business',
  screen: 'business',
  notice: 'business',
  table: 'developer',
  design: 'developer',
  catalog: 'developer',
};
