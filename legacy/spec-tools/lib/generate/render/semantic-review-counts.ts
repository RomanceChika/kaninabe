/**
 * 意味レビューの集計部(仕様モデル → ファイルごとの「人間の判断が乗る宣言」の件数)。
 *
 * 数え方の正は system-spec-route.md の「保証マップ」節であり、ここはその太字
 * (機械が正しさを判定できない宣言)の機械的な写しである。判断の中身は読まず件数だけを
 * 数える(生成は情報を足さない原則)。章ごとの整形はハンドブックの
 * レビューの手引き(render/book/review-guide.ts)が行う。
 */

import type { AccessSpec, AggregateSpecs, SpecModel } from '../../model/types.js';
import { systemRoleId } from '../../model/role-hierarchy.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import type { ScreenLayout } from '../../model/screen/types.js';

/** 内訳の 1 部(`ラベル 件数`)。章単位の合算(レビューの手引き)がラベルで束ねる。 */
export interface LedgerPart {
  readonly label: string;
  readonly count: number;
}

/** 台帳の 1 行(1 仕様ファイル)分の集計結果。 */
export interface LedgerEntry {
  /** 仕様ファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 内訳の表記(例: `reads 4・うち scope:all 1・creates 1`)。宣言 0 件は `0`。 */
  readonly breakdown: string;
  /** 内訳(0 件の部は含めない)。「うち scope:all」は reads の内数で、総数には足さない。 */
  readonly parts: readonly LedgerPart[];
  /** 人間の判断が乗る宣言の総数。標識と併せて「読み飛ばし可」の判定に使う。 */
  readonly declCount: number;
}

/** reads の内数を表すラベル(総数に足さない部)。 */
const WIDE_READS_LABEL = 'うち scope:all';

/** `ラベル 件数` の組。0 件の部は表記から落とす。 */
type Part = readonly [string, number];

/** 内訳と総数を組み立てる。全部 0 なら `0` 1 文字にする。 */
function entry(file: string, rawParts: readonly Part[]): LedgerEntry {
  const parts = rawParts.filter(([, count]) => count > 0).map(([label, count]) => ({ label, count }));
  const declCount = parts.reduce((sum, part) => sum + part.count, 0);
  return { file, breakdown: breakdownText(parts), parts, declCount };
}

/** 内訳の表記(`ラベル 件数` を「・」区切りで並べる)。 */
export function breakdownText(parts: readonly LedgerPart[]): string {
  return parts.length === 0 ? '0' : parts.map((part) => `${part.label} ${part.count}`).join('・');
}

/** access_spec: reads(scope: all は内数として併記)・creates・writes・deletes の宣言数。 */
function accessEntry(access: AccessSpec, systemRole: string | undefined): LedgerEntry {
  // 内部実行のロール(role_spec の kind: system)。全件読み取りが前提で人間の判断が乗らないため reads の集計から外す。
  const reads = access.reads.filter((rule) => rule.by !== systemRole);
  const wide = reads.filter((rule) => rule.scope.kind === 'all').length;
  const rest: Part[] = [
    ['creates', access.creates.length],
    ['writes', access.writes.length],
    ['deletes', access.deletes.length],
  ];
  const parts: LedgerPart[] = [
    ...(reads.length === 0 ? [] : [{ label: 'reads', count: reads.length }]),
    // scope: all は露出が一段跳ね上がる宣言なので内数として必ず併記する(総数には足さない)
    ...(wide === 0 ? [] : [{ label: WIDE_READS_LABEL, count: wide }]),
    ...rest.filter(([, count]) => count > 0).map(([label, count]) => ({ label, count })),
  ];
  const declCount = parts
    .filter((part) => part.label !== WIDE_READS_LABEL)
    .reduce((sum, part) => sum + part.count, 0);
  return { file: access.location.file, breakdown: breakdownText(parts), parts, declCount };
}

