/**
 * S2(参照実在)のテスト。
 *
 * screen-spec-writing.md の S2 が要求する 5 つの参照(reads / actions / navigations.to /
 * navigations.on / chrome)それぞれに、通るケースと失敗するケースを置く。
 */

import { describe, expect, it } from 'vitest';
import { referenceExistenceVerifier } from '../../../../lib/screen/verifiers/s2-reference-existence.js';
import {
  accessSpec,
  aggregate,
  create,
  event,
  machine,
  specModel,
} from '../../../helpers/model-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';
import {
  SCREEN_CTX,
  chromeSpec,
  screenInput,
  screenSpec,
} from '../../../helpers/screen-builder.js';

/** entry.submit(状態機械のイベント)と entry.create(予約 ID)を持つドメイン。 */
function domain() {
  return specModel([
    aggregate('entry', {
      stateMachines: [
        machine('entry', {
          states: ['draft', 'submitted'],
          initial: 'draft',
          events: [event('submit', { from: ['draft'], to: 'submitted', by: ['performer'] })],
        }),
      ],
      access: accessSpec('entry', { creates: [create('member')] }),
    }),
  ]);
}

/** S2 を実行して Finding を返す。 */
function run(init: Parameters<typeof screenInput>[0]) {
  return referenceExistenceVerifier.verify(screenInput(init), SCREEN_CTX);
}

