/**
 * HTML の本の集約の章(`html/aggregate-chapter.ts`)の、章の事実と構造の保証のテスト。
 *
 * Markdown の本の章(face-page ほか)が持っていた保証を、書き出した HTML の字・要素で見る: 章の骨格、読む量の 4 枚 = 本文の項目 = 数の出どころの一致、
 * 計算の早見表、読むの ⚠ の句、遷移ガードと関係する公理(宿り先の章へのリンク)、行の見え方と隠す欄、ライフサイクルの図、構造の規則(読み方の印・見出しの深さ・
 * ラベルの語・既定で開く数・1 つの折りたたみに表と図は 1 枚)とそれを壊したときの落ち方、標識の置き場。
 * 小さな世界は `face-fixture`。本番の仕様の全数は dev-repo のテスト(生成物の HTML)が見る。
 */

import { describe, expect, it } from 'vitest';
import type { GenerateContext } from '../../../../../lib/gen-kit/generator.js';
import type { InvariantDef, ReadRule, SpecModel } from '../../../../../lib/model/types.js';
import type { ActionComputeExample, ComputeExampleValue } from '../../../../../lib/model/trace/types.js';
import { domainChapter } from '../../../../../lib/generate/render/book/html/aggregate-chapter.js';
import { faceFacts } from '../../../../../lib/generate/render/book/face-facts.js';
import { FACE_LABELS, HANDS_HEADING, NOT_WRITTEN } from '../../../../../lib/generate/render/book/face-html.js';
import { readingTotals } from '../../../../../lib/generate/render/book/face-totals.js';
import { gapTotal, summaryGapsOf } from '../../../../../lib/generate/render/book/summary-gaps.js';
import { collectEventOrigins } from '../../../../../lib/semantics/spec-book/event-origins.js';
import { allLifecycleFacts } from '../../../../../lib/semantics/spec-book/lifecycle-facts.js';
import { pageText } from '../../../../helpers/book-html.js';
import { faceCtx, faceCtxWithFindings, faceModel } from '../../../../helpers/face-fixture.js';
import { jobModel, outboxJob } from '../../../../helpers/job-builder.js';
import { loc, read } from '../../../../helpers/model-builder.js';
import { actionSpec } from '../../../../helpers/trace-builder.js';

/** 章の HTML(状態機械の流れの図つき。本の生成器と同じ引き方)。 */
function chapterOf(model: SpecModel, ctx: GenerateContext, name = 'workshop'): string {
  const origins = collectEventOrigins(model, { jobs: [], auth: null, integrations: [], unread: [] });
  const flows = allLifecycleFacts(model, origins, new Map());
  const chapter = domainChapter(model, ctx, name, (aggregate, machine) => flows.find((facts) => facts.aggregate === aggregate && facts.machine === machine));
  if (chapter === null) throw new Error(`章が組めない: ${name}`);
  return chapter.body;
}

/** `<hN id="id">` から、次の同じ深さ以下の見出しの手前まで。 */
function section(html: string, id: string): string {
  const open = new RegExp(`<h([23]) id="${id}">`).exec(html);
  if (open === null) throw new Error(`見出しが無い: ${id}`);
  const start = open.index;
  const depth = Number(open[1]);
  const rest = html.slice(start + open[0].length);
  const next = rest.search(depth === 2 ? /<h2 id=/ : /<h[23] id=/);
  return next === -1 ? html.slice(start) : html.slice(start, start + open[0].length + next);
}

/** 読む量の 4 枚(id → 値の字)。 */
function cards(html: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of html.matchAll(/<div class="bf-cell"[^>]*data-cell="([a-z]+)">[\s\S]*?<div class="bf-cell-v">([\s\S]*?)<\/div>/g)) found.set(match[1] ?? '', pageText(match[2] ?? ''));
  return found;
}

/** 公理の行の id(1 行に複数の id を持つ短い形の行は、行ごとに数えず id を全部返す)。 */
function axiomIds(html: string): string[] {
  return [...html.matchAll(/<div class="bf-axiom"(?: id="[^"]*")?><div class="bf-id">([^<]*?) <span class="bf-mark/g)].flatMap((match) => (match[1] ?? '').split(' / ').map((id) => id.trim()));
}

const model = faceModel();
const ctx = faceCtx();
const workshop = model.aggregates.get('workshop')!;
const chapter = chapterOf(model, ctx);
const text = pageText(chapter);
const withFindings = chapterOf(model, faceCtxWithFindings());

