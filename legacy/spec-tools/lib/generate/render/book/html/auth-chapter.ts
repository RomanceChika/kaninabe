/**
 * 「入るとどうなるか(認証)」の章の HTML 版。
 *
 * 骨格は
 * `layer-chapter.ts`。上段は条件の軸 1 本・分岐 1 行・着地 1 つ・関門 1 つ = 上段の 1 行(数える単位は `semantics/reading-layers.ts`)。
 * 導入の文はこのアプリの語を持たない(主語の呼び名は仕様の `axes` の `summary` から引く)。
 *
 * @oversize 超える理由: 認証の章は上段の単位が 4 種(条件の軸・分岐・着地・関門)あり、どれも同じ認証の流れの語(軸の呼び名・着地の名前)を
 *   引き合って 1 行を組む。4 種の行と章の数の出どころの言い方を 1 か所で突き合わせられる。
 * @split-review 割る案と結果: 4 種の行を組む部分を `auth-rows.ts` に割る案を検討した。行を組む関数を呼ぶのはこの章だけで、
 *   語の引き当て(軸・着地の表示名)を両方が持つことになるので、割らない。下段の表の行は別の部品から引き、ここでは組まない。
 */

import type { SpecModel } from '../../../../model/types.js';
import { allMachines } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { AuthAxisDecl, AuthFlowSpec, AuthGateDecl, AuthLandingDecl, SignInBranchDecl } from '../../../../model/auth/types.js';
import { axisLabel, declaredAxes, isSubjectKind, subjectAxis } from '../../../../model/auth/types.js';
import { IDP_WORDS } from '../../../../model/auth/idp-session.js';
import { mfaScopeWords } from '../../../../model/auth/mfa.js';
import { concurrentWords } from '../../../../model/auth/sessions.js';
import { authUnits, type LayerUnit } from '../../../../semantics/reading-layers.js';
import { collectSigns } from '../../../prose.js';
import { authFile } from '../../auth-body.js';
import { pendingFindings, pendingOfChapter } from '../finding-placement.js';
import { bookLayout } from '../face-scope.js';
import { specRelative } from '../face-sign.js';
import { bold, fold, kv, mono, pts, valueOf } from './face-parts.js';
import { axiomRow, items, layerChapter, type Outline } from './layer-chapter.js';
import { el, join, url, type Child, type Html } from './markup.js';
import { table, type ChapterBody } from './chapter-parts.js';

/** 章の題。 */
export const AUTH_TITLE = '入るとどうなるか(認証)';

/** ドメインイベント(`{machine}.{event}`)の表示名。 */
function eventLabel(model: SpecModel, ref: string): string {
  const [machineName, eventId] = ref.split('.');
  for (const { machine } of allMachines(model)) {
    if (machine.machine !== machineName) continue;
    const event = machine.events.find((candidate) => candidate.id === eventId);
    if (event !== undefined) return event.label ?? ref;
  }
  return ref;
}

/** ロールの表示名。 */
function roleLabel(model: SpecModel, id: string): string {
  return model.roles.roles.find((role) => role.id === id)?.label ?? id;
}

/** 軸を持つ行の条件(上段の行用)。 */
function presence(flow: AuthFlowSpec, axis: AuthAxisDecl): Child {
  if (axis.when !== undefined) {
    const owner = flow.axes.find((candidate) => candidate.id === axis.when?.axis);
    const value = owner === undefined ? axis.when.value : axisLabel(owner, axis.when.value);
    return join([`${owner?.summary ?? axis.when.axis} が ${value} の行だけ(`, mono(axis.when.axis), ' = ', mono(axis.when.value), ')']);
  }
  return axis.optional === true ? '確かめた行だけが持つ(任意)' : '全行が持つ';
}

/** 条件の軸 1 本。 */
function axisRow(flow: AuthFlowSpec, axis: AuthAxisDecl, unit: LayerUnit): Html {
  const values = (axis.values ?? []).map((value) => join([mono(value), ` ${axisLabel(axis, value)}`]));
  return axiomRow(
    mono(axis.id),
    [kv('決まること', axis.summary), kv('仕様の語', valueOf(values.length === 0 ? ['—'] : values)), kv('条件', presence(flow, axis))],
    unit.elements,
    `axis-${axis.id}`,
  );
}

