/**
 * 「誰に何が見えるか」の章(render/book/visibility-page.ts)のテスト。
 *
 * 全エンティティ × 全ロールの一覧(system 除外・⚠・依存 query の逆引き)と、
 * 読み取り経路の一覧(via の借用表記・返し方)を検める。
 */

import { describe, expect, it } from 'vitest';

import { bookHtmlGenerator } from '../../../../../lib/generate/render/book/html/generator.js';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import { GEN_CTX, genContextWithQueries } from '../../../../helpers/generate-context.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { aggregate, entitySpec, field, role, specModel } from '../../../../helpers/model-builder-v8plus.js';
import { querySpec } from '../../../../helpers/query-builder.js';

function contentOf(model: ReturnType<typeof bookModel>, ctx: ReturnType<typeof bookCtx>): string {
  const page = bookHtmlPage(model, ctx, 'visibility.html');
  if (page === undefined) throw new Error('ページが生成されませんでした');
  return pageText(page);
}

function content(ctx = bookCtx()): string {
  return contentOf(bookModel(), ctx);
}

describe('可視性の章(HTML): 出力先と骨格', () => {
  it('docs/book/visibility.html をファイル全体(wholeFile)で生成する', () => {
    const sections = bookHtmlGenerator.generate(bookModel(), bookCtx()).filter((section) => section.file === 'docs/book/visibility.html');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.wholeFile).toBe(true);
  });
});

describe('可視性の章(HTML): 可視性の一覧', () => {
  it('none の行も含む全ロール分を出し、scope: all に ⚠ を付け、system は除外する', () => {
    const text = content();

    expect(text).toContain('workshop | member | 全件(all) ⚠ | —');
    expect(text).toContain('workshop | anonymous | 見えない(none) | — | —');
    expect(text).not.toContain('workshop | system |');
  });

  it('依存 query の逆引きが最右列に載る(併読側の規則は access-view のテストが持つ)', () => {
    const text = content();

    expect(text).toMatch(/workshop \| member \|[^\n]*workshop_list, workshop_detail/);
  });
});

describe('可視性の章(HTML): 個人データ(消去の対象)', () => {
  it('personal: true の列だけを、テーブル名・表示名併記・placeholder とともに出す', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'member',
          entity: entitySpec('member', [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('display_name', { kind: 'string' }, {
              required: true,
              label: '表示名',
              personal: true,
              personalPlaceholder: '(消去済み)',
            }),
            field('bio', { kind: 'text' }, { personal: true, personalPlaceholder: null }),
          ]),
        }),
      ],
    });

    const text = contentOf(domain, bookCtx());

    expect(text).toContain('個人データ(消去の対象)');
    expect(text).toContain('members | display_name(表示名) | (消去済み)');
    expect(text).toContain('members | bio | null');
    expect(text).not.toContain('members | id |');
  });

  it('personal な列を 1 つも持たなければ節ごと出さない', () => {
    const text = content();

    expect(text).not.toContain('個人データ(消去の対象)');
  });
});

describe('可視性の章(HTML): 読み取り経路の一覧', () => {
  it('query ごとに for / via / スコープ / 返し方(paging 込み)を出す', () => {
    const text = content();

    expect(text).toContain('workshop_list | workshop | member | — | all | many / none');
    expect(text).toContain('workshop_detail | workshop | member | — | all | one');
  });

  it('query_spec を読めていない環境では経路の節ごと出さない', () => {
    const text = content(GEN_CTX);

    expect(text).not.toMatch(/^workshop_list \|/m);
  });
});

describe('可視性の章(HTML): 索引', () => {
  it('filters・via のスコープ条件・sort から導いた索引候補を query → テーブル → 列の形で出す', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'item',
          entity: entitySpec('item', [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('organizer_id', { kind: 'ref', entity: 'member' }),
            field('starts_at', { kind: 'datetime' }),
          ]),
        }),
      ],
      roles: [role('member'), role('organizer', 'item.organizer_id == actor.id', ['member'])],
    });
    const ctx = genContextWithQueries([
      querySpec({
        name: 'item_my_list',
        source: 'item',
        for: ['member'],
        via: 'organizer',
        scopeUsed: 'own',
        sort: [{ field: 'starts_at' }, { field: 'id' }],
      }),
    ]);

    const text = pageText(bookHtmlPage(domain, ctx, 'visibility.html') ?? '');

    expect(text).toContain('索引');
    expect(text).toContain('item_my_list | items | (organizer_id, starts_at, id)');
  });

  it('索引候補が 1 つも無ければ節ごと出さない', () => {
    const text = content();

    expect(text).not.toMatch(/\| \(organizer_id/);
    expect(text).not.toMatch(/^索引/m);
  });
});

describe('可視性の章(HTML): ロールと外から届く surface の標識(これまで章が無く落ちていたもの)', () => {
  const sources = (extra: ReadonlyArray<readonly [string, string]>): ReturnType<typeof bookCtx> => {
    const base = bookCtx();
    return { ...base, specSources: new Map([...(base.specSources ?? []), ...extra]) };
  };
  const doc = (docType: string, sign: string): string => ['---', `doc_type: ${docType}`, '---', '', sign, ''].join('\n');

  it('roles.md と surface.md の標識を、それぞれの節に出典リンクと本数つきで引用する', () => {
    const text = content(
      sources([
        ['docs/specs/domain/roles.md', doc('role_spec', '- 上位の管理者ロールは作らない。')],
        ['docs/specs/backend/surface.md', doc('surface_spec', '外の口が読むのは公開スキーマである。')],
      ]),
    );

    expect(text).toContain('標識 1 本 — domain/roles.md');
    expect(text).toContain('- 上位の管理者ロールは作らない。');
    expect(text).toContain('標識 1 本 — backend/surface.md');
    expect(text).toContain('外の口が読むのは公開スキーマである。');
  });

  it('標識が無ければ標識の折りたたみを出さない(空の折りたたみを作らない)', () => {
    const text = content();

    expect(text).not.toContain('標識 1 本 — domain/roles.md');
    expect(text).not.toContain('標識 1 本 — backend/surface.md');
  });
});
