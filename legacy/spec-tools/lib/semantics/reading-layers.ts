/**
 * 通知・ジョブ・画面・認証・設定・保証の層で、必読に数える公理の**単位**。
 *
 * 集約の層は `reading-axioms.ts` が数える単位を 1 か所で決めている。層が増えても同じ形にする —— 章(上段の行)も
 * 手引きのブロック表(`block-reading.ts` の `axiomsByFile`)も、**この関数から数える**ので、数は食い違わない。
 * 分類(何が公理か)は `reading-class.ts` の表が決め、ここはその種類を**どの単位で数えるか**だけを持つ。
 *
 * 数える単位は**宣言 1 つ**である:
 *
 * - **通知** … 通知 1 本(宛先・メンション・何を知らせるかの 3 種類をまとめて 1 つ)と、宛先の語・メンションの語の
 *   宣言 1 語ずつ。語の宣言(誰に届く種別か・本人を名指せるか)は、機械には現実との照合相手が無い公開範囲の宣言だから
 * - **ジョブ** … ジョブ 1 本(いつ・何を基準に・何をし・失敗したらどうするか。時刻で起きるものだけが前の 2 つを持つ)と、
 *   失敗時の語 1 語ずつ。**通知カタログに同じ ID があるジョブ(通知を送るジョブ)は数えない**: 通知 1 本の宣言(宛先・
 *   メンション・何を知らせるか)が同じ事実を持つので、ジョブの側は通知の導出(積む側)であり、通知の章で読む
 * - **画面** … 画面 1 枚(誰が見るか・入場の条件・読むもの・束ねる操作・部品の宣言・排他表示。無いものは載せない)。
 *   共有クロームは画面の枠なので単位にしない
 *
 * - **認証** … 決定表の分岐 1 行・着地 1 つ・関門 1 つ(誰がどこへ着き、通れない人がどうなるか)と、**値と持つ行をこの仕様が
 *   直接宣言する軸**(`kind: enum`)1 本ずつ(分岐群の前提。値域・`when` / `optional` に照合相手が無い)。主語の軸(値の全体は状態機械・
 *   enum が閉じる)は導出で、数えない
 * - **設定** … 設定 1 本(何を制御し、無いときどうなるか)と、値の性質の語・要求度の語 1 語ずつ(公開してよいか・縮退するか止まるかを
 *   決める語)。連携の語・調達の語・置き場の語は、設定の行から導ける対応なので数えない。**値そのものは単位に無い**
 * - **保証** … 保証 1 本(何が起こりえないか)。執行者の語・見張りテスト・変異の目録は導出
 * - **可視性と操作の章は単位を持たない**: 可視性の宣言(`access`)は集約の章が、確認の上書き・定型外の理由は集約の章の受け入れが
 *   既に数えている。同じ ID を二度必読に数えない
 *
 * 数えないもの(発火元・実装・登録・積む元・テスト)は導出で、章の下段に出す。**テストの件数は公理に足さない**。
 * 純粋関数だけ(意味解析の層)。**アプリの語彙は 1 語も持たない。**
 */

import { declaredAxes, type AuthFlowSpec } from '../model/auth/types.js';
import type { ConfigCatalogSpec } from '../model/config/types.js';
import type { GuaranteeCatalogSpec } from '../model/guarantee/types.js';
import type { JobCatalogSpec } from '../model/job/types.js';
import type { NotificationCatalogSpec } from '../model/notification/types.js';
import type { ScreenSpec } from '../model/screen/types.js';
import type { ElementsOf } from './reading-class.js';

/**
 * 通知を送るジョブの ID(通知カタログに同じ ID の行を持つジョブ)。
 *
 * 通知の ID はジョブの種別 ID でもある(積む側と送る側が同じ語)。ジョブ側の宣言は通知の導出なので、
 * ジョブの章は公理に数えず、通知の章を読めば足りる。時刻で起きるジョブ(走査)は、いつ・基準の時刻を自分で宣言するので含めない。
 * 通知カタログが読めていなければ空(全ジョブを公理に数える)。
 */