/** 1 集約のドメイン仕様ファイル(entity / states / access / invariants)の集計。 */
function domainEntries(specs: AggregateSpecs, systemRole: string | undefined): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  if (specs.entity !== undefined) {
    // entity_spec: 値域(min / max / enum の語彙)を持つフィールド数。軽微な確認なので(軽)を付す
    const ranged = specs.entity.fields.filter(
      (field) => field.min !== undefined || field.max !== undefined || field.type.kind === 'enum',
    ).length;
    entries.push(entry(specs.entity.location.file, [['値域(軽)', ranged]]));
  }
  const machines = specs.stateMachines;
  if (machines.length > 0) {
    // state_spec: 遷移数 + guard 数 + otherwise_forbidden 数(1 ファイルに複数機械なら合算)
    const first = machines[0];
    if (first !== undefined) {
      const events = machines.flatMap((machine) => machine.events);
      const toneCount = machines.reduce((sum, machine) => sum + Object.keys(machine.stateTone).length, 0);
      const settlesCount = machines.reduce((sum, machine) => sum + Object.keys(machine.stateSettles).length, 0);
      entries.push(
        entry(first.location.file, [
          ['遷移', events.length],
          ['guard', events.filter((event) => event.guard !== undefined).length],
          ['otherwise_forbidden', events.filter((event) => event.otherwiseForbidden !== undefined).length],
          // tone / settles: 「この状態は悪い知らせか・その場で何かを確定させるか」の判断が 1 つ乗る
          // (action-spec-writing.md「方針の導出」が confirm_required を機械的に決める入力)
          ['tone', toneCount],
          ['settles', settlesCount],
        ]),
      );
    }
  }
  if (specs.access !== undefined) entries.push(accessEntry(specs.access, systemRole));
  if (specs.invariants !== undefined) {
    // invariant_spec: formal 有り(意味一致の確認)と DSL 外(テスト義務)を分けて数える
    const all = specs.invariants.invariants;
    const formal = all.filter((inv) => inv.formal !== undefined).length;
    entries.push(
      entry(specs.invariants.location.file, [
        ['formal(意味一致)', formal],
        ['DSL外(テスト義務)', all.length - formal],
      ]),
    );
  }
  return entries;
}

/** レイアウト内の排他表示グループ数(同じスロットの同じ group 番号で 1 つ)。 */
function variantGroupCount(layouts: readonly ScreenLayout[]): number {
  const groups = new Set<string>();
  for (const layout of layouts) {
    for (const slot of layout.slots) {
      for (const component of slot.components) {
        if (component.variant !== undefined) groups.add(`${slot.path}#${component.variant.group}`);
      }
    }
  }
  return groups.size;
}

/**
 * 集計対象の仕様ファイル(リポジトリルート相対)の一覧。
 *
 * CLI はこの一覧のファイルを読んで `GenerateContext.specSources` を構築する
 * (生成器は I/O をしない規約のため、母集合の定義だけをここが持つ)。
 * ハンドブックが標識を章に引用するのも、この母集合が読めていることに依存する。
 */
export function ledgerFiles(model: SpecModel, ctx: GenerateContext): readonly string[] {
  return collectLedgerEntries(model, ctx).map((entry) => entry.file);
}

/**
 * 全仕様ファイルの集計を、正典順(ドメイン → query → action → notification → job → config →
 * auth → guarantee → external → screen → chrome → ux_principles → design_token)で返す。
 * 集計の行とファイル読み込みの母集合はこれが唯一の正。
 */
