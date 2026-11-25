/**
 * 設定の章の「ログの目録」(V16.1.1)の生成のテスト。
 *
 * 規約網羅(logging.md / config-spec-writing.md §ログの目録):
 *   - 宣言があるとき、下段に 3 つの折りたたみ(目録の宣言・セキュリティの事象・ログの欄)が出る。宣言が無いときは出ない
 *   - 目録の宣言の表は 形式・どこへ・必須の置き場・設定する場所・保管日数・読める人・検査から見えないこと を持つ
 *   - 事象の表は、実行時の事象の目録(SECURITY_EVENTS)の全数(1 事象 1 行)。欄の表は LOG_FIELDS の全数
 *   - 個人の値を載せないことと、転送先の設定が検査から見えない(未検証)ことを章が言う
 */

import { describe, expect, it } from 'vitest';
import { LOG_FIELDS, SECURITY_EVENTS } from '@kaninabe/runtime/security-log';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { configModel, configVariable, loggingDecl } from '../../../../helpers/config-builder.js';

/** 設定の章(HTML の本)を生成して、ページ(HTML の文書)を返す。 */
function chapterHtml(logging?: ReturnType<typeof loggingDecl>): string {
  const ctx = { ...bookCtx(), config: configModel([configVariable('API_KEY')], true, logging) };
  return bookHtmlPage(bookModel(), ctx, 'config.html') ?? '';
}

/** 設定の章の字。 */
function chapter(logging?: ReturnType<typeof loggingDecl>): string {
  return pageText(chapterHtml(logging));
}

/** 折りたたみの題から、その折りたたみの終わりまでの本文(字)。 */
function foldBody(html: string, title: string): string {
  const start = html.indexOf(`>${title}`);
  if (start < 0) return '';
  const end = html.indexOf('</details>', start);
  return pageText(html.slice(start, end));
}

describe('設定の章: ログの目録', () => {
  it('宣言が無ければ、ログの目録の折りたたみは出ない', () => {
    const content = chapter();
    expect(content).not.toContain('ログの目録(どこへ・誰が読む・何日残す)');
    expect(content).not.toContain('セキュリティの事象(何を記録するか)');
    expect(content).not.toContain('ログの欄(出してよい項目)');
  });

  it('宣言があれば 3 つの折りたたみが出る', () => {
    const content = chapter(loggingDecl());
    for (const title of ['ログの目録(どこへ・誰が読む・何日残す)', 'セキュリティの事象(何を記録するか)', 'ログの欄(出してよい項目)']) {
      expect(content, title).toContain(title);
    }
  });

  it('目録の宣言の表: 形式・どこへ・必須の置き場・設定する場所・保管日数・読める人・検査から見えないこと', () => {
    const body = foldBody(chapterHtml(loggingDecl()), 'ログの目録(どこへ・誰が読む・何日残す)');
    for (const word of ['1 行 1 JSON', 'ログドレイン', 'ホストの外: はい', 'ダッシュボードの設定画面', '90 日(調査に要る期間)', '運用担当', '未検証', 'K5']) {
      expect(body, word).toContain(word);
    }
  });

  it('転送先がホストの中なら「ホストの外: いいえ」と出る(章が嘘を言わない)', () => {
    const decl = loggingDecl({
      sink: { requiredIn: ['ci'], destination: { kind: 'forward', mode: 'host_drain', label: '同居', offHost: false, keyEnv: null, configuredIn: '設定' } },
    });
    expect(foldBody(chapterHtml(decl), 'ログの目録(どこへ・誰が読む・何日残す)')).toContain('ホストの外: いいえ');
  });

  it('アプリから直接送る宣言は、鍵の環境変数名と「鍵があるときだけ」を言う(オプトインが章から読める)', () => {
    const decl = loggingDecl({
      sink: { requiredIn: ['ci'], destination: { kind: 'forward', mode: 'app_direct', label: 'Axiom', offHost: true, keyEnv: 'AXIOM_TOKEN', configuredIn: 'Vercel の環境変数' } },
    });
    const body = foldBody(chapterHtml(decl), 'ログの目録(どこへ・誰が読む・何日残す)');
    for (const word of ['アプリから直接', 'AXIOM_TOKEN', '鍵', 'があるときだけ', 'Axiom', 'Vercel の環境変数']) expect(body, word).toContain(word);
  });

  it('外した宣言は「本番でも送らないと受け入れている」と理由を言い、本番を宣言しない宣言はそう言う', () => {
    const exempt = loggingDecl({
      sink: { requiredIn: ['ci'], destination: { kind: 'exempt', reason: '個人情報を持たない社内ツール', location: { file: 'specs/config.md', pointer: 'logging.sink.exempt' } } },
    });
    expect(foldBody(chapterHtml(exempt), 'ログの目録(どこへ・誰が読む・何日残す)')).toContain('本番でも送らないと受け入れている。理由: 個人情報を持たない社内ツール');
    const none = loggingDecl({ sink: { requiredIn: [], destination: { kind: 'none' } } });
    const body = foldBody(chapterHtml(none), 'ログの目録(どこへ・誰が読む・何日残す)');
    expect(body).toContain('転送先は宣言していない');
    expect(body).toContain('本番を宣言していない');
  });

  it('事象の表は実行時の目録の全数(1 事象 1 行。重大度・出す場所・分類の欄つき)', () => {
    const body = foldBody(chapterHtml(loggingDecl()), 'セキュリティの事象(何を記録するか)');
    for (const event of SECURITY_EVENTS) {
      expect(body, event.id).toContain(event.id);
      expect(body, event.id).toContain(event.summary.replace(/`/g, ''));
    }
    // 見出し行と区切り行を除いた表の行数が、目録の本数と一致する。
    expect(body.split('\n').filter((line) => /^[a-z0-9_.-]+ \|/.test(line))).toHaveLength(SECURITY_EVENTS.length);
    expect(body).toContain('入力値・認証の情報(トークン・cookie)・個人を特定する値・拒否の理由文はどの行にも載らない');
  });

  it('欄の表は LOG_FIELDS の全数で、個人の値を載せる欄が無い', () => {
    const body = foldBody(chapterHtml(loggingDecl()), 'ログの欄(出してよい項目)');
    for (const field of LOG_FIELDS) expect(body, field.name).toContain(field.name);
    expect(body.split('\n').filter((line) => /^[a-z0-9_.-]+ \|/.test(line))).toHaveLength(LOG_FIELDS.length);
    for (const personal of ['email', 'mail', 'token', 'cookie', 'password', 'display_name']) {
      expect(LOG_FIELDS.some((field) => field.name.includes(personal)), personal).toBe(false);
    }
  });

  it('導出の件数の行が、ログの目録の表を数えている', () => {
    expect(chapter(loggingDecl())).toContain('ログの目録・事象・欄の表');
    expect(chapter()).not.toContain('ログの目録・事象・欄の表');
  });
});