describe('章の骨格(章頭 → 上段 → 下段 → 数の出どころ)', () => {
  it('章の題が先頭にあり、読む量の 4 枚が 必読・変更・受け入れ・参照 の順に並ぶ', () => {
    expect(chapter.startsWith('<h1>集約 workshop(催し)</h1>')).toBe(true);
    expect([...cards(chapter).keys()]).toEqual(['axiom', 'changed', 'acceptance', 'derive']);
  });

  it('節の順は 前提の語 → 凡例 → 上段(公理)→ 下段(導出)→ 数の出どころ', () => {
    const order = ['terms', 'legend', 'upper', 'lower', 'origin'].map((id) => chapter.indexOf(`<h2 id="${id}">`));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('パンくずは重さの順位を出す(製品の名前は宣言から)', () => {
    expect(text).toContain('ハンドブック · ドメインの章 · 重さは 5 章中の 1 位');
  });

  it('人が書く 1 文は無いので「(まだ書かれていない)」と出す(黙って空にしない)', () => {
    expect(chapter).toContain(`<p class="bf-prose bf-lede"><span class="bf-none">${NOT_WRITTEN}</span></p>`);
  });

  it('章頭は 誰が(内部実行を除く、日本語名つき)・状態(機械ごとの段の数)・原本 をラベル行で出す', () => {
    const head = chapter.slice(0, chapter.indexOf('<div class="bf-grid"'));

    expect(head).toContain('<div class="bf-k">誰が</div>');
    expect(head).toContain('世話役 <span class="bf-mono">organizer</span>');
    expect(head).toContain('運営スタッフ <span class="bf-mono">staff</span>');
    expect(head).not.toContain('>system<');
    expect(head).toContain('状態機械 2 本');
    expect(head).toContain('<span class="bf-mono">workshop</span> 4 段');
    expect(head).toContain('<span class="bf-mono">workshop_publication</span> 2 段');
    expect(head).toContain('domain/workshop/');
  });

  it('標識の本数と判断ポイントの数は、単位が違うので足さずに並べる', () => {
    expect(text).toContain('標識 3 本、判断ポイント 12 件。単位が違うので足さない');
  });

  it('前提にする語は、台帳の face: book の語のうち本文に出るものだけ(framework の語は出さない)', () => {
    const terms = section(chapter, 'terms');

    expect(terms).toContain('人が意味を判定する宣言');
    expect(terms).toContain('守られるルールの境界');
    expect(terms).not.toContain('注釈');
  });
});

describe('読み方の印の凡例(受け入れは、理由つきの分と、まだ通していない分の両方)', () => {
  it('検証の結果が渡されていなければ、まだ通していない分は未集計と言う(0 とは言わない)', () => {
    const legend = pageText(section(chapter, 'legend'));

    expect(legend).toContain('理由をつけて通した分 3 件');
    expect(legend).toContain('まだ通していない分は未集計');
  });

  it('検証の結果が渡されていれば、件数を言う', () => {
    const legend = pageText(section(withFindings, 'legend'));

    expect(legend).toContain('理由をつけて通した分 3 件');
    expect(legend).toContain('まだ通していない分 2 件');
  });

  it('検証の結果に依る部分には印(data-dep)が付く', () => {
    expect(section(chapter, 'legend')).toContain('data-dep="verify"');
  });
});

describe('数の一致(読む量の 4 枚 = 本文に並ぶ項目 = 数の出どころ)', () => {
  const facts = faceFacts(model, ctx, workshop);

  it('公理の数は、本文に並ぶ公理の行の id の数(畳んだ従属 + 写した公理を含む)', () => {
    // 催し 3 + 部 2 + 当日のチェック 1 = 6、写した公理は枠の 1 本。
    expect(facts.own.flatMap((group) => group.invariants)).toHaveLength(6);
    expect(facts.carried).toHaveLength(1);
    // 必読 = 公理 12(不変条件 7 + アクセスの宣言 5 行)+ 受け入れ 3。読み手ごとに出す。
    expect(cards(chapter).get('axiom')).toBe('業務 13 / 開発者 2');
    expect(readingTotals(facts).required).toBe(15);
    expect(readingTotals(facts).axiomParts).toEqual({ invariants: 6, carried: 1, access: 5, states: 0, summaries: 0, examples: 0 });
    expect(readingTotals(facts).byReader.business).toMatchObject({ axioms: 12, reasoned: 1, required: 13 });
    expect(readingTotals(facts).byReader.developer).toMatchObject({ axioms: 0, reasoned: 2, required: 2 });
    expect(new Set(axiomIds(chapter)).size).toBe(7);
    expect(text).toContain('公理 12 本。不変条件はこの章 6、写した 1');
  });

  it('見出しの件数が、上段の各節の中身と一致する(公理 3・従属 3・アクセス 5・写した 1)', () => {
    expect(text).toContain('催しの公理(3)');
    expect(text).toContain('従属する概念とその公理(3)');
    expect(text).toContain('アクセスの宣言(5)');
    expect(text).toContain('写した公理(1)');
    expect(section(chapter, 'access').match(/<div class="bf-rule">/g)).toHaveLength(5);
  });

  it('受け入れは理由つき(手書き・定型外・タスクの受け入れ)の合計。検証の結果が無ければ未集計と書く', () => {
    expect(facts.accept.handwritten).toHaveLength(1);
    expect(facts.accept.manual.map((item) => item.what)).toEqual(['workshop.cancel']);
    expect(facts.accept.accepted).toHaveLength(1);
    expect(facts.pending).toBeNull();
    expect(cards(chapter).get('acceptance')).toContain('3');
    expect(text).toContain('未集計。検証の結果が渡されていない');
  });

  it('検証の結果が渡されていれば、範囲の仕様ファイルの警告だけが「まだ通していない分」になり、必読と受け入れに足される', () => {
    const facts2 = faceFacts(model, faceCtxWithFindings(), workshop);

    // 範囲の中の 2 件(催しの公理のファイルと、催しの表)。範囲の外(枠の公理のファイル)と場所の無い 1 件は含まない。
    expect(facts2.pending?.map((finding) => finding.verifier).sort()).toEqual(['T8', 'Y10']);
    expect(cards(withFindings).get('acceptance')).toContain('5');
    expect(cards(withFindings).get('axiom')).toBe('業務 13 / 開発者 4');
    expect(readingTotals(facts2).required).toBe(17);
    expect(pageText(withFindings)).toContain('検証器の警告');
    expect(pageText(withFindings)).toContain('Y10');
  });

  it('変更は基点が無ければ「—」(0 とは書かない)。基点つきなら、範囲の公理の側の差分を数える', () => {
    expect(cards(chapter).get('changed')).toBe('—');
    expect(text).toContain('基点が無いので、変わった分は数えない');

    const based = chapterOf(
      model,
      faceCtxWithFindings({
        ref: 'abc123',
        changes: [
          { element: 'invariant.statement', kind: 'changed', key: 'INV-WORKSHOP-001', before: 'a', after: 'b' },
          { element: 'state.label', kind: 'added', key: 'workshop.draft', before: null, after: '下書き' },
          { element: 'invariant.statement', kind: 'changed', key: 'INV-OTHER-001', before: 'a', after: 'b' },
        ],
      }),
    );

    expect(cards(based).get('changed')).toBe('2');
    expect(pageText(based)).toContain('今回変わった(2)');
    expect(pageText(based)).toContain('不変条件 INV-WORKSHOP-001 の中身が変わった');
    expect(pageText(based)).not.toContain('INV-OTHER-001');
  });

  it('遷移・マトリクス・執行点・テストの数を、導出の一言と数の出どころに出す', () => {
    // 遷移 2 + 1、マトリクスは 3 × 2 + 2 × 1、公理の執行点 6 本ぶん、テストは操作 7 + タスク 1。
    expect(facts.transitions).toBe(3);
    expect(facts.matrixCells).toBe(10);
    const tests = facts.tests.reduce((sum, row) => sum + row.unit + row.integration, 0);

    expect(text).toContain(`遷移 3 手、執行点 ${facts.enforcementOwn} か所、テスト ${tests} 件、ジョブ 0 件`);
    expect(text).toContain('マトリクス 10 マスは別に数える');
    // 参照 = 遷移 + 執行点(この章 + 写した分)+ テスト + ジョブ。
    expect(cards(chapter).get('derive')).toBe(String(3 + facts.enforcementOwn + facts.enforcementCarried + tests));
  });

  it('「(まだ書かれていない)」の数は、本文に出た数と数の出どころの値が一致する', () => {
    const body = chapter.slice(0, chapter.indexOf('<h2 id="origin">'));
    const count = body.split(NOT_WRITTEN).length - 1;

    // 章頭 3(親 + 節に畳んだ従属 2)+ 節の要約 2(機械 2 本)+ 段 6(進行 4 + 掲載 2)。
    expect(count).toBe(11);
    expect(text).toContain(`この章に ${count} か所`);
    expect(text).toContain('内訳 章頭の 1 文 3、節の要約 2、段の場面 6');
  });

  it('仕様から数えた未記入(summaryGaps)と、本文に出た数が合う', () => {
    const body = chapter.slice(0, chapter.indexOf('<h2 id="origin">'));

    expect(gapTotal(summaryGapsOf(facts.scope))).toBe(body.split(NOT_WRITTEN).length - 1);
  });

  it('ジョブは、章の遷移の effects が積むもののうちカタログにあるものを数える(重複は 1 つ)', () => {
    const withJobs = { ...ctx, jobs: jobModel([outboxJob('notify_cancelled'), outboxJob('notify_other')]) };
    const jobFacts = faceFacts(model, withJobs, workshop);

    expect(jobFacts.jobs).toBe(1);
    expect(faceFacts(model, ctx, workshop).jobs).toBe(0);
    expect(readingTotals(jobFacts).derived).toBe(jobFacts.transitions + jobFacts.enforcementOwn + jobFacts.enforcementCarried + jobFacts.tests.reduce((sum, row) => sum + row.unit + row.integration, 0) + 1);
    expect(pageText(chapterOf(model, withJobs))).toContain('ジョブ 1 件');
  });

  it('標識は 公理の側(ドメインの 4 ファイル)と 受け入れの側(操作)に分けて数える。足し合わせは必読に入らない', () => {
    expect(facts.signs).toEqual({ axiom: 3, decision: 0 });
    expect(readingTotals(facts).required).toBe(readingTotals(facts).axioms + readingTotals(facts).accept);
  });
});

describe('数の出どころ', () => {
  const origin = pageText(section(chapter, 'origin'));

  it('章の範囲(従属・タスク)・必読・写した公理・変更・受け入れ・重さを、数え方つきで説明する', () => {
    expect(origin).toContain('章の範囲');
    expect(origin).toContain('節に畳んだ従属 2 つ(部、当日のチェック)');
    expect(origin).toContain('必読 15');
    expect(origin).toContain('必読 = 公理 + 受け入れ');
    expect(origin).toContain('写した公理 1');
    expect(origin).toContain('は、全部で 5 本');
    expect(origin).toContain('そのうち範囲の中の 4 本を除いた 1 本を、全部写す');
    expect(origin).toContain('0 とは書かない');
    expect(origin).toContain('受け入れ 3');
    expect(origin).toContain('重さ 1 位');
  });

  it('数えられないものは未集計と書く(黙って 0 にしない)', () => {
    expect(origin).toContain('まだ通していない分は未集計。検証の結果が渡されていない');
  });
});

describe('summary を書いた章(章頭の 1 文・節の要約・段の場面)', () => {
  /** 親の集約に、3 か所の summary を書いた世界(節に畳んだ従属の章頭の 1 文も書く)。 */
  function written(): { readonly model: SpecModel; readonly specs: typeof workshop } {
    const specs = {
      ...workshop,
      entity: { ...workshop.entity!, summary: '世話役が開き、メンバーが申し込む勉強会の単位です。' },
      stateMachines: workshop.stateMachines.map((machine) => ({
        ...machine,
        summary: `${machine.machine} の流れの要約です。`,
        stateSummaries: Object.fromEntries(machine.states.map((state) => [state, `${state} の場面です。`])),
      })),
    };
    const aggregates = new Map(model.aggregates);
    aggregates.set('workshop', specs);
    for (const name of ['workshop_part', 'workshop_check']) {
      const child = model.aggregates.get(name)!;
      aggregates.set(name, { ...child, entity: { ...child.entity!, summary: `${name} の章頭の 1 文です。` } });
    }
    return { model: { ...model, aggregates }, specs };
  }

  it('章頭・節の要約(本線と補足枠の機械)・段の場面に、書いた文がそのまま出る', () => {
    const { model: next } = written();
    const html = chapterOf(next, ctx);

    expect(html).toContain('<p class="bf-prose bf-lede">世話役が開き、メンバーが申し込む勉強会の単位です。</p>');
    expect(html).toContain('<p class="bf-prose">workshop の流れの要約です。</p>');
    expect(html).toContain('<p class="bf-prose">workshop_publication の流れの要約です。</p>');
    expect(html).toContain('<p class="bf-prose">draft の場面です。</p>');
    expect(html).toContain('<p class="bf-prose">shown の場面です。</p>');
  });

  it('全部書けば「(まだ書かれていない)」は 1 か所も出ず、数の出どころは 0 か所と言う', () => {
    const { model: next, specs } = written();
    const html = chapterOf(next, ctx);

    expect(html.slice(0, html.indexOf('<h2 id="origin">'))).not.toContain(NOT_WRITTEN);
    expect(pageText(html)).toContain('この章に 0 か所');
    expect(gapTotal(summaryGapsOf([specs]))).toBe(0);
  });

  it('一部だけ書けば、書いていない場所だけ「(まだ書かれていない)」のまま残る', () => {
    const { model: next, specs } = written();
    // 章頭の 1 文だけ書いた(状態機械は元のまま = 節の要約も段の場面も書いていない)。
    const partial = { ...specs, stateMachines: workshop.stateMachines };
    const html = chapterOf({ ...next, aggregates: new Map([...next.aggregates, ['workshop', partial]]) }, ctx);

    expect(pageText(html)).toContain('内訳 章頭の 1 文 0、節の要約 2、段の場面 6');
    expect(summaryGapsOf([partial])).toEqual({ entity: 0, machines: 2, states: 6, places: 9 });
  });
});

describe('段(ライフサイクル)', () => {
  /** 段 1 つ(`bf-step` の 1 項目)。 */
  function stage(state: string): string {
    const at = chapter.search(new RegExp(`<span class="bf-pill(?: bf-pill--negative)?">${state}</span><b class="bf-step-label">`));
    if (at === -1) throw new Error(`段が無い: ${state}`);
    const from = chapter.lastIndexOf('<li class="bf-step">', at);
    const rest = chapter.slice(from + 1);
    const end = rest.search(/<li class="bf-step">|<\/ol>/);
    return chapter.slice(from, from + 1 + end);
  }

  it('段ごとに、出る手の数と、手ごとの 誰が・どこへ・遷移ガード を出す', () => {
    const draft = pageText(stage('draft'));

    expect(draft).toContain('出る手 2');
    expect(draft).toContain('publish公開する');
    expect(draft).toContain('誰が\n世話役、運営スタッフ');
    expect(draft).toContain('どこへ\nopen 受付中');
  });

  it('悪い知らせの段(tone: negative)はピルが別の色。ガードの式はそのまま等幅で出し、無ければ「—」', () => {
    const draft = stage('draft');

    expect(draft).toContain('<span class="bf-pill bf-pill--negative">called_off</span> 中止');
    expect(draft).toContain('<span class="bf-mono">now &#60; workshop.starts_at</span>');
    expect(draft).toContain('<span class="bf-no">—</span>');
  });

  it('初期の段・終端・決まること(settles)を出す。終端は出る手が 0', () => {
    expect(pageText(stage('draft'))).toContain('初期の段');
    expect(pageText(stage('open'))).toContain('決まること\n料金');
    const calledOff = pageText(stage('called_off'));

    expect(calledOff).toContain('終端。ここから先へ進む手は無い');
    expect(calledOff).toContain('出る手 0');
  });

  it('横断する遷移(中止)は補足枠に、誰が・いつ・どこへ・遷移ガード・補足(通知と入力する欄)で出す', () => {
    const side = pageText(section(chapter, 'sidebox'));

    expect(side).toContain('横断する遷移 1 本');
    expect(side).toContain('中止するworkshop.cancel');
    expect(side).toContain('3 つの状態から。下書き、受付中、締切');
    // 通知カタログが無い世界では、通知は「なし」と出す(カタログに載っていないものは通知として出さない)。
    expect(side).toContain('通知: なし');
    expect(side).toContain('入力する欄: なし(対象の id だけ)');
  });

  it('第 2 の状態機械は補足枠に段の流れで出し、図は畳んだ折りたたみに入れる', () => {
    const side = section(chapter, 'sidebox');

    expect(side).toContain('<span class="bf-pill">hidden</span><b class="bf-step-label">未掲載</b>');
    expect(side).toMatch(/<details class="bf-fold" data-kind="detail"><summary[^>]*>(?:(?!<\/summary>)[\s\S])*図 — workshop_publication/);
  });
});

describe('ライフサイクルの図(上段は段と矢印だけ。全遷移の mermaid は持たない)', () => {
  const upper = chapter.slice(0, chapter.indexOf('<h2 id="lower">'));

  it('上段には SVG の図があり、悪い知らせの段は別の色。mermaid は無い', () => {
    expect(upper).toContain('<figure class="bf-fl">');
    expect(upper).toContain('<svg class="bf-fl-svg"');
    expect(chapter).not.toMatch(/mermaid|stateDiagram|<PanZoom/);
  });

  it('第 2 の状態機械の図も SVG で、補足枠の折りたたみの中にある', () => {
    const side = section(chapter, 'sidebox');

    expect(side).toMatch(/図 — workshop_publication[\s\S]*?<figure class="bf-fl">/);
  });

  it('図は流れ(本線)に 1 枚、補足枠に 1 枚。1 つの折りたたみに図は 1 枚', () => {
    expect(upper.match(/<figure class="bf-fl">/g)).toHaveLength(2);
    expect(section(chapter, 'flow').match(/<figure class="bf-fl">/g)).toHaveLength(1);
  });

  it('流れの facts を引けなければ図は出さず、段のカードだけで読める', () => {
    const bare = domainChapter(model, ctx, 'workshop', () => undefined)?.body ?? '';

    expect(bare).not.toContain('<figure class="bf-fl">');
    expect(bare).toContain('class="bf-steps"');
  });
});

/** 公理の `enforced_by` を、遷移を名指す `guard` に差し替えた世界。 */
function withGuards(guards: Readonly<Record<string, readonly string[]>>): SpecModel {
  const base = faceModel();
  const aggregates = new Map(base.aggregates);
  for (const [name, specs] of base.aggregates) {
    const invariants = specs.invariants;
    if (invariants === undefined) continue;
    const patched: InvariantDef[] = invariants.invariants.map((invariant) => ({
      ...invariant,
      enforcedBy: [...invariant.enforcedBy, ...(guards[invariant.id] ?? []).map((ref) => ({ kind: 'guard' as const, ref, location: loc() }))],
    }));
    aggregates.set(name, { ...specs, invariants: { ...invariants, invariants: patched } });
  }
  return { ...base, aggregates };
}

/** 出る手の一覧(`bf-hands`)のうち、イベント名で始まる 1 手。 */
function hand(html: string, event: string): string {
  const start = html.indexOf(`<li><span class="bf-hd"><span class="bf-ev">${event}</span>`);
  if (start === -1) throw new Error(`手が無い: ${event}`);
  return html.slice(start, html.indexOf('</li>', start));
}

describe('出る手の「遷移ガード」と「関係する公理」', () => {
  it('出る手のラベルは「条件」でなく「遷移ガード」で、ガードが無ければ「—」', () => {
    const publish = hand(chapter, 'publish');

    expect(publish).toContain('<div class="bf-k">遷移ガード</div><div class="bf-v"><span class="bf-no">—</span></div>');
    expect(publish).not.toContain('<div class="bf-k">条件</div>');
    expect(hand(chapter, 'cancel')).toContain('<div class="bf-k">遷移ガード</div><div class="bf-v"><span class="bf-mono">now &#60; workshop.starts_at</span></div>');
  });

  it('遷移を名指す公理が無ければ「関係する公理」の行は出さない(推測しない)', () => {
    expect(chapter).not.toContain('関係する公理');
  });

  it('enforced_by の guard が遷移を名指していれば、その手に「関係する公理」を足す。章を持つ集約へはリンク', () => {
    const html = chapterOf(withGuards({ 'INV-ENTRY-001': ['workshop.publish'] }), faceCtx('all'));

    expect(hand(html, 'publish')).toContain('<div class="bf-k">関係する公理</div>');
    expect(hand(html, 'publish')).toContain('<a href="./entry.html#inv-INV-ENTRY-001"><span class="bf-mono">INV-ENTRY-001</span></a>');
    // 名指していない手(cancel)には足さない。
    expect(hand(html, 'cancel')).not.toContain('INV-ENTRY-001');
  });

  it('宿り先の章が無いとき(人向けの表示を絞った世界)は、リンクにせず等幅の id だけを出す', () => {
    const html = chapterOf(withGuards({ 'INV-ENTRY-001': ['workshop.publish'] }), faceCtx(1));

    expect(html).toContain('<div class="bf-k">関係する公理</div><div class="bf-v"><span class="bf-mono">INV-ENTRY-001</span></div>');
    expect(html).not.toContain('entry.html#inv-');
  });

  it('一意性の公理は 1 行に束ねられて id を持たないので、リンクにしない', () => {
    const html = chapterOf(withGuards({ 'INV-WORKSHOP-003': ['workshop.cancel'] }), faceCtx('all'));

    expect(html).toContain('<div class="bf-k">関係する公理</div><div class="bf-v"><span class="bf-mono">INV-WORKSHOP-003</span></div>');
    expect(html).not.toContain('#inv-INV-WORKSHOP-003');
  });

  it('横断する遷移(補足枠)にも同じ「遷移ガード」と「関係する公理」が付く', () => {
    const html = chapterOf(withGuards({ 'INV-WORKSHOP-001': ['workshop.cancel'] }), faceCtx('all'));
    const side = section(html, 'sidebox');

    expect(side).toContain('<div class="bf-k">遷移ガード</div>');
    expect(side).toContain('<div class="bf-k">関係する公理</div>');
    expect(side).toContain('#inv-INV-WORKSHOP-001');
  });

  it('公理の行は、リンクの飛び先になる id を持つ(1 本だけの行)', () => {
    expect(chapter).toContain('<div class="bf-axiom" id="inv-INV-WORKSHOP-001"><div class="bf-id">INV-WORKSHOP-001 ');
    expect(chapter).not.toContain('id="inv-INV-WORKSHOP-003"');
  });
});

/** 催しの「読む」に、隠す欄の宣言を足した世界。 */
function withHiddenFields(): SpecModel {
  const access = workshop.access!;
  return {
    ...model,
    aggregates: new Map([...model.aggregates, ['workshop', { ...workshop, access: { ...access, fieldsHidden: [{ field: 'internal_note', from: ['member'], location: loc() }] } }]]),
  };
}

/** 折りたたみ(タイトルで引く)。 */
function foldTitled(html: string, title: string): string {
  const at = html.indexOf(`<span class="bf-fold-title">${title}</span>`);
  if (at === -1) return '';
  return html.slice(at, html.indexOf('</details>', at));
}

describe('誰に見えるか — 行の見え方と隠す欄を分ける', () => {
  it('表は読むだけの 3 列で、読むの宣言は行の見え方だけと断る。隠す欄の宣言が無ければ、折りたたみを出さずそう言う', () => {
    const lower = section(chapter, 'lower');
    const readFold = pageText(foldTitled(lower, '誰に見えるか') || lower.slice(lower.indexOf('誰に見えるか')));

    expect(readFold).toContain('ロール | 見える範囲 | この宣言に乗っている query');
    expect(readFold).not.toContain('隠すフィールド');
    expect(readFold).toContain('読むの宣言は、行の見え方だけを決める。欄の公開は別の層が決め、この集約に隠す欄の宣言は無い。');
    expect(lower).not.toContain('<span class="bf-fold-title">隠す欄</span>');
  });

  it('隠す欄の宣言があれば、別の折りたたみに欄と相手を並べる', () => {
    const lower = section(chapterOf(withHiddenFields(), ctx), 'lower');
    const hidden = foldTitled(lower, '隠す欄');

    expect(hidden).toContain('1 欄');
    expect(pageText(hidden)).toContain('欄 | 隠す相手');
    expect(pageText(hidden)).toContain('internal_note | member');
    expect(pageText(lower)).toContain('隠す欄は次の折りたたみにある。');
  });

  it('上段のアクセスの宣言も、読むは行の見え方だけで欄の公開は別の層と言う', () => {
    expect(chapter).toContain('<li>読むの宣言は行の見え方だけを決める。欄の公開は別の層で、下段の隠す欄が持つ</li>');
  });
});

const GLOSS = '意図した全公開かを、ここで判断する';

/** 親(催し)の読みの宣言を差し替えた世界の、催しの章の「読む — 催し」ブロック。 */
function workshopReadBlock(reads: readonly ReadRule[]): string {
  const next = {
    ...model,
    aggregates: new Map([...model.aggregates, ['workshop', { ...workshop, access: { ...workshop.access!, reads } }]]),
  };
  const html = chapterOf(next, ctx);
  const start = html.indexOf('<div class="bf-rule"><div class="bf-id">読む — 催し');
  const rest = html.slice(start + 1);
  const end = rest.search(/<div class="bf-rule">|<details /);
  return html.slice(start, start + 1 + end);
}

describe('読むのブロックの ⚠ の句', () => {
  it('条件の無い全件が 2 本 + 条件つきの全件が 1 本: 先頭の句は「条件つきと書いていないもの」に限って 1 回。条件つきの行は条件を添え、句は持たない', () => {
    const block = workshopReadBlock([read('member', 'all'), read('organizer', 'all'), read('staff', 'all', undefined, 'state == draft')]);

    expect(block.match(new RegExp(GLOSS, 'g'))).toHaveLength(1);
    expect(block).toContain('<p class="bf-note">⚠ の行のうち「条件つき」と書いていないものは、絞る条件の無い全行。');
    expect(block).not.toContain('⚠ がついた行は');
    const rows = block.match(/<div class="bf-v"><b>全件 ⚠<\/b>[^]*?<\/div>/g) ?? [];
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => !row.includes('条件つき'))).toEqual(Array(2).fill('<div class="bf-v"><b>全件 ⚠</b></div>'));
    expect(rows.filter((row) => row.includes('条件つき'))).toEqual(['<div class="bf-v"><b>全件 ⚠</b>(条件つき。条件は下の「読み取りの条件」)</div>']);
  });

  it('条件の無い全件が 1 本 + 条件つきの全件が 1 本: 先頭の句は出さず、条件の無い行に句を添える', () => {
    const block = workshopReadBlock([read('member', 'all'), read('staff', 'all', undefined, 'state == draft')]);

    expect(block).not.toContain('class="bf-note"');
    expect(block.match(new RegExp(GLOSS, 'g'))).toHaveLength(1);
    expect(block).toContain(`<b>全件 ⚠</b> — 絞る条件の無い全行。${GLOSS}</div>`);
    expect(block).toContain('(条件つき。条件は下の「読み取りの条件」)</div>');
  });

  it('条件(filters / when)つきの読みは、その行に「条件つき」と添え、条件を折りたたみに残す', () => {
    const next = {
      ...model,
      aggregates: new Map([...model.aggregates, ['workshop', { ...workshop, access: { ...workshop.access!, reads: [read('member', 'own', { tenant_id: 'tenant_id' }, 'state == draft')] } }]]),
    };
    const access = section(chapterOf(next, ctx), 'access');

    expect(access).toContain('<div class="bf-v">自分の行(条件つき。条件は下の「読み取りの条件」)</div>');
    expect(foldTitled(access, '読み取りの条件')).toContain('1 件');
    expect(access).toContain('tenant_id = actor.tenant_id');
    expect(access).toContain('state == draft');
  });
});