/** 分岐 1 行。 */
function branchRow(model: SpecModel, flow: AuthFlowSpec, branch: SignInBranchDecl, unit: LayerUnit): Html {
  const conditions = flow.axes.flatMap((axis) => {
    const value = branch.values[axis.id];
    return value === undefined ? [] : [`${axis.summary} ${axisLabel(axis, value)}`];
  });
  const runs = branch.runs.map((event) => join([`${eventLabel(model, event)} `, mono(event)]));
  return axiomRow(
    mono(branch.id),
    [
      kv('決まること', branch.summary),
      kv('条件', valueOf(conditions.length === 0 ? ['—'] : conditions)),
      runs.length === 0 ? null : kv('仕様の語', join(['実行する操作 ', valueOf(runs)])),
      kv('どこへ', el('a', { href: url(`#landing-${branch.lands}`) }, mono(branch.lands))),
    ],
    unit.elements,
  );
}

/** 分岐の行を、主語の軸の値ごとにまとめて並べる。 */
function branchRows(model: SpecModel, flow: AuthFlowSpec, units: ReadonlyMap<string, LayerUnit>): Child[] {
  const row = (branch: SignInBranchDecl): Html | null => {
    const unit = units.get(`branch:${branch.id}`);
    return unit === undefined ? null : branchRow(model, flow, branch, unit);
  };
  const subject = subjectAxis(flow);
  if (subject === undefined) return flow.branches.map(row);
  const order = [...new Set([...Object.keys(subject.labels ?? {}), ...flow.branches.map((branch) => branch.values[subject.id] ?? '')])];
  return order.flatMap((value) => {
    const group = flow.branches.filter((branch) => (branch.values[subject.id] ?? '') === value);
    if (group.length === 0) return [];
    return [el('p', { class: 'bf-group' }, axisLabel(subject, value), el('small', null, `${value} · ${group.length} 行`)), ...group.map(row)];
  });
}

/** 着地 1 つ。 */
function landingRow(flow: AuthFlowSpec, landing: AuthLandingDecl, unit: LayerUnit): Html {
  const arrivals = flow.branches.filter((branch) => branch.lands === landing.id).length;
  const where = [join(['画面 ', mono(landing.screen)]), landing.variant === undefined ? null : join(['出し分け ', mono(landing.variant)])].filter((item) => item !== null);
  return axiomRow(
    mono(landing.id),
    [kv('決まること', landing.summary), kv('どこへ', valueOf(where)), kv('補足', `この着地に着く分岐は ${arrivals} 行`)],
    unit.elements,
    `landing-${landing.id}`,
  );
}

/** 関門 1 つ。 */
function gateRow(model: SpecModel, gate: AuthGateDecl, unit: LayerUnit): Html {
  const check = gate.guards === 'requires_auth' ? 'ログインしていること' : `${roleLabel(model, gate.role ?? gate.id)}であること`;
  return axiomRow(
    mono(gate.id),
    [kv('決まること', gate.summary), kv('条件', check), kv('どこへ', gate.onFail === 'redirect' ? join([mono(gate.to ?? '—'), ' へ送り返す']) : '無いものとして扱う(not found)')],
    unit.elements,
  );
}

/** 軸の値(表示名つき。下段の表)。 */
function axisValues(axis: AuthAxisDecl): Child {
  const labels = Object.entries(axis.labels ?? {});
  if (labels.length > 0) return join(labels.map(([id, label], index) => join([index === 0 ? null : ', ', mono(id), `(${label})`])));
  const values = axis.values ?? (axis.absent === undefined ? [] : [axis.absent]);
  return values.length === 0 ? '—' : join(values.map((value, index) => join([index === 0 ? null : ', ', mono(value)])));
}

/** 軸を持つ行の条件(下段の表)。 */
function axisPresence(axis: AuthAxisDecl): Child {
  if (axis.when !== undefined) return join([mono(axis.when.axis), ' が ', mono(axis.when.value), ' の行だけ']);
  return axis.optional === true ? '確かめた行だけ(任意)' : '全行';
}

