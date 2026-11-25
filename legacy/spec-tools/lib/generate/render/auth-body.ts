/**
 * 認証フロー仕様(docs/specs/backend/auth.md)の本文ブロックの生成器。
 *
 * YAML フロントマターが正であり、本文はその展開にすぎない(生成は情報を足さない)。
 * 出すのは 4 つ — **サインインの方式**・**分岐図**(決定表を図にしたもの)・**分岐の全数**・**着地と関門**(OAuth の帰り道の口を宣言していれば、その節も)。
 * 図は表と同じ宣言を別の姿で見せているだけで、図にしか無い情報は 1 つも無い
 * (条件の日本語は値域の語に 1 対 1 で対応する表示名である)。
 */

import { trustSnippet } from '../../kernel/trusted-html.js';
import type { SpecModel } from '../../model/types.js';
import { escapeMermaid } from './screen-nav-graph.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { AuthAxisDecl, AuthFlowSpec, AuthGateDecl, SignInBranchDecl } from '../../model/auth/types.js';
import { absentValue, axisLabel, subjectAxis } from '../../model/auth/types.js';
import { mfaScopeWords } from '../../model/auth/mfa.js';
import { idpSessionSection, sessionsSection } from './auth-session-sections.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先(リポジトリルート相対)。 */
export function authFile(roots: ProductRoots): string {
  return specPath(roots, 'backend/auth.md');
}

/** `guards: requires_auth` の表示名(role を見ない関門はこの 1 つだけ)。 */
const REQUIRES_AUTH_TEXT = '画面仕様の `requires_auth: true`';

/** 関門が守る対象の表示名。`role_gate` は宣言した `role`(roles.md の任意のロール)を差し込む。 */
function guardsText(gate: AuthGateDecl): string {
  if (gate.guards === 'requires_auth') return REQUIRES_AUTH_TEXT;
  return `画面仕様の \`for: [${gate.role ?? '{role}'}]\``;
}

/** 関門を通れなかった人の扱いの表示名。 */
const ON_FAIL_TEXT: Readonly<Record<string, string>> = {
  redirect: '送り返す',
  not_found: '無いものとして扱う(not found)',
};

/**
 * 主語の軸の値の表示(表示名は仕様の `labels` が持つ)。
 *
 * ここに表示名の対応表を体系側が持っていた間、別のシステムの生成物にもこちらのアプリの語が
 * 出ていた(W1 の出力側の目で実測)。表示名の正は `axes[].labels` である。
 */
function subjectText(flow: AuthFlowSpec, branch: SignInBranchDecl): string {
  const axis = subjectAxis(flow);
  if (axis === undefined) return '—';
  return axisLabel(axis, branch.values[axis.id] ?? absentValue(flow));
}

/** 1 行の条件(主語以外の軸)を宣言順に並べた表示。 */
function conditionText(flow: AuthFlowSpec, branch: SignInBranchDecl): string {
  const subject = subjectAxis(flow);
  const parts = flow.axes
    .filter((axis: AuthAxisDecl) => axis.id !== subject?.id)
    .map((axis) => {
      const value = branch.values[axis.id];
      return value === undefined ? null : axisLabel(axis, value);
    })
    .filter((part): part is string => part !== null);
  return parts.length === 0 ? '—' : parts.join(' / ');
}

/** 決定表を図にしたもの(同じ宣言の別の姿)。 */
function flowSection(flow: AuthFlowSpec): string {
  const heading = escapeMermaid(subjectAxis(flow)?.summary ?? '主語');
  const lines = ['flowchart TD', `  signin(["サインイン成功"]) --> subject{"${heading}"}`];
  for (const branch of flow.branches) {
    const condition = conditionText(flow, branch);
    const label = escapeMermaid(`${subjectText(flow, branch)}${condition === '—' ? '' : ` / ${condition}`}`);
    if (branch.runs.length === 0) {
      lines.push(`  subject -->|"${label}"| land_${branch.lands}`);
      continue;
    }
    lines.push(`  subject -->|"${label}"| run_${branch.id}[["${branch.runs.join('<br/>')}"]]`);
    lines.push(`  run_${branch.id} --> land_${branch.lands}`);
  }
  for (const landing of flow.landings) {
    lines.push(`  land_${landing.id}["${landing.id}<br/>${landing.screen}"]`);
  }
  return ['### サインインの分岐(決定表を図にしたもの)', '', trustSnippet(['```mermaid', ...lines, '```'].join('\n'))].join('\n');
}

/** 分岐の全数(1 行 = 決定表の 1 行)。 */
function branchSection(flow: AuthFlowSpec): string {
  const rows = flow.branches.map((branch) => [
    cell(`\`${branch.id}\``),
    cell(subjectText(flow, branch)),
    cell(conditionText(flow, branch)),
    cell(branch.runs.map((event) => `\`${event}\``).join(', ') || '—'),
    cell(`\`${branch.lands}\``),
    cell(branch.summary),
  ]);
  return [
    '### 分岐の全数(主語の全状態を尽くしている。H1 が全域性を見る)',
    '',
    markdownTable(['分岐 ID', '主語', '条件', '実行する操作', '着地', '何が起きるか'], rows),
  ].join('\n');
}

/** 着地の全数(画面仕様の排他表示と双方向に閉じている)。 */
function landingSection(flow: AuthFlowSpec): string {
  const rows = flow.landings.map((landing) => [
    cell(`\`${landing.id}\``),
    cell(`\`${landing.screen}\``),
    cell(landing.variant === undefined ? '—' : `\`${landing.variant}\``),
    cell(landing.summary),
  ]);
  return [
    '### 着地(サインインの結末。案内画面の出し分けと双方向に閉じている)',
    '',
    markdownTable(['着地 ID', '着地する画面', '画面の出し分け', 'どういう結末か'], rows),
  ].join('\n');
}