describe('上段(公理)の節', () => {
  it('節の見出しは この順: 流れ・補足枠・公理・従属・アクセス・写した公理・変更・受け入れ。件数は見出しに見える', () => {
    const headings = [...chapter.matchAll(/<h3 id="([a-z]+)">([\s\S]*?)<\/h3>/g)].map((match) => `${match[1]}:${pageText(match[2] ?? '')}`);

    expect(headings).toEqual([
      'flow:ライフサイクルの 4 段',
      'sidebox:補足枠 — 本線の外の動き',
      'axioms:催しの公理(3)',
      'subordinate:従属する概念とその公理(3)',
      'access:アクセスの宣言(5)',
      'carried:写した公理(1)',
      'changed:今回変わった(—) 変更',
      'acceptance:受け入れ(3) 受け入れ',
    ]);
  });

  it('アクセスの宣言は、読むが集約ごとの 1 ブロック・作る書く消すが集約ごとの折りたたみに役をまとめた行で並ぶ', () => {
    const access = section(chapter, 'access');

    expect(access).not.toContain('<table');
    expect(access).toContain('<div class="bf-id">読む — 催し <span class="bf-mark bf-mark--axiom">必読</span></div>');
    expect(access).toContain('<div class="bf-rk"><span class="bf-mono">member</span></div><div class="bf-v"><b>全件 ⚠</b> — 絞る条件の無い全行。意図した全公開かを、ここで判断する</div>');
    expect(foldTitled(access, '作る・書く・消す — 催し')).toContain('2 行');
    expect(foldTitled(access, '作る・書く・消す — 部(従属)')).toContain('1 行');
    expect(access).toContain('<div class="bf-id">作る <span class="bf-mark bf-mark--axiom">必読</span></div>');
    expect(access).toContain('<div class="bf-id">書く <span class="bf-mark bf-mark--axiom">必読</span></div>');
    expect(access).toContain('state == draft');
    expect(pageText(access)).toContain('判断ポイントの台帳の 1 本 1 件とは、数え方が違う');
  });

  it('従属の節は、畳む基準と、畳んだ集約・自分の章を持つ集約(リンクつき)を名指す。節の見出しにはアンカーが付く', () => {
    const subs = section(chapter, 'subordinate');

    expect(pageText(subs)).toContain('on delete cascade');
    expect(pageText(subs)).toContain('いま 2 つ。部、当日のチェック');
    expect(subs).toContain('自分の章を持つのは 1 つ。作るロールか消すロールが、親を動かす人の外にいる。<a href="./entry.html">枠</a>');
    expect(subs).toContain('<p class="bf-subhead" id="sub-workshop_part">部<small>workshop_part · 親 催し</small></p>');
  });

  it('従属する集約が公理を 1 本も持たないときは、見出しから公理と件数を外す(「公理(0)」を出さない)', () => {
    const stripped = {
      ...model,
      aggregates: new Map(
        [...model.aggregates].map(([name, specs]) => [
          name,
          name === 'workshop_part' || name === 'workshop_check' ? { ...specs, invariants: { ...specs.invariants!, invariants: [] } } : specs,
        ]),
      ),
    };
    const html = chapterOf(stripped, ctx);

    expect(pageText(section(html, 'subordinate').slice(0, 200))).toContain('従属する概念');
    expect(pageText(html)).not.toContain('従属する概念とその公理');
    expect(pageText(html)).not.toContain('従属は、自分だけの公理を、ここで読む');
    expect(html).toContain('<p class="bf-subhead" id="sub-workshop_part">部');
  });

  it('写した公理は、原本の章へのリンクと、写す基準(entities に親を含む)を出す', () => {
    const carried = section(chapter, 'carried');

    expect(carried).toContain('<a href="./entry.html">集約 entry(枠)</a>');
    expect(carried).toContain('INV-ENTRY-001');
    expect(carried).not.toContain('INV-ENTRY-002');
    expect(pageText(carried)).toContain('entities に workshop を含むものを、全部写す');
  });

  it('受け入れは件数・何を・状態(理由の原文)の表。検証の結果が無ければ警告は未集計', () => {
    const accept = pageText(section(chapter, 'acceptance'));

    expect(accept).toContain('テーブルの手書き');
    expect(accept).toContain('適用済みの migration が作った執行点');
    expect(accept).toContain('同一トランザクションの副作用を持つ');
    expect(accept).toContain('作成時に全部入力できるほうが軽い');
    expect(accept).toContain('未集計。検証の結果が渡されていない');
  });
});

