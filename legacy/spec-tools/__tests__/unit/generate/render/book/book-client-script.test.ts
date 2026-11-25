/**
 * 本の script(`assets/book.js`)の約束を、**字面の閉じた表**で固定する(点検 13 回目 C13-1)。
 *
 * script は文字列なので lint が届かない。検索の結果は `search.json` の仕様の字を生のまま持つので、`textContent` が唯一の止めである。
 * 禁止の語を並べず、script が使うメンバーと自由な名前の全部を表に閉じる(`innerHTML` も `document.write` も `location.hash` も `eval` も表に無いので赤)。
 * 新しい DOM の API を使うときは、表に足す判断をする。
 */

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BOOK_CLIENT_SCRIPT } from '../../../../../lib/generate/render/book/html/client-script.js';
import { reservedName } from '../../../../../lib/kernel/html-allow-list.js';

/** script が読み書きするメンバーの全部。 */
const MEMBERS: readonly string[] = [
  'addEventListener', 'altKey', 'appendChild', 'autocomplete', 'children', 'className', 'classList', 'concat', 'call', 'contains', 'createElement', 'ctrlKey', 'documentElement', 'every', 'filter', 'firstChild', 'focus',
  'forEach', 'getAttribute', 'getItem', 'hasAttribute', 'heading', 'hidden', 'href', 'id', 'indexOf', 'insertBefore', 'isArray', 'isComposing', 'isContentEditable', 'item', 'json', 'key', 'length', 'localStorage', 'location',
  'map', 'matchMedia', 'matches', 'max', 'metaKey', 'ok', 'open', 'page', 'preventDefault', 'prototype', 'push', 'querySelector', 'querySelectorAll', 'removeAttribute', 'removeChild', 'scrollIntoView', 'setAttribute', 'setItem',
  'slice', 'split', 'tabIndex', 'tagName', 'target', 'terms', 'text', 'textContent', 'then', 'toggle', 'toLowerCase', 'trim', 'type', 'value', 'add', 'has', 'catch',
];

/** script が定義せずに読む名前の全部。 */
const GLOBALS: readonly string[] = ['Array', 'Error', 'Math', 'WeakSet', 'document', 'fetch', 'window'];

/** `document` から引く名前(`<img name=…>` で潰されると `book.js` が止まるので、全部が予約された名前であること)。 */
const DOCUMENT_MEMBERS: readonly string[] = ['addEventListener', 'createElement', 'documentElement', 'querySelector', 'querySelectorAll'];

/** `setAttribute` の第 1 引数の全部(`href` / `src` / `style` / `on*` を置かない)。 */
const SET_ATTRIBUTES: readonly string[] = ['aria-activedescendant', 'aria-autocomplete', 'aria-controls', 'aria-expanded', 'aria-label', 'aria-pressed', 'aria-selected', 'placeholder', 'role'];

/** リンクの先の代入の全部(索引の href は必ず本の根の前置きを付ける)。 */
const NAVIGATIONS: readonly string[] = ['link.href = base + found.item.href', 'window.location.href = base + found.item.href'];

/** 添字で読む相手の全部(`window[…]` のような計算した鍵を置かない)。 */
const INDEXED: readonly string[] = ['index', 'items', 'shown', 'terms'];

/** script の構文木の事実。 */
function scriptFacts(script: string) {
  const file = ts.createSourceFile('book.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const members = new Set<string>();
  const documentMembers = new Set<string>();
  const declared = new Set<string>();
  const used = new Set<string>();
  const setAttributes = new Set<string>();
  const navigations = new Set<string>();
  const indexed = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      members.add(node.name.text);
      if (node.expression.getText(file) === 'document') documentMembers.add(node.name.text);
    }
    if (ts.isElementAccessExpression(node)) indexed.add(node.expression.getText(file));
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isParameter(node)) && node.name !== undefined && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) declared.add(node.variableDeclaration.name.getText(file));
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isName) used.add(node.text);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setAttribute') setAttributes.add(node.arguments[0]?.getText(file).slice(1, -1) ?? '');
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText(file).endsWith('.href')) navigations.add(node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { members, documentMembers, globals: new Set([...used].filter((name) => !declared.has(name))), setAttributes, navigations, indexed };
}

const sorted = (values: Iterable<string>): readonly string[] => [...values].sort();

describe('book.js の閉じた表', () => {
  const facts = scriptFacts(BOOK_CLIENT_SCRIPT);

  it('メンバーは表のとおり(両方向)', () => {
    expect(sorted(facts.members)).toEqual(sorted(MEMBERS));
  });

  it('定義せずに読む名前は表のとおり', () => {
    expect(sorted(facts.globals)).toEqual(sorted(GLOBALS));
  });

  it('`document` から引く名前は全部が予約された名前(断片の `name` で潰せない)', () => {
    expect(sorted(facts.documentMembers)).toEqual(sorted(DOCUMENT_MEMBERS));
    expect(DOCUMENT_MEMBERS.filter((name) => !reservedName(name))).toEqual([]);
  });

  it('setAttribute の名前は表のとおり', () => {
    expect(sorted(facts.setAttributes)).toEqual(sorted(SET_ATTRIBUTES));
  });

  it('リンクの先はちょうどこの代入だけ', () => {
    expect(sorted(facts.navigations)).toEqual(sorted(NAVIGATIONS));
  });

  it('添字で読む相手は表のとおり', () => {
    expect(sorted(facts.indexed)).toEqual(sorted(INDEXED));
  });

  // 点検の変異を文字列で当てて、表が赤になることを見る。
  it.each([
    ['検索の結果を innerHTML に', 'page.textContent = found.item.page;', 'page.innerHTML = found.item.page;', 'members'],
    ['検索の断片を innerHTML に', 'text.textContent = excerpt;', 'text.innerHTML = excerpt;', 'members'],
    ['outerHTML', 'text.textContent = excerpt;', 'text.outerHTML = excerpt;', 'members'],
    ['insertAdjacentHTML', 'text.textContent = excerpt;', "text.insertAdjacentHTML('beforeend', excerpt);", 'members'],
    ['document.write', 'var root = document.documentElement;', 'var root = document.documentElement; document.write(decodeURIComponent(location.hash));', 'members'],
    ['eval', 'var root = document.documentElement;', 'var root = document.documentElement; eval(excerpt);', 'globals'],
    ['new Function', 'var root = document.documentElement;', "var root = document.documentElement; new Function('x');", 'globals'],
    ['setTimeout', 'var root = document.documentElement;', "var root = document.documentElement; setTimeout('x');", 'globals'],
    ['href を setAttribute で', "link.className = 'bf-search-link';", "link.setAttribute('href', found.item.href);", 'setAttributes'],
    ['索引の href の前置きを外す', 'link.href = base + found.item.href;', 'link.href = found.item.href;', 'navigations'],
    ['window を鍵で引く', 'var root = document.documentElement;', "var root = document.documentElement; window['ev' + 'al']('1');", 'indexed'],
  ] as const)('%s は赤', (_name, before, after, table) => {
    expect(BOOK_CLIENT_SCRIPT).toContain(before);
    const mutated = scriptFacts(BOOK_CLIENT_SCRIPT.replace(before, after));
    expect(sorted(mutated[table])).not.toEqual(sorted(facts[table]));
  });
});
