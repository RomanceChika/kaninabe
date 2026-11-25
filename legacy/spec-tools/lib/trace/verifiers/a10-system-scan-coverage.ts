/**
 * A10 system 遷移の走査網羅チェック。
 *
 * action-spec-writing.md の A10:「`by` に `system` を含む全イベントに、走査実装の宣言
 * (`scans`)か理由つきの免除(`unscanned`)がある」。
 *
 * `by: [system]` のイベントは Server Action の入口を持たないため A4 の母集合に入らない。
 * その結果、**誰も実装を要求しないイベント**が仕様に居座れる — 状態機械の上では
 * 「時刻が来れば締まる」と書いてあるのに、実際には実行する主体がどこにも無い、という状態である。
 * 人間の操作なら画面が無いことで気付くが、system の操作は気付く人がいない。
 *
 * そこで A4 の裏返しとして、system が起こせるイベントには
 * 「どのモジュールが実行するか(`scans[].implementation`)」の宣言を要求する。宣言が指す先の
 * 実在も見る(宣言だけあって実装が消えた状態を残さない)。まだ実装しない判断は正当なので、
 * 理由つきなら免除する(`unscanned`)。
 *
 * **発火元は 3 つある**(束 ⑲-2b)。時刻で起きる走査(`scans`)のほかに、外部連携カタログの
 * 受信の行(`direction: inbound` の `emits`)が「外から届いて起きる」を宣言する。受信の
 * `emits` に挙がったイベントはそれ自体が「誰が起こすのか」の宣言なので、走査の宣言も免除も
 * 要らない —— 以前は意味の合わない器(`unscanned` の理由つき免除)を借りるしかなかった
 * (束 ⑱ のテナント題材の実測)。`emits` の側の接地(表・遷移・設定)は X5 が見る。
 */

import type { Finding, PartialInputTraceVerifier, PartialRun } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { ActionTestCase, TcRegistryEntry } from '../../testcase/types.js';
import { checkTestCaseTrace, groupByTcId } from '../../testcase/index.js';
import type { ScanDecl, UnscannedDecl } from '../../model/trace/types.js';
import type { TraceInput } from '../input.js';
import { inputValue, unusableOf } from '../../kernel/input-state.js';
import type { EventEntry } from '../../semantics/domain-index.js';
import type { SourceLocation } from '../../model/types.js';
import { listEvents, listSystemEvents } from '../../semantics/domain-index.js';

/**
 * A10: system が起こす全イベントに走査実装か理由宣言があるかを検証する。
 *
 * **第 3 の発火元(外部連携の受信の `emits`)にだけ一部が依る検査**である。外部連携が
 *   - **未選択**(製品が受信を採っていない)なら、第 3 の発火元は**事実として無い**。発火元の母集合は 2 本(`scans` /
 *     `unscanned`)で判定してよく、未実施の行も出さない(検査は全部実行している)。
 *   - **阻害**(採ったのに無い・読めない・壊れている)なら、受信の `emits` で起こされるイベントが**分からない**。
 *     走査の宣言も免除も無いイベントを「起こす口が無い」と報告すると、受信が起こしているイベントへの誤報になるので、
 *     その判定だけ出さず `gaps` で報告する。実装の実在・用済みの宣言・`test_cases` の突合は external に依らないので出す。
 */
export const systemScanCoverageVerifier: PartialInputTraceVerifier = {
  id: 'A10',
  title: '走査の網羅 — system が起こす全イベントに走査実装か理由がある',

  verify: (input) => systemScanRun(input).findings,
  runPartial: systemScanRun,
};