describe('下段(導出)は折りたたみだけ', () => {
  const lower = section(chapter, 'lower');
  const titles = [...lower.matchAll(/<span class="bf-fold-title">([^<]*)<\/span>/g)].map((match) => match[1]);
  const lowerText = pageText(lower);

  it('遷移表とマトリクスは機械ごとに別の折りたたみ', () => {
    expect(titles).toEqual(expect.arrayContaining(['遷移表 — workshop', 'マトリクス — workshop', '遷移表 — workshop_publication', 'マトリクス — workshop_publication']));
  });

  it('結果表は、同じ手を持つロールを 1 列にまとめる(世話役と運営スタッフ)', () => {
    expect(lowerText).toContain('段 | 世話役、運営スタッフ');
    expect(lowerText).toContain('公開する');
  });

  it('結果表にロールの列を足す。遷移の by に現れないロールが各状態でできることを、アクセスの宣言から導く', () => {
    expect(lowerText).toContain('段 | 世話役、運営スタッフ | member');
    expect(lowerText).toContain('draft(下書き) | 公開する、中止する | 閲覧');
    expect(lowerText).toContain('called_off(中止) | — | 閲覧');
    expect(lowerText).toContain('ロールの列は、アクセスの宣言と操作から導いた帰結。');
  });

  it('執行点は公理ごとに「種類 件数」と置き場の一覧を出す(上段には出さない)', () => {
    expect(lowerText).toContain('INV-WORKSHOP-002 | トリガ 1 + アプリ 1 | check_no_requested、assertNoRequested');
    expect(titles).toEqual(expect.arrayContaining(['執行点 — この章の公理', '執行点 — 写した公理']));
    expect(foldTitled(lower, '執行点 — この章の公理')).toContain('<span class="bf-fold-n">7</span>');
    expect(foldTitled(lower, '執行点 — 写した公理')).toContain('<span class="bf-fold-n">1</span>');
    expect(pageText(section(chapter, 'upper'))).not.toContain('check_no_requested');
  });

  it('テストは出どころごとに件数とユニット・統合の内訳を出す', () => {
    expect(lowerText).toContain('催し(操作仕様 3 本・テーブル仕様 1 表) | 5 | ユニット 3・統合 2');
    expect(lowerText).toContain('タスク「世話役が催しを公開する」 | 1');
  });

  it('標識は上段の折りたたみ(sign)に入り、本数と出典が見える。下段(導出)には出さない', () => {
    expect(chapter).toContain('<span class="bf-fold-title">標識 1 本</span><span class="bf-fold-hint">domain/workshop/invariants.md</span>');
    expect(section(chapter, 'upper')).toContain('data-kind="sign"');
    expect(lower).not.toContain('data-kind="sign"');
  });
});