/** 下段(主語の軸・関門の実装・テスト)。 */
function lower(flow: AuthFlowSpec): {
  readonly blocks: readonly Child[];
  readonly count: number;
} {
  const axisRows = flow.axes.filter(isSubjectKind).map((axis) => [mono(axis.id), mono(axis.kind), axis.summary, axisValues(axis), axisPresence(axis)]);
  const gateRows = flow.gates.map((gate) => [
    mono(gate.id),
    gate.guards === 'requires_auth' ? mono('requires_auth') : join([mono('role_gate'), '(', mono(gate.role ?? '—'), ')']),
    mono(gate.implementation),
  ]);
  const testRows = flow.testCases.map((testCase) => [testCase.id, testCase.type, mono(testCase.implementation.raw)]);
  return {
    count: axisRows.length + gateRows.length + testRows.length,
    blocks: [
      fold(
        {
          kind: 'table',
          title: '主語の軸',
          count: axisRows.length,
          hint: '値の全体は状態機械などが決める(直接宣言する軸は上段)',
          element: 'auth.axis',
        },
        axisRows.length === 0 ? [] : [table(['軸', '種類', '何を表すか', '値(表示名)', '持つ行'], axisRows)],
      ),
      fold(
        {
          kind: 'table',
          title: '関門の実装',
          count: gateRows.length,
          hint: '画面仕様の宣言と実装の突合',
          element: 'auth.implementation',
        },
        gateRows.length === 0 ? [] : [table(['関門', '守る対象', '実装'], gateRows)],
      ),
      fold(
        {
          kind: 'table',
          title: 'テスト(宣言と実装の突合)',
          count: testRows.length,
          hint: '仕様の test_cases の行数',
          element: 'auth.tests',
        },
        testRows.length === 0 ? [] : [table(['ID', 'type', '実装'], testRows)],
      ),
    ],
  };
}

/** 多要素認証の宣言の行の中身。 */
function mfaLines(mfa: NonNullable<AuthFlowSpec['mfa']>): readonly Child[] {
  if (mfa.kind === 'delegated') {
    return [
      join([bold('IdP ', mono(mfa.provider), ' に任せている'), `(受け入れた危険)。理由: ${mfa.reason}`]),
      'アプリ側で 2 つ目の要素は求めない。根拠は無く、IdP の多要素認証が今回のログインで使われたかは確かめられない。任せる先以外の方式で入る人には要素が 1 つも掛からないので、本番の方式はこの IdP だけに限る(ほかの方式があれば H6 が止める)。verify が毎回 H6 の警告で名指す',
    ];
  }
  if (mfa.kind === 'exempt') {
    return [join([bold('外している'), `(受け入れた危険)。理由: ${mfa.reason}`]), 'サインインは 1 つの要素だけで済む。verify が毎回 H6 の警告で名指す'];
  }
  return [
    join([`${mfaScopeWords(mfa.scope)}に求める。多要素認証を済ませていないセッションの人は `, mono(mfa.to), ' へ送る(入場のたびに ', mono(mfa.implementation), ' が確かめる)']),
    mfa.summary,
    '多要素認証を済ませたかの正は認証基盤のセッションの水準(サインインの方式ごとの設定ではない)。送り先と関数の接地は H6、設定で要素が有効かは H5 が見る。公理には数えない',
  ];
}

/** プラットフォームの設定と突き合わせる宣言の行(方式 → 寿命 → IdP とのセッションの関係 → 多要素認証)。 */
function settingsRows(flow: AuthFlowSpec): (readonly [Child, Child])[] {
  const rows: (readonly [Child, Child])[] = [
    [
      bold('サインインの方式'),
      items([
        join(['本番でも受け入れる方式は ', join(flow.providers.map((provider, index) => join([index === 0 ? null : '・', mono(provider)])))]),
        ...flow.localOnly.map((entry) => join(['ローカル(開発・テスト)の設定でだけ開けてよい方式は ', mono(entry.method), `(本番では開けない)。理由: ${entry.reason}`])),
        '宣言に無い方式がプラットフォームの設定で開いていると H5 が止める。本番の管理画面の設定は検査できない(ローカル専用の方式があれば実行ログが毎回名指す)。方式は公理には数えない',
      ]),
    ],
  ];
  const sessions = flow.sessions;
  if (sessions !== undefined) {
    rows.push([
      bold('セッションの寿命'),
      items([
        join([
          '無操作の時間切れは ',
          mono(sessions.inactivity),
          '(最後にセッションを更新したときから)、絶対の寿命は ',
          mono(sessions.absolute),
          '(サインインしたときから。更新トークンもここで使えなくなる)',
        ]),
        `理由: ${sessions.reason}`,
        `同時に持てるセッションの数は ${concurrentWords(sessions.concurrent)}。理由: ${sessions.concurrent.reason}`,
        'プラットフォームの設定が同じ値でないと H5 が止める。同時セッションの数は設定ファイルに書く場所が無く、H5 は見ていないと名指す。本番の管理画面の設定は検査できない(実行ログが毎回名指す)。寿命は公理には数えない',
      ]),
    ]);
  }
  const idp = flow.idpSession;
  if (idp !== undefined) {
    rows.push([
      bold('IdP とのセッションの関係'),
      items([
        IDP_WORDS[idp.logout],
        IDP_WORDS[idp.idpEnds],
        IDP_WORDS[idp.lifetime],
        `理由: ${idp.reason}`,
        '書けるのはいまの仕組みが支えられる主張だけ(H0)。IdP の側の実際の挙動は検査では見えない。公理には数えない',
      ]),
    ]);
  }
  if (flow.mfa !== undefined) rows.push([bold('多要素認証'), items(mfaLines(flow.mfa))]);
  return rows;
}

