/**
 * 実装の木(アプリのコード)が **生の HTML を DOM に載せる口と、Markdown / HTML を自前で解く部品を使わない**(ASVS V1.3.1・V1.3.5)。
 *
 * 書式つきの本文(`format: markdown` の欄)を HTML にして画面に載せる口は、実行時パッケージの 1 か所だけにある
 * (`@kaninabe/runtime/markdown` の `renderMarkdown` = 許可リストで無害化 / `@kaninabe/runtime/markdown-view` の `MarkdownView` = それを載せる唯一の部品)。
 * アプリのコードが `dangerouslySetInnerHTML` や `innerHTML` で文字列を差し込むと、その関門を通らない HTML が画面に載る。
 * 自前で Markdown を解く部品(`unified`・`remark-*`・`rehype-*`・`marked` など)や、別の無害化部品(`dompurify`・`sanitize-html`)を
 * アプリで組み合わせることも、関門を 2 つに増やして片方を弱くする入口なので止める。**免除の口は作らない**(`no-eslint-disable-comment` が止める)。
 *
 * 止めるもの:
 *   - `dangerouslySetInnerHTML`(JSX の属性・オブジェクトのキー・メンバー参照・分割代入。計算キーの文字列リテラルも)
 *   - 素の要素への属性の展開(`<div {...attrs} />`・`createElement('div', attrs)`)。鍵が値の側にあるので、JSON から来た `dangerouslySetInnerHTML` を見られない(点検 13 回目 B13-3)。
 *     製品の木に使い手は 0 件で、許す形を作らない。部品(大文字)への展開は通す
 *   - `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `createContextualFragment` / `setHTMLUnsafe` / `parseHTMLUnsafe`(同じ形)
 *   - `srcDoc` / `srcdoc`(iframe に HTML を埋め込む口)
 *   - `document.write` / `document.writeln`
 *   - 上の「自前で解く / 別の無害化」部品の import(静的・動的・`require`)
 * 静的に決まらない計算キー(`el[name]`)は見えない(下限として残る)。
 */

/** 生の HTML を載せる口になる名前。 */
const RAW_HTML_NAMES = new Set([
  'dangerouslySetInnerHTML',
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'createContextualFragment',
  'setHTMLUnsafe',
  'parseHTMLUnsafe',
  'srcDoc',
  'srcdoc',
]);

/** `document.` の後ろに置くと HTML を差し込む口になる名前。 */
const DOCUMENT_WRITERS = new Set(['write', 'writeln']);

/** アプリで使わせない部品(Markdown / HTML を自前で解く・別の無害化)。 */
const BANNED_MODULES =
  /^(?:unified|remark|rehype|marked|markdown-it|showdown|snarkdown|micromark|react-markdown|html-react-parser|dompurify|isomorphic-dompurify|sanitize-html|(?:remark|rehype|mdast-util|hast-util|micromark-extension)-[\w-]+)(?:\/.*)?$/u;

/**
 * 静的に決まる名前を取り出す(識別子・文字列リテラル)。
 *
 * @param {import("estree").Node | null | undefined} node - キーやプロパティの節
 * @param {boolean} computed - 計算キーか(計算キーの識別子は変数なので名前にならない)
 * @returns {string | null} 名前。決まらなければ null
 */
function staticName(node, computed) {
  if (node === null || node === undefined) return null;
  if (node.type === 'Identifier' && !computed) return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked ?? null;
  }
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
export const noRawHtml = {
  meta: {
    type: 'problem',
    docs: {
      description: '生の HTML を DOM に載せる口(dangerouslySetInnerHTML など)と、Markdown を自前で解く部品をアプリで使わせない',
    },
    schema: [],
    messages: {
      rawHtml:
        '`{{name}}` で生の HTML を DOM に載せてはいけません。書式つきの本文(`format: markdown` の欄)は `@kaninabe/runtime/markdown-view` の `MarkdownView` で描く(許可リストで無害化した HTML だけを載せる唯一の口。ASVS V1.3.1・V1.3.5)。',
      spread: '素の要素 `<{{name}}>` に属性を展開してはいけません。鍵が値の側にあるので `dangerouslySetInnerHTML` を見られない。属性は 1 つずつ書く。',
      documentWrite: '`document.{{name}}` で HTML を差し込んではいけません。画面は React の要素で描く(書式つきの本文は `MarkdownView`)。',
      bannedModule:
        '`{{name}}` はアプリで使えません。Markdown の描画と HTML の無害化は `@kaninabe/runtime/markdown`(`renderMarkdown`)/ `@kaninabe/runtime/markdown-view`(`MarkdownView`)の 1 か所に集めてある(関門を 2 つに増やさない)。',
    },
  },
  create(context) {
    /**
     * 名前が生の HTML の口なら報告する。
     *
     * @param {import("estree").Node} node - 報告の位置
     * @param {string | null} name - 静的に決まった名前
     * @returns {void}
     */
    function checkName(node, name) {
      if (name !== null && RAW_HTML_NAMES.has(name)) context.report({ node, messageId: 'rawHtml', data: { name } });
    }

    /**
     * 読み込む部品の名前が禁止の部品なら報告する。
     *
     * @param {import("estree").Node} node - 報告の位置
     * @param {import("estree").Node | null | undefined} source - 読み込み先の節
     * @returns {void}
     */
    function checkModule(node, source) {
      const name = staticName(source, false);
      if (name !== null && BANNED_MODULES.test(name)) context.report({ node, messageId: 'bannedModule', data: { name } });
    }

    return {
      JSXSpreadAttribute(node) {
        const name = node.parent.name;
        if (name.type === 'JSXIdentifier' && /^[a-z]/u.test(name.name)) context.report({ node, messageId: 'spread', data: { name: name.name } });
      },
      JSXAttribute(node) {
        if (node.name.type === 'JSXIdentifier') checkName(node, node.name.name);
      },
      Property(node) {
        checkName(node, staticName(node.key, node.computed));
      },
      MemberExpression(node) {
        const name = staticName(node.property, node.computed);
        checkName(node, name);
        if (
          name !== null &&
          DOCUMENT_WRITERS.has(name) &&
          node.object.type === 'Identifier' &&
          node.object.name === 'document'
        ) {
          context.report({ node, messageId: 'documentWrite', data: { name } });
        }
      },
      ImportDeclaration(node) {
        checkModule(node, node.source);
      },
      ImportExpression(node) {
        checkModule(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null && node.source !== undefined) checkModule(node, node.source);
      },
      ExportAllDeclaration(node) {
        checkModule(node, node.source);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0] !== undefined) {
          checkModule(node, node.arguments[0]);
        }
        const element = staticName(node.arguments[0], true);
        const props = node.arguments[1];
        const calleeName = node.callee.type === 'Identifier' ? node.callee.name : staticName(node.callee.property, node.callee.computed);
        if (calleeName === 'createElement' && element !== null && /^[a-z]/u.test(element) && props !== undefined) {
          const closed = props.type === 'ObjectExpression' ? props.properties.every((property) => property.type === 'Property') : props.type === 'Literal';
          if (!closed) context.report({ node, messageId: 'spread', data: { name: element } });
        }
      },
    };
  },
};