describe('公理の行の語彙', () => {
  it('ラベル行に使った語は 17 語の中だけで、公理の行は主語・決まること・例外・形式・原本を持つ', () => {
    const used = new Set([...chapter.matchAll(/<div class="bf-k">([^<]*)<\/div>/g)].map((match) => match[1]));

    expect([...used].every((label) => (FACE_LABELS as readonly string[]).includes(label ?? ''))).toBe(true);
    for (const label of ['主語', '決まること', '例外', '形式', '原本', '誰が', 'どこへ', '条件']) expect(used.has(label)).toBe(true);
  });
});

/** 計算の早見表の例 1 行。 */
function example(
  note: string,
  given: { facts?: Readonly<Record<string, ComputeExampleValue>>; input?: Readonly<Record<string, ComputeExampleValue>> },
  expectValue: ComputeExampleValue,
): ActionComputeExample {
  return { note, facts: given.facts ?? {}, input: given.input ?? {}, expect: expectValue, location: { file: 'x.md' } };
}

/** 催しの公開に、例の表つきの computes を宣言した文脈(それ以外は小さな世界のまま)。 */
function ctxWith(init: { shape: 'facts_input' | 'input'; examples: readonly ActionComputeExample[] }): GenerateContext {
  const base = faceCtx();
  const actions = (base.actions?.actions ?? []).map((action) =>
    action.handles.raw === 'workshop.publish'
      ? actionSpec({
          handles: 'workshop.publish',
          input: ['workshop.state'],
          computes: { 'workshop.starts_at': 'startOf' },
          computeReads: { 'workshop.starts_at': ['workshop.state', 'workshop.id'] },
          computeShapes: { 'workshop.starts_at': init.shape },
          computeExamples: { 'workshop.starts_at': init.examples },
        })
      : action,
  );
  return { ...base, actions: { ...(base.actions as NonNullable<GenerateContext['actions']>), actions } };
}

