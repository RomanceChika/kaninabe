/**
 * HTML の本の新しい形の章(`html/spec-chapter.ts`。集約の章 `spec/{集約}.html` と全体 `spec/index.html`)と、役の印(`spec/chips.ts`)のテスト。
 *
 * 流れ(段の番号・どこからでも出る遷移・自動の判定と理由)、全体の軸の表(規則 × 軸の段。誰が以外が同じ規則は 1 行)、決めごとの表を、書き出した HTML の字で見る。
 */

import { describe, expect, it } from 'vitest';
import { aggregateChapter, overviewChapter, type ChapterNames, type OverviewNames } from '../../../../../lib/generate/render/book/html/spec-chapter.js';
import { text } from '../../../../../lib/generate/render/book/html/markup.js';
import { roleChips } from '../../../../../lib/generate/render/book/spec/chips.js';
import { SPEC_LEAD } from '../../../../../lib/generate/render/book/spec-page.js';
import { aggregateAccessFacts } from '../../../../../lib/semantics/spec-book/access-facts.js';
import { collectEventOrigins } from '../../../../../lib/semantics/spec-book/event-origins.js';
import type { InvariantFact } from '../../../../../lib/semantics/spec-book/invariant-facts.js';
import { allLifecycleFacts, lifecycleFacts } from '../../../../../lib/semantics/spec-book/lifecycle-facts.js';
import { lifecycleAxes } from '../../../../../lib/semantics/spec-book/lifecycle-followers.js';
import type { SpecModel } from '../../../../../lib/model/types.js';
import { pageText } from '../../../../helpers/book-html.js';
import { scheduledJob } from '../../../../helpers/job-builder.js';
import { accessSpec, aggregate, create, entitySpec, event, field, machine, roleSpec, specModel } from '../../../../helpers/model-builder.js';

const flow = machine('flow', {
  states: ['draft', 'open', 'done', 'dropped'],
  initial: 'draft',
  final: ['done', 'dropped'],
  stateLabels: { draft: '下書き', open: '受付中', done: '終了', dropped: '取りやめ' },
  stateTone: { dropped: 'negative' },
  events: [
    event('publish', { from: ['draft'], to: 'open', by: ['host'], label: '公開する' }),
    event('close', { from: ['open'], to: 'done', by: ['system'], label: '閉じる' }),
    event('wrap', { from: ['open'], to: 'done', by: ['system'], label: '片付ける' }),
    event('drop', { from: ['draft', 'open'], to: 'dropped', by: ['host'], label: 'やめる' }),
  ],
});

const chapterNames: ChapterNames = { role: (role) => text(role === 'host' ? '主催' : role), field: (name) => name, entity: (name) => name };

/** 集約 `thing` の章(流れ・決めごとを差し替えられる)。 */
function thingChapter(rules: readonly InvariantFact[] = []): { readonly body: string; readonly text: string } {
  const model = specModel([aggregate('thing', { stateMachines: [flow] })], roleSpec(['system', 'host']));
  const origins = collectEventOrigins(model, { jobs: [scheduledJob('close_due', { fires: 'flow.close' })], auth: null, integrations: [], unread: [] });
  const facts = lifecycleFacts(model, 'thing', flow, origins, new Map([['flow.wrap', 'まだ自動にしていない']]));
  const chapter = aggregateChapter('題', SPEC_LEAD, [facts], aggregateAccessFacts(model, 'thing'), rules, chapterNames);
  return { body: chapter.body, text: pageText(chapter.body) };
}

describe('aggregateChapter: 流れ', () => {
  const { body, text: flowText } = thingChapter();

  it('本筋の段の番号を段の印に出す(否定的な状態には付けない)', () => {
    expect(flowText).toContain('1/3下書き');
    expect(flowText).toContain('2/3受付中');
    expect(flowText).toContain('3/3終了');
    expect(body).toMatch(/bf-state--negative[^>]*>取りやめ</);
    expect(flowText).not.toMatch(/\d\/3取りやめ/);
    expect(body).toMatch(/bf-state--done bf-state--final/);
  });

  it('どこからでも出る遷移は図の線にせず、表の下の 1 行に書く', () => {
    expect(flowText).toContain('終点以外のどの段からでも');
    expect(flowText).toMatch(/やめる \| 終点以外のどの段からでも \| 取りやめ \| 主催/);
    expect(flowText).toContain('「やめる」');
  });

  it('自動の判定と起こす処理を遷移の表に出し、自動と書けない遷移に理由を添える', () => {
    expect(flowText).toContain('公開する | 1/3下書き | 2/3受付中 | 主催 | 人が起こす');
    expect(flowText).toContain('閉じる | 2/3受付中 | 3/3終了 | system | 自動 | 時刻のジョブ close_due');
    expect(flowText).toContain('「片付ける」は自動と書けない。理由: まだ自動にしていない');
  });
});

describe('aggregateChapter: 決めごと', () => {
  const source = { file: 'x', pointer: 'invariants.I-1' };
  const rules: InvariantFact[] = [
    { id: 'I-1', aggregate: 'thing', statement: '始まりは終わりより前', formal: 'check', fields: ['thing.start', 'thing.end'], enforcedBy: [{ kind: 'db_constraint', ref: 'thing_order' }], categories: [], source },
    { id: 'I-2', aggregate: 'thing', statement: '払う前に数を締める', fields: [], enforcedBy: [{ kind: 'guard', ref: 'flow.pay' }], categories: ['settle-compute', 'into-final'], source },
  ];

  it('文・形式定義・ふれる欄・守る場所を仕様の名前のまま出す', () => {
    expect(thingChapter(rules).text).toContain('I-1 | 始まりは終わりより前 | check | thing.start thing.end | db_constraint: thing_order');
  });

  it('形式定義の無い決めごとは「文だけ」と書き、構造の種類を語にする(意味は言い切らない)', () => {
    const row = thingChapter(rules).text.split('\n').find((line) => line.startsWith('I-2 |')) ?? '';

    expect(row).toContain('I-2 | 払う前に数を締める | 文だけ | | guard: flow.pay |');
    expect(row).toContain('計算・確定に関係');
    expect(row).toContain('終点へ入る遷移に関係');
  });

  it('決めごとが無ければ 1 行で言う', () => {
    expect(thingChapter([]).text).toContain('この集約に宣言された決めごとは無い。');
  });

  it('仕様の文字列は字として逃がされる', () => {
    const hostile = [{ ...rules[0]!, statement: '<img src=x onerror=alert(1)>' }];

    expect(thingChapter(hostile).body).not.toContain('<img');
  });
});