export function notificationJobIds(jobs: JobCatalogSpec | null, notifications: NotificationCatalogSpec | null): ReadonlySet<string> {
  const ids = new Set(notifications?.notifications.map((decl) => decl.id) ?? []);
  return new Set((jobs?.jobs ?? []).filter((decl) => decl.schedule === undefined && ids.has(decl.id)).map((decl) => decl.id));
}

/** 数える単位 1 つ。 */
export interface LayerUnit {
  /** 宣言そのもの(`declaration`)か、語彙の語の宣言(`vocabulary`)か。 */
  readonly kind: 'declaration' | 'vocabulary';
  /** 情報の単位の ID(通知 ID・ジョブ ID・設定名・保証 ID・`{軸}:{語}`。認証は `axis:` / `branch:` / `landing:` / `gate:` を前に付ける)。 */
  readonly id: string;
  /** 宣言のある仕様ファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** この単位が載せる公理の種類(`reading-class.ts` の表の鍵)。 */
  readonly elements: readonly ElementsOf<'axiom'>[];
}

/** 通知カタログの公理の単位(通知 1 本・宛先の語・メンションの語。宣言順)。カタログが読めていなければ空。 */
export function notificationUnits(catalog: NotificationCatalogSpec | null): LayerUnit[] {
  if (catalog === null) return [];
  const file = catalog.location.file;
  return [
    ...catalog.notifications.map(
      (decl): LayerUnit => ({
        kind: 'declaration',
        id: decl.id,
        file,
        elements: ['notification.audience', 'notification.mention', 'notification.summary'],
      }),
    ),
    ...catalog.vocabulary.audience.map(
      (term): LayerUnit => ({ kind: 'vocabulary', id: `audience:${term.id}`, file, elements: ['notification.audience'] }),
    ),
    ...catalog.vocabulary.mention.map(
      (term): LayerUnit => ({ kind: 'vocabulary', id: `mention:${term.id}`, file, elements: ['notification.mention'] }),
    ),
  ];
}

/**
 * ジョブカタログの公理の単位(ジョブ 1 本・失敗時の語。宣言順)。カタログが読めていなければ空。
 *
 * 時刻で起きるジョブは、いつ(`job.schedule`)と、基準の時刻(`job.due_from`。宣言があるときだけ)も載せる。
 * 通知を送るジョブ(`notificationJobIds`)は数えない(通知の章が同じ事実を読む)。
 *
 * @param catalog ジョブカタログ
 * @param notifications 通知カタログ(同じ ID のジョブを通知の導出として外す。読めていなければ全ジョブを数える)
 */
export function jobUnits(catalog: JobCatalogSpec | null, notifications: NotificationCatalogSpec | null = null): LayerUnit[] {
  if (catalog === null) return [];
  const file = catalog.location.file;
  const sending = notificationJobIds(catalog, notifications);
  return [
    ...catalog.jobs.filter((decl) => !sending.has(decl.id)).map((decl): LayerUnit => {
      const timed: ElementsOf<'axiom'>[] =
        decl.schedule === undefined ? [] : decl.schedule.dueFrom === undefined ? ['job.schedule'] : ['job.schedule', 'job.due_from'];
      return { kind: 'declaration', id: decl.id, file, elements: [...timed, 'job.summary', 'job.on_failure'] };
    }),
    ...catalog.vocabulary.on_failure.map(
      (term): LayerUnit => ({ kind: 'vocabulary', id: `on_failure:${term.id}`, file, elements: ['job.on_failure'] }),
    ),
  ];
}