/** 検査の本体(違反と、外部連携が阻害のため判定を出さなかったイベントを返す)。 */
function systemScanRun(input: TraceInput): PartialRun {
  const scans = new Map(input.actions.scans.map((decl) => [decl.event, decl]));
  const unscanned = new Map(input.actions.unscanned.map((decl) => [decl.event, decl]));
  const inbound = inboundEmits(input);
  const blocked = input.external.state === 'blocked';
  const findings: Finding[] = [];
  const withheld: string[] = [];

  for (const entry of listSystemEvents(input.domain)) {
    if (scans.has(entry.id) || unscanned.has(entry.id) || inbound.has(entry.id)) continue;
    if (blocked) withheld.push(entry.id);
    else findings.push(missingScanFinding(entry));
  }
  findings.push(...missingImplementations(input, scans));
  findings.push(...staleDecls(input, scans, unscanned));
  findings.push(...scanTestCaseFindings(input));

  const gap = unusableOf(input.external, 'external');
  return {
    findings,
    gaps:
      gap === null || !blocked || withheld.length === 0
        ? []
        : [
            {
              gap,
              consequence:
                '受信の emits(第 3 の発火元)で起こされるイベントが分からないので、走査の宣言も免除も無いイベントの判定は出していません',
              subjects: withheld,
            },
          ],
  };
}

/**
 * 受信の連携が `emits` するイベント(第 3 の発火元)。
 *
 * カタログが使えない(未選択・阻害)ときは空集合になる。**空集合の意味は 2 つある**(未選択は「無い」という事実・
 * 阻害は「分からない」)ので、呼び手は外部連携の状態を見て区別する(`systemScanRun`)。
 */
function inboundEmits(input: TraceInput): ReadonlySet<string> {
  const integrations = inputValue(input.external)?.integrations ?? [];
  return new Set(
    integrations
      .filter((integration) => integration.direction === 'inbound')
      .map((integration) => integration.emits)
      .filter((emits): emits is string => emits !== undefined),
  );
}

/**
 * `scans[].test_cases`(テスト義務の全域化。任意宣言)の 3 段突合。
 *
 * system が起こすイベントは action_spec を持たないため、通常の test_cases の置き場(A6)が無い。
 * `scans[].test_cases` に書かれたケースを、A6 とまったく同じ 3 段(ファイルの実在 →
 * `@tc` の存在 → テスト名の一致。`checkTestCaseTrace` 共用)で突合するのがここの役目。
 * `test_cases` を書いていない scan(既存の宣言の大半)は対象に現れない——このキーは
 * 「書けるようにする」追加であり、宣言していない走査に義務を課さない。
 */
function scanTestCaseFindings(input: TraceInput): Finding[] {
  if (!input.tests.available) return [];
  const byTcId = groupByTcId(input.tests.annotations);
  const testFiles = new Set(input.tests.testFiles);
  const findings: Finding[] = [];

  for (const scan of input.actions.scans) {
    for (const testCase of scan.testCases ?? []) {
      const entry = toRegistryEntry(scan, testCase);
      findings.push(...checkTestCaseTrace(entry, byTcId.get(entry.tcId) ?? [], testFiles, 'A10'));
    }
  }
  return findings;
}

/** scans[].test_cases の 1 件を、共有の突合関数が読める形(TcRegistryEntry 相当)に写す。 */
function toRegistryEntry(scan: ScanDecl, testCase: ActionTestCase): TcRegistryEntry {
  return {
    tcId: testCase.id,
    specKind: 'action_spec',
    specId: `scan:${scan.event}`,
    specIds: testCase.specIds,
    implementation: testCase.implementation,
    location: testCase.location,
    specFile: scan.location.file,
  };
}

/** 走査実装も理由宣言も無いイベントの Finding。 */
function missingScanFinding(entry: EventEntry): Finding {
  return traceFinding('A10', {
    message: `${entry.id} は system が起こすイベントですが、走査の実装宣言(scans)がありません`,
    location: { file: entry.event.location.file, pointer: `events.${entry.event.id}` },
    suggestion:
      `specs/backend/actions/README.md のフロントマターに ` +
      `"scans: - event: ${entry.id} / implementation: {走査モジュールのパス}" を書く。` +
      `外から届く通知で起きるなら external.md の受信の行(direction: inbound)に ` +
      `"emits: ${entry.id}" を書く。まだ実装しないなら "unscanned: - event: ${entry.id} / reason: {理由}" を書く`,
    counterexample: { event: entry.id, by: entry.event.by.join(', ') },
  });
}

