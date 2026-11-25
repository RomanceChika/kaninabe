/**
 * 製品のコードに **CORS の応答ヘッダ(`Access-Control-*`)を書かせない**(OWASP ASVS 5.0 V3.4.2)。
 *
 * アプリは他のオリジンから読ませる API を持たない(画面は同じオリジンで描き、外へ出す API は SQL の公開面だけ)。
 * Route Handler に `Access-Control-Allow-Origin: *` を 1 行足すと、cookie で認証する口の応答を他のサイトのスクリプトが
 * 読めるようになる —— それでも型も検査も緑だった。だから**名前を文字列として書く**こと自体を止める
 * (リテラル・テンプレートの断片・`Headers` の鍵のどれでも。大文字小文字は問わない)。免除の口は作らない ——
 * 開ける必要が出たら、まず仕組みの側に「他のオリジンへ読ませる口」の宣言を設計する。
 */

/** CORS の応答ヘッダの名前(先頭一致。大文字小文字は問わない)。 */
const CORS_HEADER = /^\s*access-control-/i;

/** @type {import("eslint").Rule.RuleModule} */
export const noCorsHeader = {
  meta: {
    type: 'problem',
    docs: {
      description: '製品のコードに CORS の応答ヘッダ(Access-Control-*)を書かせない',
    },
    schema: [],
    messages: {
      cors: 'CORS の応答ヘッダ({{name}})を書かない —— cookie で認証する口の応答を他のサイトのスクリプトに読ませる形になる(ASVS V3.4.2)。他のオリジンへ読ませる口が要るなら、仕組みの側に宣言の口を先に設計する(免除の一覧は無い)。',
    },
  },
  create(context) {
    /**
     * 文字列の値が CORS のヘッダの名前なら報告する。
     *
     * @param {import("estree").Node} node - 報告する位置
     * @param {unknown} value - 文字列の値
     */
    function check(node, value) {
      if (typeof value === 'string' && CORS_HEADER.test(value)) {
        context.report({ node, messageId: 'cors', data: { name: value.trim() } });
      }
    }
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