describe('S2 参照実在', () => {
  it('すべての参照が実在すれば通る', () => {
    const findings = run({
      domain: domain(),
      queries: [querySpec({ name: 'entry_own_list', source: 'entry', for: ['member'], scopeUsed: 'own' })],
      chromes: [chromeSpec({ name: 'member' })],
      screens: [
        screenSpec({
          name: 'entry_new',
          chrome: 'chrome-member',
          reads: ['query-entry-own-list'],
          actions: ['entry.create', 'entry.submit'],
          navigations: [{ on: 'entry.create.success', to: 'screen-entry-list' }],
        }),
        screenSpec({ name: 'entry_list' }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('予約 ID は集約名でも entity 名でも接地する（S10 の正規化はこの挙動が前提）', () => {
    // 集約ディレクトリ名 program / entity 名 program_item。どちらの書き方も接地として通る。
    const model = specModel([
      aggregate('program', { access: accessSpec('program_item', { creates: [create('organizer')] }) }),
    ]);

    const findings = run({
      domain: model,
      screens: [screenSpec({ name: 'a', actions: ['program.create', 'program_item.create'] })],
    });

    expect(findings).toEqual([]);
  });

  it('実在しない query_spec の参照を検出する', () => {
    const findings = run({
      domain: domain(),
      queries: [],
      screens: [screenSpec({ name: 'a', reads: ['query-missing'] })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('query-missing');
  });

  it('query_spec をまだ書いていない環境では reads を検査しない', () => {
    const findings = run({
      domain: domain(),
      queriesUnavailable: true,
      screens: [screenSpec({ name: 'a', reads: ['query-missing'] })],
    });

    expect(findings).toEqual([]);
  });

  it('ドメインに無い操作を検出する', () => {
    const findings = run({
      domain: domain(),
      screens: [screenSpec({ name: 'a', actions: ['entry.approve'] })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('entry.approve');
  });

  it('実在しない遷移先を検出する', () => {
    const findings = run({
      domain: domain(),
      screens: [screenSpec({ name: 'a', navigations: [{ on: 'cancel', to: 'screen-ghost' }] })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('screen-ghost');
  });

  it('on が指す操作を画面が宣言していなければ検出する', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({ name: 'a', navigations: [{ on: 'entry.submit.success', to: 'screen-a' }] }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('この画面は発火しません');
  });

  it('自由語彙の on は to の実在だけを見る', () => {
    const findings = run({
      domain: domain(),
      screens: [screenSpec({ name: 'a', navigations: [{ on: 'talk_time_ended', to: 'screen-a' }] })],
    });

    expect(findings).toEqual([]);
  });

  it('ドットを含むのに .success 形でない on をエラーにする(綴り違い)', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'a',
          actions: ['entry.submit'],
          navigations: [{ on: 'entry.submit.sucess', to: 'screen-a' }],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"{イベント ID}.success" の形ではありません');
  });

  it('操作の失敗では遷移できない(.failure をエラーにする)', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'a',
          actions: ['entry.submit'],
          navigations: [{ on: 'entry.submit.failure', to: 'screen-a' }],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"{イベント ID}.success" の形ではありません');
  });

  it('.success の前がドメインに接地しなければ失敗する', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'a',
          actions: ['entry.approve'],
          navigations: [{ on: 'entry.approve.success', to: 'screen-a' }],
        }),
      ],
    });

    // actions 側と on 側の両方が接地していないことを指す。
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.message.includes('entry.approve'))).toBe(true);
  });

  it('重ね表示だけが宣言した操作の .success も遷移に書ける(V9)', () => {
    // 1 例目(workshop_manage の中止確認)では、この形が書けないために同じ操作を
    // 画面と重ね表示の両方へ並べる二重宣言になっていた。
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'a',
          actions: [],
          slots: [{ slot: 'body.center', components: ['submit_bar'] }],
          overlays: [{ id: 'confirm', openedBy: 'submit_bar', actions: ['entry.submit'] }],
          navigations: [{ on: 'entry.submit.success', to: 'screen-a' }],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('画面にも重ね表示にも無い操作の .success はエラーにする(V9 で緩めすぎない)', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'a',
          actions: [],
          slots: [{ slot: 'body.center', components: ['submit_bar'] }],
          overlays: [{ id: 'confirm', openedBy: 'submit_bar', actions: ['entry.create'] }],
          navigations: [{ on: 'entry.submit.success', to: 'screen-a' }],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('この画面は発火しません');
  });

  it('snake_case でない自由語彙をエラーにする', () => {
    const findings = run({
      domain: domain(),
      screens: [screenSpec({ name: 'a', navigations: [{ on: 'Cancel', to: 'screen-a' }] })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('自由語彙の形式ではありません');
  });

  it('同じ on に 2 つの行き先があれば失敗する(決定性)', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'a',
          navigations: [
            { on: 'cancel', to: 'screen-a' },
            { on: 'cancel', to: 'screen-b' },
          ],
        }),
        screenSpec({ name: 'b' }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('on(cancel)が重複しています');
  });

  it('chrome から継承した遷移が画面の宣言と重なれば失敗する', () => {
    const findings = run({
      domain: domain(),
      chromes: [
        chromeSpec({ name: 'member', navigations: [{ on: 'signed_out', to: 'screen-login' }] }),
      ],
      screens: [
        screenSpec({
          name: 'a',
          chrome: 'chrome-member',
          navigations: [{ on: 'signed_out', to: 'screen-login' }],
        }),
        screenSpec({ name: 'login' }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toContain('chrome-member');
  });

  it('chrome から継承した遷移も遷移先の実在を見る', () => {
    const findings = run({
      domain: domain(),
      chromes: [
        chromeSpec({ name: 'member', navigations: [{ on: 'signed_out', to: 'screen-ghost' }] }),
      ],
      screens: [screenSpec({ name: 'a', chrome: 'chrome-member' })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toContain('直すのは chrome の側');
  });

  it('opened_by が layout の部品に無ければ失敗する', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'a',
          slots: [{ slot: 'body.center', components: ['report_button'] }],
          overlays: [
            { id: 'ok_dialog', openedBy: 'report_button' },
            { id: 'ng_dialog', openedBy: 'ghost_button' },
          ],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('ghost_button');
  });

  it('closes_on は navigations の on と同じ語彙で接地する', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'a',
          actions: ['entry.submit'],
          slots: [{ slot: 'body.center', components: ['submit_bar'] }],
          overlays: [
            {
              id: 'confirm',
              openedBy: 'submit_bar',
              actions: ['entry.submit'],
              closesOn: ['entry.submit.success', 'cancel'],
            },
          ],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('closes_on の綴り違い(.sucess)をエラーにする', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'a',
          actions: ['entry.submit'],
          slots: [{ slot: 'body.center', components: ['submit_bar'] }],
          overlays: [
            {
              id: 'confirm',
              openedBy: 'submit_bar',
              actions: ['entry.submit'],
              closesOn: ['entry.submit.sucess'],
            },
          ],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('overlays(confirm)の closes_on');
    expect(findings[0]?.message).toContain('"{イベント ID}.success" の形ではありません');
  });

  it('この画面が発火しない操作の結果では閉じられない', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'a',
          actions: ['entry.submit'],
          slots: [{ slot: 'body.center', components: ['submit_bar'] }],
          overlays: [
            {
              id: 'confirm',
              openedBy: 'submit_bar',
              actions: ['entry.submit'],
              closesOn: ['entry.create.success'],
            },
          ],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('この画面は発火しません');
  });

  it('実在しない chrome を検出する', () => {
    const findings = run({
      domain: domain(),
      screens: [screenSpec({ name: 'a', chrome: 'chrome-ghost' })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('chrome-ghost');
  });
});

describe('S2: 読み取りクエリ(query_spec)が阻害のとき(入力の状態の保留)', () => {
  const missingRead = () => screenInput({ domain: domain(), queries: [], screens: [screenSpec({ name: 'a', reads: ['query-missing'] })] });

  it('読めていれば「reads の query-missing に対応する query_spec がありません」と言う(保留が効いている対)', () => {
    expect(referenceExistenceVerifier.verify(missingRead(), SCREEN_CTX).map((finding) => finding.message)).toEqual([
      expect.stringContaining('query-missing に対応する query_spec がありません'),
    ]);
  });

  it('阻害なら reads の実在は言わない(落とした query を「無い」と言わない。ほかの参照は従来どおり)', () => {
    const blocked = { ...SCREEN_CTX, blockedInputs: ['queries'] } as const;

    expect(referenceExistenceVerifier.verify(missingRead(), blocked)).toEqual([]);
    const brokenChrome = screenInput({ domain: domain(), queries: [], screens: [screenSpec({ name: 'a', reads: ['query-missing'], chrome: 'chrome-nowhere' })] });
    expect(referenceExistenceVerifier.verify(brokenChrome, blocked).map((finding) => finding.message)).toEqual([expect.stringContaining('chrome-nowhere')]);
  });
});

describe('S2 と platform_op のきっかけ', () => {
  it('platform_op.{id}.success は、ドメインイベントでなくても S2 では接地を問わない(実在は S20 が見る)', () => {
    const findings = run({
      domain: domain(),
      screens: [
        screenSpec({
          name: 'sessions',
          navigations: [{ on: 'platform_op.session.end_mine.success', to: 'screen-sessions' }],
          overlays: [{ id: 'confirm', openedBy: 'bar', closesOn: ['platform_op.session.end_others.success'] }],
          slots: [{ slot: 'body.center', components: ['bar'] }],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('platform_op. で始まっても .success 形でないドット付きのきっかけは、ほかと同じく S2 が形の誤りとして落とす', () => {
    const findings = run({ domain: domain(), screens: [screenSpec({ name: 'sessions', navigations: [{ on: 'platform_op.session.end_mine', to: 'screen-sessions' }] })] });

    expect(findings.some((finding) => finding.message.includes('"{イベント ID}.success" の形ではありません'))).toBe(true);
  });
});