export function collectLedgerEntries(model: SpecModel, ctx: GenerateContext): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const systemRole = systemRoleId(model.roles.roles);
  for (const specs of model.aggregates.values()) entries.push(...domainEntries(specs, systemRole));
  for (const query of ctx.queries?.queries ?? []) {
    // query_spec: for / via / projection(露出の口)を 1 式と数え、filters(併読分も)を足す
    const filters =
      query.filters.length + query.includes.reduce((sum, include) => sum + include.filters.length, 0);
    entries.push(
      entry(query.location.file, [
        ['for/via/projection', 1],
        ['filters', filters],
      ]),
    );
  }
  for (const action of ctx.actions?.actions ?? []) {
    // action_spec: 原則 0(接地・突合済み)。ドメイン仕様に無い独自宣言(追加エラー)と、
    // 方針の導出を信じない ux 上書き(「なぜ信じないか」の判断が 1 つ乗る)だけ数える
    entries.push(
      entry(action.location.file, [
        ['独自エラー', action.errors.additional.length],
        ['ux上書き', action.ux === undefined ? 0 : 1],
      ]),
    );
  }
  const catalog = ctx.notifications?.catalog;
  if (catalog !== undefined && catalog !== null) {
    // notification_spec: 通知 1 本ごとに「誰に飛ぶか・全員を叩き起こすか」の判断が 1 つ乗る
    // (effects との接続と語彙の閉世界は N1 が見ており、人間に残るのは宛先とメンションの是非)
    entries.push(entry(catalog.location.file, [['宛先/メンション', catalog.notifications.length]]));
  }
  const jobCatalog = ctx.jobs?.catalog;
  if (jobCatalog !== undefined && jobCatalog !== null) {
    // job_spec: ジョブ 1 本ごとに「これが止まって困るか・失敗したらどうなるか」の判断が 1 つ乗る
    // (effects / Cron との接続は J1・J2 が見ており、人間に残るのは間隔と失敗時の是非)
    entries.push(entry(jobCatalog.location.file, [['いつ/失敗時', jobCatalog.jobs.length]]));
  }
  const configCatalog = ctx.config?.catalog;
  if (configCatalog !== undefined && configCatalog !== null) {
    // config_spec: 設定 1 件ごとに「未設定のときの挙動でいいか」の判断が 1 つ乗る
    // (実装の参照・雛形との接続は K1・K2 が見ており、人間に残るのは縮退の是非)
    entries.push(entry(configCatalog.location.file, [['未設定時の挙動', configCatalog.variables.length]]));
  }
  const flow = ctx.auth?.flow;
  if (flow !== undefined && flow !== null) {
    // auth_spec: 分岐 1 行ごとに「その人をそこへ送っていいか」の判断が 1 つ乗る
    // (状態の全域性・着地の接地は H1・H2 が見ており、人間に残るのは行き先の是非)
    entries.push(entry(flow.location.file, [['着地の判断', flow.branches.length]]));
  }
  const guaranteeCatalog = ctx.guarantees?.catalog;
  if (guaranteeCatalog !== undefined && guaranteeCatalog !== null) {
    // guarantee_spec: 保証 1 行ごとに「この言い切りと、宣言された見張りテストが同じことを言っているか」の
    // 判断が 1 つ乗る(invariant_spec の `formal(意味一致)` と同じ形)。注釈の実在と `planned` の
    // 消し残しは Z 群が見ており、人間に残るのは**文と検査の意味が一致しているか**だけである。
    entries.push(entry(guaranteeCatalog.location.file, [['保証(意味一致)', guaranteeCatalog.guarantees.length]]));
  }
  const externalCatalog = ctx.external?.catalog;
  if (externalCatalog !== undefined && externalCatalog !== null) {
    // external_spec: 連携 1 本ごとに「鍵が無いときの挙動・外へ何を出すか」の判断が 1 つ乗る
    // (アダプタとの双方向・冪等キーの接地は X 群が見ており、人間に残るのは縮退と送る情報の是非)。
    entries.push(entry(externalCatalog.location.file, [['縮退/送る情報', externalCatalog.integrations.length]]));
  }
  for (const screen of ctx.screens?.screens ?? []) {
    // screen_spec: 操作の束ね数(重ね表示分も)+ variants 数 + 動線数(chrome 由来は chrome 側で数える)
    const actions =
      screen.actions.length + screen.overlays.reduce((sum, overlay) => sum + overlay.actions.length, 0);
    const layouts = [screen.layout, ...screen.overlays.map((overlay) => overlay.layout)];
    entries.push(
      entry(screen.location.file, [
        ['actions', actions],
        ['variants', variantGroupCount(layouts)],
        ['navigations', screen.navigations.filter((navigation) => navigation.viaChrome === undefined).length],
      ]),
    );
  }
  for (const chrome of ctx.screens?.chromes ?? []) {
    entries.push(
      entry(chrome.location.file, [
        ['variants', variantGroupCount([chrome.layout])],
        ['navigations', chrome.navigations.length],
      ]),
    );
  }
  const uxSpec = ctx.uxPrinciples?.spec;
  if (uxSpec !== undefined && uxSpec !== null) {
    // ux_principles_spec: 台帳そのものに人の判断は乗らない(原則・閾値は検査が見る)。人が読むのは、
    // 各 screen_spec の `ux:`(原則から外れてよいと理由つきで通した場所)で、1 件ごとに「その理由で
    // 本当に外れてよいか」の判断が 1 つ乗る。画面の宣言だが、読む場所は「UX 原則」の章なので台帳の行に数える。
    const accepted = (ctx.screens?.screens ?? []).reduce((sum, screen) => sum + screen.ux.length, 0);
    entries.push(entry(uxSpec.location.file, [['受け入れ', accepted]]));
  }
  const design = ctx.design?.spec;
  if (design !== undefined && design !== null) {
    // design_token: contrast に宣言した組の数(値の意匠は SSR プレビューと実画面の目視の領分で件数に含めない)
    entries.push(entry(design.file, [['contrast', design.contrast.length]]));
  }
  return entries;
}