/** 上段の本体(条件の軸 → 分岐 → 着地 → 関門)。 */
function upper(model: SpecModel, flow: AuthFlowSpec, units: ReadonlyMap<string, LayerUnit>, outline: Outline): Child[] {
  const subject = subjectAxis(flow);
  const conditionAxes = declaredAxes(flow);
  const pick = <T extends { readonly id: string }>(kind: string, list: readonly T[], render: (item: T, unit: LayerUnit) => Html): Child[] =>
    list.map((item) => {
      const unit = units.get(`${kind}:${item.id}`);
      return unit === undefined ? null : render(item, unit);
    });
  return [
    conditionAxes.length === 0
      ? null
      : [
          outline.h3('axes', `分岐の条件に使う軸(${conditionAxes.length})`),
          pts(
            [
              `分岐の条件は、${subject === undefined ? '主語' : subject.summary}と、ここに載せた軸の値の組で決まる`,
              '軸の値と、どの行がその軸を持つかは、この仕様が直接宣言している。照合する相手は他に無い',
              join([mono('verify'), ' の H1 は、この宣言を前提にして、条件の組が漏れなく扱われているかを見る']),
            ],
            true,
          ),
          pick('axis', conditionAxes, (axis, unit) => axisRow(flow, axis, unit)),
        ],
    outline.h3('branches', `サインインしたとき(${flow.branches.length})`),
    pts(
      [
        'この表は上から順に読むものではない',
        '各行は、条件が揃えば結末が決まる独立した行',
        join(['同じ条件の行は 2 つ存在しない。', mono('verify'), ' の H0 が落とす']),
        '1 行だけを取り出して試せる。実装との突合は、この表をそのまま回している',
      ],
      true,
    ),
    branchRows(model, flow, units),
    outline.h3('landings', `どこへ着くか(${flow.landings.length})`),
    pick('landing', flow.landings, (landing, unit) => landingRow(flow, landing, unit)),
    outline.h3('gates', `画面に入るときの関門(${flow.gates.length})`),
    pts(['サインインのあとに、もう 1 つ関門がある', '画面ごとの確認で、通れなかった人がどう扱われるかも、ここで宣言する'], true),
    pick('gate', flow.gates, (gate, unit) => gateRow(model, gate, unit)),
  ];
}