/**
 * 宣言された走査モジュールが実在するかを見る。
 *
 * app/ を走査できなかった環境では判定できないので何も言わない(A2 の実装側と同じ扱い)。
 */
function missingImplementations(
  input: TraceInput,
  scans: ReadonlyMap<string, ScanDecl>,
): Finding[] {
  if (!input.tests.available) return [];
  const files = new Set(input.tests.operationFiles);
  const findings: Finding[] = [];

  for (const decl of scans.values()) {
    if (files.has(decl.implementation)) continue;
    findings.push(
      traceFinding('A10', {
        message: `${decl.event} の走査として宣言された ${decl.implementation} が存在しません`,
        location: decl.location,
        suggestion:
          `implementation にはリポジトリルートからの相対パスで operation のモジュールを書く` +
          `(例: app/src/operation/{aggregate}/{event}.ts)。移動したなら宣言を追随させる`,
        counterexample: { event: decl.event, implementation: decl.implementation },
      }),
    );
  }
  return findings;
}

/**
 * 用済み・矛盾した宣言を洗い出す。
 *
 * 走査ができたのに免除が残っている / system が起こさないイベントの宣言がある、の 2 つ。
 * どちらも仕様の矛盾ではなく掃除漏れなので warning にする。
 */
function staleDecls(
  input: TraceInput,
  scans: ReadonlyMap<string, ScanDecl>,
  unscanned: ReadonlyMap<string, UnscannedDecl>,
): Finding[] {
  const systemEvents = new Set(listSystemEvents(input.domain).map((entry) => entry.id));
  const known = new Set(listEvents(input.domain).map((entry) => entry.id));
  const findings: Finding[] = [];

  for (const [event, decl] of unscanned) {
    if (!scans.has(event)) continue;
    findings.push(
      traceFinding('A10', {
        severity: 'warning',
        message: `${event} には走査の実装宣言があるのに unscanned の理由宣言が残っています`,
        location: decl.location,
        suggestion: `README.md の unscanned から ${event} の項目を削除する`,
        counterexample: { event, reason: decl.reason },
      }),
    );
  }

  for (const declared of declaredEvents(scans, unscanned)) {
    if (systemEvents.has(declared.event)) continue;
    findings.push(
      traceFinding('A10', {
        severity: 'warning',
        message: known.has(declared.event)
          ? `${declared.key} に書かれた ${declared.event} は system が起こすイベントではありません(by に system がありません)`
          : `${declared.key} に書かれた ${declared.event} は state_spec に存在しないイベントです`,
        location: declared.location,
        suggestion:
          `ID の綴りと state_spec の by を確認し、system が起こすもの` +
          `(${[...systemEvents].join(', ') || 'なし'})へ直すか項目を削除する`,
        counterexample: { event: declared.event },
      }),
    );
  }
  return findings;
}

/** 宣言 1 件を、どちらのキーに書かれていたかとあわせて表したもの。 */
interface DeclaredEvent {
  readonly key: 'scans' | 'unscanned';
  readonly event: string;
  readonly location: SourceLocation;
}

/** 宣言されたイベントを並べる(両方に書かれている場合は scans の側だけを見る)。 */
function declaredEvents(
  scans: ReadonlyMap<string, ScanDecl>,
  unscanned: ReadonlyMap<string, UnscannedDecl>,
): DeclaredEvent[] {
  const declared: DeclaredEvent[] = [...scans.values()].map((decl) => ({
    key: 'scans' as const,
    event: decl.event,
    location: decl.location,
  }));
  for (const decl of unscanned.values()) {
    if (scans.has(decl.event)) continue;
    declared.push({ key: 'unscanned', event: decl.event, location: decl.location });
  }
  return declared;
}