/**
 * 画面の公理の単位(画面 1 枚。宣言順)。画面が読めていなければ空。
 *
 * 誰が見るか(`screen.for`)は全画面が持つ。入場条件・読むもの・束ねる操作(画面と重ね表示の合算)・部品の宣言
 * (`kind` を持つ部品)は、宣言があるときだけ載せる。**部品を別の単位にはしない**: 部品の宣言は画面の中で読むもので、
 * 画面 1 枚の判断(この人がこの画面でこれを見て、これをしてよいか)の一部である。
 */
export function screenUnits(screens: readonly ScreenSpec[]): LayerUnit[] {
  return screens.map((screen): LayerUnit => {
    const elements: ElementsOf<'axiom'>[] = ['screen.for'];
    if (screen.precondition !== undefined) elements.push('screen.precondition');
    if (screen.reads.length > 0) elements.push('screen.reads');
    if (screen.actions.length + screen.overlays.reduce((sum, overlay) => sum + overlay.actions.length, 0) > 0) elements.push('screen.actions');
    if (screen.layout.slots.some((slot) => slot.components.some((component) => component.kind !== undefined))) elements.push('screen.parts');
    if (screen.layout.slots.some((slot) => slot.components.some((component) => component.variant !== undefined))) elements.push('screen.variants');
    return { kind: 'declaration', id: screen.name, file: screen.location.file, elements };
  });
}

/**
 * 認証フロー仕様の公理の単位(条件の軸 1 本・分岐 1 行・着地 1 つ・関門 1 つ。宣言順)。仕様が読めていなければ空。
 *
 * 条件の軸は、値と持つ行をこの仕様が直接宣言する軸(`kind: enum`。`declaredAxes`)だけ。主語の軸は値の全体を状態機械などが決めるので
 * 数えない(導出)。
 */
export function authUnits(flow: AuthFlowSpec | null): LayerUnit[] {
  if (flow === null) return [];
  const file = flow.location.file;
  const unit = (id: string, element: ElementsOf<'axiom'>): LayerUnit => ({ kind: 'declaration', id, file, elements: [element] });
  return [
    ...declaredAxes(flow).map((axis) => unit(`axis:${axis.id}`, 'auth.condition')),
    ...flow.branches.map((branch) => unit(`branch:${branch.id}`, 'auth.branch')),
    ...flow.landings.map((landing) => unit(`landing:${landing.id}`, 'auth.landing')),
    ...flow.gates.map((gate) => unit(`gate:${gate.id}`, 'auth.gate')),
  ];
}

/**
 * 設定カタログの公理の単位(設定 1 本・値の性質の語・要求度の語。宣言順)。カタログが読めていなければ空。
 *
 * 設定 1 本は、何を制御するか(`config.summary`)と、無いときどうなるか(`config.absence`)をまとめて 1 本。値の性質の語
 * (`kind`)と要求度の語(`requirement`)は 1 語 1 本。値そのものは単位にも、どこにも持たない。
 */
export function configUnits(catalog: ConfigCatalogSpec | null): LayerUnit[] {
  if (catalog === null) return [];
  const file = catalog.location.file;
  return [
    ...catalog.variables.map(
      (variable): LayerUnit => ({ kind: 'declaration', id: variable.id, file, elements: ['config.summary', 'config.absence'] }),
    ),
    ...catalog.vocabulary.kind.map((term): LayerUnit => ({ kind: 'vocabulary', id: `kind:${term.id}`, file, elements: ['config.kind'] })),
    ...catalog.vocabulary.requirement.map(
      (term): LayerUnit => ({ kind: 'vocabulary', id: `requirement:${term.id}`, file, elements: ['config.requirement'] }),
    ),
  ];
}

/** 保証台帳の公理の単位(保証 1 本。宣言順)。台帳が読めていなければ空。 */
export function guaranteeUnits(catalog: GuaranteeCatalogSpec | null): LayerUnit[] {
  if (catalog === null) return [];
  const file = catalog.location.file;
  return catalog.guarantees.map((decl): LayerUnit => ({ kind: 'declaration', id: decl.id, file, elements: ['guarantee.statement'] }));
}