/**
 * 認証の章の本文と目次。認証の仕様が読めていなければ、その旨の 1 行だけ。
 *
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function authChapter(model: SpecModel, ctx: GenerateContext, flow: AuthFlowSpec | null, countKey: string, file: string): ChapterBody {
  if (flow === null) {
    return {
      body: join([el('h1', null, AUTH_TITLE), el('p', null, 'まだ認証フロー仕様を読めていない(スキーマエラーを直すと、ここに一覧が生成される)。')]),
      headings: [],
    };
  }
  const units = new Map(authUnits(flow).map((unit) => [unit.id, unit] as const));
  const specFile = authFile(ctx.roots);
  const all = pendingFindings(ctx);
  const subject = subjectAxis(flow);
  const conditionAxes = declaredAxes(flow);
  const below = lower(flow);
  return layerChapter(model, ctx, {
    title: AUTH_TITLE,
    countKey,
    file,
    crumb: { layer: '認証の章', count: `分岐は ${flow.branches.length} 行` },
    intro: [
      'サインインしたときに起こりうることは、この一覧に載っているものが全部',
      `${subject?.summary ?? '主語の状態'}は 1 つ残らず扱われている`,
      join(['その状態の人がログインしたらどうなるか分からない、という穴は残せない。', mono('verify'), ' の H1 が全域性を見る']),
      '人が押すのはログインの 1 つだけ。そのあとの実行と行き先の振り分けは、システムが勝手に行う',
      '行ごとに、どんな人が入ってきたとき、何が起きて、どこへ着くかを読む',
    ],
    axiomBreakdown: `条件の軸 ${conditionAxes.length}、分岐 ${flow.branches.length} 行、着地 ${flow.landings.length}、関門 ${flow.gates.length}`,
    upperBullets: [
      '条件の軸が先頭。分岐の条件に使う言葉の、取りうる値と持つ行を宣言する',
      '分岐 1 行が上段の 1 行。条件、勝手に起きること、着地を並べる',
      '着地の宣言と、画面に入るときの関門の宣言も公理',
      '条件の軸では、値が現実を尽くしているかを人が判定する',
      '人が判定するのは、この人がここへ着いてよいか、通れない人の扱いがそれでよいか',
      '機械が保証するのは、条件の全域性と、着地先の画面の実在だけ。軸の値そのものは、機械が現実と照合できない',
    ],
    upper: (outline) => upper(model, flow, units, outline),
    accept: {
      groups: [],
      pending: all === null ? null : pendingOfChapter(all, model, ctx.roots, countKey, bookLayout(model, ctx)),
      signsDecision: collectSigns(ctx.specSources?.get(specFile) ?? '').length,
      signFiles: [specFile],
      signPlaces: '認証の仕様',
    },
    reasonedWords: '認証の仕様に、理由を書く欄は無い',
    lower: below.blocks,
    derived: {
      count: below.count,
      lines: [
        `主語の軸の表 ${flow.axes.length - conditionAxes.length} 行、関門の実装の表 ${flow.gates.length} 行、テスト ${flow.testCases.length} 件`,
        '主語の軸の値の全体は状態機械などが決め、実装は決定表と突き合わせる',
      ],
    },
    originRows: [
      [
        bold('章の範囲'),
        items([
          join(['認証フロー ', mono(specRelative(specFile, ctx)), ' の 1 枚。ブロックは 1 つ']),
          `条件の軸 ${conditionAxes.length}、分岐 ${flow.branches.length} 行、着地 ${flow.landings.length}、関門 ${flow.gates.length}(軸は全部で ${flow.axes.length})`,
          bold('この章で「全部」と言うのは、このフローに載っている状況だけ'),
        ]),
      ],
      ...settingsRows(flow),
      ...(flow.callback === undefined
        ? []
        : [
            [
              bold('OAuth の帰り道'),
              items(
                [
                  join(['プロバイダから戻ってきた人を受ける口は ', mono(flow.callback.endpoint), `。${flow.callback.summary}`]),
                  flow.start === undefined ? null : join(['サインインを始める口は ', mono(flow.start.endpoint), `(POST)。${flow.start.summary}`]),
                  flow.logout === undefined ? null : join(['ログアウトの口は ', mono(flow.logout.endpoint), `(POST)。${flow.logout.summary}`]),
                  'セッションの cookie はスクリプトから読めない(HttpOnly)ので、開始もログアウトもサーバーの口で行う。ブラウザは認証基盤に直接つながない',
                  '口は着地の宣言の前段であり、公理には数えない(実装の木に口が実在することは J2 が見る)',
                ].filter((item) => item !== null),
              ),
            ] as const,
          ]),
      [
        bold('公理の数え方'),
        items([
          '数える単位は宣言 1 つ',
          '条件の軸は 1 本を 1 本と数える。値と持つ行を、この仕様が直接宣言する軸だけ(補助の軸。値の全体が別の宣言から来る主語の軸は数えない)',
          '分岐は 1 行を 1 本。条件、勝手に起きること、着地をまとめて 1 本',
          '着地と関門は 1 つを 1 本',
          '主語の軸は数えない。値の全体は状態機械などが決め、全域性は H1 が見るので、下段の表に出す',
          '勝手に起きる操作の中身は、操作の章と集約の章で読む。ここは実行するかどうかだけを宣言する',
          '仕様に残された手書きの判断は、標識として原文のまま出す',
        ]),
      ],
    ],
  });
}