/** 計算の早見表の節(無ければ空)。 */
function examplesSection(html: string): string {
  const start = html.indexOf('<h3 id="examples">');
  return start === -1 ? '' : section(html, 'examples');
}

describe('facts_input の早見表', () => {
  const rows = [
    example('受付中', { facts: { 'workshop.state': 'open', 'workshop.id': null }, input: { state: 'closed' } }, 1500),
    example('決まらない', { facts: { 'workshop.state': 'draft' } }, null),
    example('真偽の値', { facts: { 'workshop.id': true } }, false),
  ];
  const withExamples = ctxWith({ shape: 'facts_input', examples: rows });
  const html = chapterOf(model, withExamples);
  const table = examplesSection(html);

  it('見出しの数 = 公理の内訳の数 = 本文の表の行の数(行頭に読み方の印)', () => {
    const facts = faceFacts(model, withExamples, workshop);
    const bodyRows = [...table.matchAll(/<tr>(?:(?!<\/tr>)[\s\S])*bf-mark--axiom(?:(?!<\/tr>)[\s\S])*<\/tr>/g)];

    expect(pageText(table)).toContain('計算の早見表(3)');
    expect(facts.axiomParts.examples).toBe(3);
    expect(bodyRows).toHaveLength(3);
    expect(readingTotals(facts).axiomParts.examples).toBe(3);
  });

  it('列は 行の名前 + 事実(reads の並び)+ 入力(操作の input の並び)+ 値', () => {
    const header = pageText(table.slice(table.indexOf('<thead>'), table.indexOf('</thead>')));

    expect(header).toBe(['行の名前', 'workshop.state', 'workshop.id', '入力: workshop.state', '→ workshop.starts_at'].join(' | '));
  });

  it('値の見せ方: 与えない欄は「—」・空は「空」・真偽は「はい / いいえ」・数はけた区切り', () => {
    expect(table).toContain('<b>1,500</b>');
    expect(table).toContain('<span class="bf-none">空</span>');
    expect(table).toContain('<span class="bf-no">—</span>');
    expect(table).toContain('<b>いいえ</b>');
    expect(pageText(table)).toContain('はい');
  });

  it('章の中では上段のアクセスの宣言の次に入り、数の出どころに内訳が出る', () => {
    expect(html.indexOf('<h3 id="examples">')).toBeGreaterThan(html.indexOf('<h3 id="access">'));
    expect(html.indexOf('<h3 id="examples">')).toBeLessThan(html.indexOf('<h2 id="lower">'));
    expect(pageText(html)).toContain('計算の例の表 3 行');
  });
});