/** 関門の全数(画面に入るときの資格)。 */
function gateSection(flow: AuthFlowSpec): string {
  const rows = flow.gates.map((gate) => [
    cell(`\`${gate.id}\``),
    cell(guardsText(gate)),
    cell(ON_FAIL_TEXT[gate.onFail] ?? gate.onFail),
    cell(gate.to === undefined ? '—' : `\`${gate.to}\``),
    cell(`\`${gate.implementation}\``),
    cell(gate.summary),
  ]);
  return [
    '### 画面に入るときの関門(サインイン済みの人に対する資格の確認)',
    '',
    markdownTable(['関門 ID', '何が呼ぶか', '通れなかった人', '送り先', '実装', 'どういう関門か'], rows),
  ].join('\n');
}

/**
 * 認証の口(`callback` / `start` / `logout`)。どれも宣言が無い(OAuth でないサインインの仕組み)なら節ごと出さない。
 * 口の置き場は配置が決める(ここは URL だけ — 実装の木の入口が宣言に当たることは J2 の閉世界が見る)。
 */
function callbackSection(flow: AuthFlowSpec): string | null {
  const entries = [
    { key: 'callback', what: 'OAuth の帰り道(GET。別のサイトから来るのが正しい。守りは PKCE の検証子)', decl: flow.callback },
    { key: 'start', what: 'サインインの開始(POST。要求の出どころを確かめる)', decl: flow.start },
    { key: 'logout', what: 'ログアウト(POST。要求の出どころを確かめる)', decl: flow.logout },
  ].flatMap(({ key, what, decl }) => (decl === undefined ? [] : [[cell(key), cell(what), cell(`\`${decl.endpoint}\``), cell(decl.summary)]]));
  if (entries.length === 0) return null;
  return [
    '### 認証の口(OAuth の帰り道・サインインの開始・ログアウト。どれもサーバーの口で、ブラウザは認証基盤に直接つながない)',
    '',
    markdownTable(['宣言', '口の種類', '口(URL)', 'どういう口か'], entries),
  ].join('\n');
}

/**
 * 受け入れるサインインの方式(`providers`)と、ローカルでだけ開けてよい方式(`local_only`)。
 * プラットフォームの設定で開いている方式がこの全数に収まっていること(H5)の、人が読む側。
 */
function providersSection(flow: AuthFlowSpec): string {
  const rows = [
    ...flow.providers.map((provider) => [cell(`\`${provider}\``), cell('本番でも受け入れる')]),
    ...flow.localOnly.map((entry) => [cell(`\`${entry.method}\``), cell(`ローカル(開発・テスト)の設定でだけ開けてよい。本番では開けない — ${entry.reason}`)]),
  ];
  return [
    '### サインインの方式(宣言に無い方式が設定で開いていると H5 が止める)',
    '',
    markdownTable(['方式', '扱い'], rows),
  ].join('\n');
}

/**
 * 多要素認証(`mfa`)。読めなかった(H0 が言っている)なら節ごと出さない。外していれば・IdP に任せていれば理由ごと「受け入れた危険」と書く。
 */
function mfaSection(flow: AuthFlowSpec): string | null {
  const mfa = flow.mfa;
  if (mfa === undefined) return null;
  const heading = '### 多要素認証(外す宣言・IdP に任せる宣言は verify が毎回「受け入れた危険」として名指す — H6)';
  if (mfa.kind === 'exempt') {
    return [heading, '', markdownTable(['扱い', '理由'], [[cell('外している(受け入れた危険)'), cell(mfa.reason)]])].join('\n');
  }
  if (mfa.kind === 'delegated') {
    return [
      heading,
      '',
      markdownTable(['扱い', '任せる IdP', '根拠', '理由'], [[cell('IdP に任せている(受け入れた危険)'), cell(`\`${mfa.provider}\``), cell('なし'), cell(mfa.reason)]]),
    ].join('\n');
  }
  return [
    heading,
    '',
    markdownTable(
      ['求める相手', '済ませていない人の送り先', '入場のたびに確かめる関数', 'どういう要求か'],
      [[cell(mfaScopeWords(mfa.scope)), cell(`\`${mfa.to}\``), cell(`\`${mfa.implementation}\``), cell(mfa.summary)]],
    ),
  ].join('\n');
}

/** テストケースの台帳。 */
function testCaseSection(flow: AuthFlowSpec): string {
  const rows = flow.testCases.map((testCase) => [
    cell(testCase.id),
    cell(testCase.type),
    cell((testCase.covers ?? []).join(', ')),
    cell(testCase.specIds.join(', ')),
    cell(`\`${testCase.implementation.raw}\``),
  ]);
  return [
    '### テストケース',
    '',
    markdownTable(['ID', 'type', 'covers', 'spec_ids', 'implementation'], rows),
  ].join('\n');
}

/**
 * 認証フロー仕様の本文ブロックを生成するジェネレーター。
 * 出力は auth.md の `auth-body` マーカー 1 か所。
 */
export const authBodyGenerator: DocGenerator = {
  id: 'auth-body',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const flow = ctx.auth?.flow;
    if (flow === undefined || flow === null) return [];
    return [
      {
        file: authFile(ctx.roots),
        marker: 'auth-body',
        content: [
          providersSection(flow),
          sessionsSection(flow),
          idpSessionSection(flow),
          mfaSection(flow),
          flowSection(flow),
          branchSection(flow),
          landingSection(flow),
          gateSection(flow),
          callbackSection(flow),
          testCaseSection(flow),
        ]
          .filter((section): section is string => section !== null)
          .join('\n\n'),
      },
    ];
  },
};
