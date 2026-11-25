/**
 * 文の名詞を **ID の羅列にしない**ための表示名の帳面。
 *
 * 表示名は仕様の `label` の写し(`{集約}.labels.ts` の状態・イベント、`roles.ts` のロール)で
 * あり、仕組み側がここで日本語を発明することはない。**差分の判定には一切使わない** ——
 * 表示名だけが動いた版で行が出てはならないからである(そのための分離は `sources.ts` の
 * `LABEL_SOURCES` が宣言する)。
 *
 * 帳面は head 側を先に読み、無い語だけ base 側で補う —— 消えた操作の文にも名前を出すためである。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { isLabelsPath, roleLabelsPath, stemOf } from './sources.js';
import type { PlainValue } from './ts-literal.js';
import { exportedNames, readExportedValue } from './ts-literal.js';
import type { SideSnapshot } from './types.js';
import type { ProductRoots } from '../model/product/types.js';

/** 表示名を引く帳面。 */
export interface LabelBook {
  /** 操作 ID(`{集約}.{イベント}`)の表示名。 */
  readonly operation: (id: string) => string | undefined;
  /** 状態 ID の表示名(集約ごと)。 */
  readonly state: (aggregate: string, id: string) => string | undefined;
  /** ロール ID の表示名。 */
  readonly role: (id: string) => string | undefined;
}

/** 表示名を綴りで拾うための export 名の形(1 つ目の捕獲は集約の綴り)。 */
const STATE_LABELS = /(\w+)StateLabels/;

/** 同上(イベント側)。 */
const EVENT_LABELS = /(\w+)EventLabels/;

/** オブジェクトの値のうち、文字列のものだけを鍵つきで取り出す。 */
function stringEntries(value: PlainValue): readonly (readonly [string, string])[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

/** 1 ファイルぶんの表示名を帳面へ写す(既にある語は上書きしない = 先に読んだ版が勝つ)。 */
function absorb(into: Map<string, string>, prefix: string, source: string, name: string): void {
  const read = readExportedValue(source, name);
  if (!read.ok) return;
  for (const [key, label] of stringEntries(read.value)) {
    const full = `${prefix}${key}`;
    if (!into.has(full)) into.set(full, label);
  }
}

/** 表示名を持つ export を綴りで探し、集約の綴りごとに写す。 */
function absorbByPattern(into: Map<string, string>, stem: string, source: string, pattern: RegExp): void {
  for (const found of exportedNames(source, pattern)) {
    absorb(into, `${stem}.`, source, found.name);
  }
}

/**
 * 表示名の帳面を組み立てる。
 *
 * @param snapshots 版の写し(先に渡したものが優先。通常は head → base の順)
 * @returns 表示名を引く帳面(宣言の無い語は undefined を返す)
 */
export function labelBook(snapshots: readonly SideSnapshot[], roots: ProductRoots): LabelBook {
  const states = new Map<string, string>();
  const events = new Map<string, string>();
  const roles = new Map<string, string>();
  for (const snapshot of snapshots) {
    for (const [path, content] of snapshot) {
      if (content === null) continue;
      if (isLabelsPath(path, roots)) {
        const stem = stemOf(path);
        absorbByPattern(states, stem, content, STATE_LABELS);
        absorbByPattern(events, stem, content, EVENT_LABELS);
        continue;
      }
      if (path === roleLabelsPath(roots)) absorb(roles, '', content, 'ROLE_LABELS');
    }
  }
  return {
    operation: (id: string): string | undefined => events.get(id),
    state: (aggregate: string, id: string): string | undefined => states.get(`${aggregate}.${id}`),
    role: (id: string): string | undefined => roles.get(id),
  };
}

/** 帳面を持たない版(表示名が要らない単体テスト用)。 */
export const NO_LABELS: LabelBook = {
  operation: (): undefined => undefined,
  state: (): undefined => undefined,
  role: (): undefined => undefined,
};