describe('input の早見表', () => {
  const rows = [
    example(
      '入れ子の入力',
      { input: { workshop: { seatFee: 500 }, participants: [{ id: 'p1', joins: true }, { id: 'p2', joins: false }], entries: [{ id: 'e1' }] } },
      { participantFees: [{ feeAmount: 12345.5 }] },
    ),
  ];
  const table = examplesSection(chapterOf(model, ctxWith({ shape: 'input', examples: rows })));

  it('列は 行の名前 / 入力 / 値。平らなマッピング 1 つが 1 行で、配列は要素が 2 つ以上のときだけ添字を付ける', () => {
    expect(pageText(table)).toContain('行の名前 | 入力 | 値');
    expect(table).toContain('<span class="bf-mono">workshop</span> seatFee 500');
    expect(table).toContain('<span class="bf-mono">participants[0]</span> id p1・joins はい');
    expect(table).toContain('<span class="bf-mono">participants[1]</span> id p2・joins いいえ');
    expect(table).toContain('<span class="bf-mono">entries</span> id e1');
    expect(table).toContain('<span class="bf-mono">participantFees</span> feeAmount 12,345.5');
  });

  it('スカラーが直に値のとき・平らでない入れ子は、鍵の道をたどって 1 行 1 値にする', () => {
    const deep = [example('深い入れ子', { input: { a: { b: { c: 1 } }, flag: true } }, 0)];
    const out = examplesSection(chapterOf(model, ctxWith({ shape: 'input', examples: deep })));

    expect(out).toContain('<span class="bf-mono">a.b</span> c 1');
    expect(out).toContain('<span class="bf-mono">flag</span> はい');
    expect(out).toContain('<li>0</li>');
  });
});

describe('同じ関数の欄が複数ある操作と、例が無い章', () => {
  it('見出しの下の説明に、同じ関数が決める欄を全部並べる(例は最初の欄にだけ書いてある)', () => {
    const base = faceCtx();
    const actions = (base.actions?.actions ?? []).map((action) =>
      action.handles.raw === 'workshop.publish'
        ? actionSpec({
            handles: 'workshop.publish',
            computes: { 'workshop.starts_at': 'tableOf', 'workshop.state': 'tableOf' },
            computeShapes: { 'workshop.starts_at': 'input' },
            computeExamples: { 'workshop.starts_at': [example('一行', { input: { a: 1 } }, { b: 2 })] },
          })
        : action,
    );
    const next = { ...base, actions: { ...(base.actions as NonNullable<GenerateContext['actions']>), actions } };

    expect(examplesSection(chapterOf(model, next))).toContain('が決める <span class="bf-mono">workshop.starts_at</span>・<span class="bf-mono">workshop.state</span>・1 行');
  });

  it('例を持つ操作が範囲に無ければ節を出さない(数も 0)', () => {
    const facts = faceFacts(model, ctx, workshop);

    expect(examplesSection(chapter)).toBe('');
    expect(facts.axiomParts.examples).toBe(0);
    expect(text).not.toContain('計算の早見表');
  });
});