describe('overviewChapter', () => {
  /** 状態機械 1 本を持つ集約(状態の欄つき)。 */
  function owner(name: string): ReturnType<typeof aggregate> {
    return aggregate(name, {
      entity: entitySpec(name, { fields: [field('state', { kind: 'state', machine: `${name}_flow` })] }),
      stateMachines: [
        machine(`${name}_flow`, {
          states: ['open', 'done'],
          initial: 'open',
          final: ['done'],
          stateLabels: { open: '受付', done: '終わり' },
          events: [event('finish', { from: ['open'], to: 'done', by: ['host'] })],
        }),
      ],
    });
  }

  /** 親の状態を作成の条件で読む子(by の役を 2 つ別の規則で書く)。 */
  function child(name: string, parent: string): ReturnType<typeof aggregate> {
    return aggregate(name, {
      entity: entitySpec(name, { fields: [field(`${parent}_id`, { kind: 'ref', entity: parent })] }),
      access: accessSpec(name, { creates: [create('host', `${parent}.state == open`), create('staff', `${parent}.state == open`)] }),
    });
  }

  const names: OverviewNames = { aggregate: (id) => id, role: (id) => text(id), chapter: (id) => `./${id}.html` };

  function render(model: SpecModel): { readonly body: string; readonly text: string; readonly headings: readonly string[] } {
    const origins = collectEventOrigins(model, { jobs: [], auth: null, integrations: [], unread: [] });
    const chapter = overviewChapter(lifecycleAxes(model), allLifecycleFacts(model, origins, new Map()), names);
    return { body: chapter.body, text: pageText(chapter.body), headings: chapter.headings.map((heading) => heading.id) };
  }

  it('軸が 1 本なら、ほかの集約の規則 × 軸の段の表を出す(誰が以外が同じ規則は 1 行)', () => {
    const { body, text: out, headings } = render(specModel([owner('a'), child('a_part', 'a'), owner('b')]));

    expect(headings).toContain('axis-a-a_flow');
    expect(out).toContain('aの a_flow');
    expect(out).toMatch(/集約 \| 規則 \| 誰が \| 1\/2受付 \| 2\/2終わり/);
    expect(out).toContain('a_part | 作る |');
    expect(out).toContain('✓');
    // 誰が以外が同じ規則(host と staff の 2 つの作成)は 1 行に束ねる。
    expect(body).toContain('>host<');
    expect(body).toContain('>staff<');
    expect(out.match(/a_part \| 作る/g)).toHaveLength(1);
    expect(headings.some((id) => id.startsWith('axis-b'))).toBe(false);
    expect(out).toContain('b | b_flow | 受付、終わり | 0');
  });

  it('軸が無ければ軸の表を出さず、一覧だけで読ませる', () => {
    const { text: out, headings } = render(specModel([owner('a'), owner('b')]));

    expect(out).toContain('ほかの集約が状態を条件で読む流れが無いので、軸を置かない。');
    expect(headings.some((id) => id.startsWith('axis-'))).toBe(false);
    expect(out).toContain('a | a_flow');
  });

  it('従う集約の数が同じなら、1 本に寄せずに並べる', () => {
    const { text: out, headings } = render(specModel([owner('a'), child('a_part', 'a'), owner('b'), child('b_part', 'b')]));

    expect(out).toContain('従う集約の数が同じ流れが 2 本あるので、1 本に寄せずに並べる。');
    expect(headings).toEqual(expect.arrayContaining(['axis-a-a_flow', 'axis-b-b_flow']));
  });

  it('集約の一覧は章へのリンクになる', () => {
    expect(render(specModel([owner('a'), owner('b')])).body).toContain('href="./a.html"');
  });
});

describe('roleChips', () => {
  it('形の種類と出番の少ない役の印を役の事実から決め、名前は逃がす', () => {
    const chip = roleChips(
      [
        { id: 'host', label: '主<催>', roleClass: 'relation', implies: [], declaredOperations: 20 },
        { id: 'member', label: 'メンバー', roleClass: 'global', implies: [], declaredOperations: 1 },
        { id: 'system', label: 'システム', roleClass: 'system', implies: [], declaredOperations: 1 },
        { id: 'anonymous', label: '未ログイン', roleClass: 'anonymous', implies: [], declaredOperations: 1 },
      ],
      'system',
    );

    expect(chip('host')).toBe('<span class="bf-rl bf-rl--relation">主&lt;催&gt;</span>');
    expect(chip('member')).toBe('<span class="bf-rl bf-rl--global bf-rl--minor">メンバー</span>');
    expect(chip('system')).toBe('<span class="bf-rl bf-rl--internal">システム</span>');
    expect(chip('anonymous')).toBe('<span class="bf-rl bf-rl--internal bf-rl--minor">未ログイン</span>');
    expect(chip('nobody')).toBe('<span class="bf-rl">nobody</span>');
  });
});