/** 構造の問題を全部返す(空なら規則どおり)。書き出した HTML の章を、要素と属性で見る。 */
function structureProblems(html: string): string[] {
  const problems: string[] = [];
  const marks = ['axiom', 'derive', 'acceptance', 'changed'];
  for (const match of html.matchAll(/bf-mark--([a-z-]+)/g)) if (!marks.includes(match[1] ?? '')) problems.push(`読み方の印の種類が 4 つの外: ${match[1]}`);
  for (const match of html.matchAll(/data-cell="([^"]*)"/g)) if (!['axiom', 'changed', 'acceptance', 'derive'].includes(match[1] ?? '')) problems.push(`4 枚の種類が 4 つの外: ${match[1]}`);
  if (/<h[4-6][\s>]/.test(html)) problems.push('見出しが 4 段以上ある');
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) problems.push(`h1 が ${h1} 個ある(1 つだけ)`);
  for (const match of html.matchAll(/<div class="bf-k">([^<]*)<\/div>/g)) if (!(FACE_LABELS as readonly string[]).includes(match[1] ?? '')) problems.push(`ラベルの語が ${FACE_LABELS.length} 語の外: ${match[1]}`);
  for (const match of html.matchAll(/<p class="bf-label">([^<]*?) <span/g)) if (match[1] !== HANDS_HEADING) problems.push(`見出しラベルが「${HANDS_HEADING}」以外: ${match[1]}`);
  const opened = (html.match(/<details[^>]*\sopen[\s>]/g) ?? []).length;
  if (opened > 5) problems.push(`既定で開く折りたたみが ${opened} 個ある(5 まで)`);
  // 折りたたみの中は表 1 枚・図 1 枚まで。見出しごとの、折りたたみの外の見える部分も表 1 枚・図 1 枚まで。
  let depth = 0;
  let heading = 0;
  const inFold: Array<{ tables: number; figures: number }> = [];
  const visible: Array<{ tables: number; figures: number }> = [{ tables: 0, figures: 0 }];
  for (const match of html.matchAll(/<details\b|<\/details>|<h[23]\b|<table\b|<figure\b/g)) {
    const tag = match[0];
    if (tag === '<details') {
      depth += 1;
      if (depth === 1) inFold.push({ tables: 0, figures: 0 });
    } else if (tag === '</details>') depth -= 1;
    else if (tag.startsWith('<h')) {
      if (depth === 0) {
        heading += 1;
        visible.push({ tables: 0, figures: 0 });
      }
    } else {
      const target = depth > 0 ? inFold[inFold.length - 1] : visible[visible.length - 1];
      if (target !== undefined) {
        if (tag === '<table') target.tables += 1;
        else target.figures += 1;
      }
    }
  }
  inFold.forEach((fold, index) => {
    if (fold.tables > 1) problems.push(`折りたたみに表が 2 枚以上ある: ${index} 番目`);
    if (fold.figures > 1) problems.push(`折りたたみに図が 2 枚以上ある: ${index} 番目`);
  });
  visible.forEach((part, index) => {
    if (part.tables > 1) problems.push(`見出し ${index} 番目の見える部分に表が 2 枚以上ある`);
    if (part.figures > 1) problems.push(`見出し ${index} 番目の見える部分に図が 2 枚以上ある`);
  });
  void heading;
  // 部品のタグは開きと閉じが揃う。
  for (const tag of ['details', 'ul', 'ol', 'table', 'div']) {
    const opens = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
    const closes = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
    if (opens !== closes) problems.push(`<${tag}> の開き ${opens} と閉じ ${closes} が揃わない`);
  }
  // 見た目はテーマの仕事。生成した章に生の色・インラインのスタイルを書かない。
  if (/\sstyle="/.test(html)) problems.push('インラインの style 属性がある');
  if (/#[0-9a-fA-F]{6}\b/.test(html.replace(/&#\d+;/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ''))) problems.push('生の色(hex)がある');
  return problems;
}

describe('構造の規則(読み方の印・階層・ラベル・既定で開く数・1 画面の要素)', () => {
  it('生成した章は規則どおり(問題の一覧が空)', () => {
    expect(structureProblems(chapter)).toEqual([]);
    expect(structureProblems(withFindings)).toEqual([]);
    expect(structureProblems(chapterOf(model, ctx, 'entry'))).toEqual([]);
    expect(structureProblems(chapterOf(model, ctxWith({ shape: 'input', examples: [example('一行', { input: { a: 1 } }, 2)] })))).toEqual([]);
  });

  it('既定で開く折りたたみは 0 個(畳んでも見出しと本数は見える)', () => {
    expect(chapter).not.toMatch(/<details[^>]*\sopen[\s>]/);
  });

  it('導出はすべて折りたたみ。下段の見出しのあとに表がむき出しで置かれない', () => {
    const lower = section(chapter, 'lower');
    const outside = lower.replace(/<details\b[\s\S]*?<\/details>/g, '');

    expect(outside).not.toContain('<table');
  });
});

describe('わざと壊す確認(構造の検査が本当に落ちる)', () => {
  const broken = (edit: (html: string) => string): string[] => structureProblems(edit(chapter));

  it('4 枚の印を 5 種目にすると落ちる', () => {
    expect(chapter).toContain('data-cell="axiom"');
    expect(broken((html) => html.replace('data-cell="axiom"', 'data-cell="secret"')).join()).toContain('4 枚の種類が 4 つの外: secret');
  });

  it('4 つの外の読み方の印・4 段以上の見出し・17 語の外のラベルを足すと落ちる', () => {
    expect(broken((html) => `${html}<span class="bf-mark bf-mark--secret">x</span>`).join()).toContain('印の種類が 4 つの外');
    expect(broken((html) => `${html}<h4>4 段目</h4>`).join()).toContain('見出しが 4 段以上');
    expect(broken((html) => `${html}<div class="bf-kvs"><div class="bf-kv"><div class="bf-k">新しい語</div><div class="bf-v">x</div></div></div>`).join()).toContain('17 語の外');
  });

  it('既定で開く折りたたみを 6 個にすると落ちる', () => {
    let count = 0;
    const opened = broken((html) => html.replace(/<details class="bf-fold"/g, (whole) => (count++ < 6 ? '<details open class="bf-fold"' : whole)));

    expect(opened.join()).toContain('既定で開く折りたたみが');
  });

  it('折りたたみに表を 2 枚入れる・見える部分に表を 2 枚並べると落ちる', () => {
    const table = '<table><tr><td>1</td></tr></table>';

    expect(broken((html) => html.replace('</details>', `${table}${table}</details>`)).join()).toContain('折りたたみに表が 2 枚以上');
    expect(broken((html) => `${html}<h3 id="x">見える節</h3>${table}${table}`).join()).toContain('見える部分に表が 2 枚以上');
  });

  it('折りたたみに図を 2 枚入れると落ちる', () => {
    expect(broken((html) => html.replace('</details>', '<figure></figure><figure></figure></details>')).join()).toContain('折りたたみに図が 2 枚以上');
  });

  it('タグの閉じ忘れ・インラインのスタイル・生の色を入れると落ちる', () => {
    expect(broken((html) => html.replace('</details>', '')).join()).toContain('<details>');
    expect(broken((html) => `${html}<p style="color:red">x</p>`).join()).toContain('style');
    expect(broken((html) => `${html}<p>#7a2731</p>`).join()).toContain('生の色');
  });
});

describe('標識の置き場(落とさない)', () => {
  it('標識を持つ仕様ファイルの引用の頭の 1 行が、章の本文に出る', () => {
    for (const file of ['entity', 'states', 'invariants']) {
      const path = `docs/specs/domain/workshop/${file}.md`;

      expect(chapter).toContain(`<p data-sign-source="${path}" data-sign-count="1">`);
    }
  });

  it('標識は折りたたみ(sign)に入り、本数が見出しに見える', () => {
    expect(chapter).toContain('<span class="bf-fold-title">標識 1 本</span><span class="bf-fold-hint">domain/workshop/states.md</span>');
  });

  it('公理が 0 本でも、invariants と access の標識の引用は章に出る(空の「公理(0)」の節は作らない)', () => {
    const invariants = workshop.invariants!;
    const access = workshop.access!;
    const aggregates = new Map(model.aggregates);
    aggregates.set('workshop', { ...workshop, invariants: { ...invariants, invariants: [] } });
    const sources = new Map(ctx.specSources ?? []);
    sources.set(access.location.file, '---\ndoc_type: access_spec\n---\n\n- 見える範囲は世話役が決める。\n');
    const html = chapterOf({ ...model, aggregates }, { ...ctx, specSources: sources });

    expect(html).toContain(`data-sign-source="${invariants.location.file}"`);
    expect(html).toContain(`data-sign-source="${access.location.file}"`);
    expect(pageText(html)).not.toContain('の公理(0)');
  });
});
