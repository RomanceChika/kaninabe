/**
 * R2 **役の根拠の欄の書き手**(危ない形の群。規則の正は enforcement-matrix の C32)。
 *
 * 役が立つかどうかを決める欄(`claim` の欄・`binding` の欄・`actor.{欄}` の欄。`r2-grounds.ts`)を書けるのは、
 *
 *   - その役を**持つ**か、それを**含意する**役(`implies` を辿って届く役。役を持つ人が仲間を増やす・所有者が譲る)
 *   - **誰の指示で何を書くかが仕様から追える**内部実行の入口(`r2-trace.ts`)
 *
 * だけである。ほかの書き手が書ける形は、権限を自分で作れる形 —— 一般のメンバーが自分を運営にする・誰でも任意の部門の管理者に
 * 自分を据える・止められた人が自分で戻る・自分の所属の境界を書き換える —— なので error にする。経路は編集・作成の初期値・
 * 遷移・内部実行の入口の全部を見る(`r2-sites.ts`)。`writes.fields` だけを見ると、作成の初期値と遷移と紐付けの経路を取り逃がす。
 *
 * **受け入れは、その規則の場所に書く `self_assign`** で、**欄 × 役 × 書き手を 1 本ずつ名指す**(`- field / role / by / reason`。
 * V20 の `accept` と同じ「その場で名指す」形)。作った人がその行の所有者になる・休会した本人が復帰する、のように書き手が役を得る
 * ことを意図した規則だけが書く。名指していない欄(点検 9 回目 A9-2)・名指していない書き手(10 回目 A10-1。遷移の `by` は並びなので、
 * 後から足したロールにも最初の書き手の理由が効いていた)には効かない。何も受け入れない要素 × 書き手・宣言の `by` に無い書き手は
 * 腐った受け入れとして error にする(免除の一覧にしない)。内部実行の入口には受け入れの口を置かない
 * —— 追えない入口は、入口を宣言するか `by` から外すかで直す。
 *
 * 読むのは仕様の軸(`kind` / `claim` / `binding` / `implies` / `session` / `filters` / `by` / 入口の宣言)だけで、
 * **アプリの語彙は 1 語も持たない**。純関数であり throw しない。
 */

import type { RoleDef, SelfAssignDecl, SpecModel } from '../../model/types.js';
import { namesGround } from '../../model/parse-self-assign.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import { systemRoleId } from '../../model/role-hierarchy.js';
import { makeFinding, type Finding } from '../../kernel/finding.js';
import { collectGrounds, holdersOf, type Ground } from './r2-grounds.js';
import { declaredAccepts, sitesOf, type AcceptHolder, type SiteInput, type WriteSite } from './r2-sites.js';
import { tracedCreator, tracedSources, type TraceCatalogs } from './r2-trace.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'R2';

/** R2 の材料。 */
export interface GroundWritersInput {
  readonly model: SpecModel;
  readonly actions: ActionSpecModel | undefined;
  readonly dataTables: DataTableSpecModel | undefined;
  readonly catalogs: TraceCatalogs;
  /**
   * 入口の追跡の材料のうち、採ったのに使えないもの(阻害)。空でないとき、追えない内部実行の書き込みは判定を出さずに
   * `withheld` に回す(追えないのか読めなかったのかを区別できないため)。
   */
  readonly blockedSources: readonly string[];
}

/** R2 の結果。 */
export interface GroundWritersRun {
  readonly findings: Finding[];
  /** 入口の材料が阻害のため判定を出さなかった書き込み(人が読む 1 行ずつ)。 */
  readonly withheld: string[];
}

/** 遷移の経路(内部実行の追跡がイベントの入口を見るもの)。 */
const EVENT_PATHS: ReadonlySet<WriteSite['path']> = new Set(['transition', 'transition_input', 'records_actor']);

/** 根拠の欄の名前(メッセージ用)。 */
function groundText(ground: Ground): string {
  const place = `${ground.entity}.${ground.field}`;
  if (ground.kind === 'claim') return `役 ${ground.role ?? ''} の根拠の欄 ${place}(claim)`;
  if (ground.kind === 'binding') return `役 ${ground.role ?? ''} の根拠の欄 ${place}(binding)`;
  return `実行者の属性 ${place}(actor.${ground.field} の欄)`;
}

/** 攻撃の一文。 */
function attackText(site: WriteSite): string {
  const ground = site.ground;
  if (site.path === 'create_owner') return `作成者が、作った行の役 ${ground.role ?? ''} に自分で就きます(書き手の持たない役を、作った行について得ます)`;
  if (ground.kind === 'claim') return `役 ${ground.role ?? ''} を持たない人が、自分にその役を与えられます(自己昇格)`;
  if (ground.kind === 'binding') return `役 ${ground.role ?? ''} を持たない人が、任意の行のその役に自分を据えられます(所有者のすり替え)`;
  return '実行者が自分の側の境界を書き換え、別の境界の行を読み書きできます(境界の乗り換え)';
}

/** 規則の場所の名前(メッセージ用)。 */
function placeText(site: WriteSite): string {
  return site.holder.kind === 'event' ? `${site.holder.label}(by: ${site.writer})` : site.holder.label;
}

/** 書き手が役の根拠を書いてよい役の一覧(メッセージ用)。 */
function allowedText(roles: readonly RoleDef[], ground: Ground): string {
  if (ground.role === undefined) return '(この欄には役が無いので、人の書き手は無い)';
  return [...holdersOf(roles, ground.role)].join(' / ');
}

/** 人の書き手の判定(通れば null)。 */
function humanFinding(roles: readonly RoleDef[], site: WriteSite, accepted: Set<string>): Finding | null {
  const ground = site.ground;
  if (ground.role !== undefined && holdersOf(roles, ground.role).has(site.writer)) return null;
  const index = site.holder.selfAssign.findIndex((decl) => namesGround(decl, ground) && decl.by.includes(site.writer) && decl.reason.trim() !== '');
  if (index >= 0) {
    accepted.add(acceptKey(site.holder, index, site.writer));
    return null;
  }
  return makeFinding(VERIFIER_ID, {
    message:
      `${placeText(site)} は、${groundText(ground)}をその役を持たない ${site.writer} が書ける形です(${attackText(site)})` +
      (site.detail === undefined ? '' : `。経路: ${site.detail}`),
    location: site.holder.location,
    suggestion:
      `書き手を ${allowedText(roles, ground)} に限る(そのロールを持つか含意するロールだけが根拠を書ける)。` +
      `書き手が役を得ることを意図した規則なら、この規則の場所の self_assign にこの欄と書き手を名指して理由を書く` +
      `("- field: ${ground.entity}.${ground.field}${ground.role === undefined ? '' : ` / role: ${ground.role}`} / by: [${site.writer}] / reason: {何を得て、何に及ばないか}"。` +
      '受け入れは名指した欄 × 役 × 書き手にだけ効く。別の書き手のために書いた理由をこの書き手に広げるなら、その理由がこの書き手にも当てはまるかを確かめてから by に足す)',
    counterexample: { writer: site.writer, field: `${ground.entity}.${ground.field}`, kind: ground.kind, path: site.path },
  });
}

/**
 * 内部実行の書き込みが追えるか(追える入口の説明。追えなければ null)。
 *
 * 編集の規則(`writes`)は、それ自身には入口が無い。通すのは、**同じ欄を書く遷移のうち、書き手が同じ内部実行で、
 * かつその遷移に追える入口がある**ものがあるときだけである。同じ欄の遷移が「在る」だけで通すと、許可された人の
 * 遷移や、入口の無い内部実行の遷移を借りて、内部実行の入口が分からないまま通ってしまう(2026-10-20 外部レビュー の指摘)。
 */
function systemTrace(catalogs: TraceCatalogs, site: WriteSite, all: readonly WriteSite[]): string | null {
  if (EVENT_PATHS.has(site.path)) {
    const sources = tracedSources(catalogs, site.event ?? '');
    return sources.length === 0 ? null : sources.join('・');
  }
  if (site.path === 'writes' || site.path === 'edit_computes') {
    for (const other of all) {
      if (other === site || !EVENT_PATHS.has(other.path) || other.ground !== site.ground || other.writer !== site.writer) continue;
      const sources = tracedSources(catalogs, other.event ?? '');
      if (sources.length > 0) return `遷移 ${other.event ?? ''} が書く列(${sources.join('・')})`;
    }
    return null;
  }
  return tracedCreator(catalogs, site.creator ?? site.ground.entity);
}

/** 内部実行の書き込みの指摘。 */
function systemFinding(site: WriteSite): Finding {
  return makeFinding(VERIFIER_ID, {
    message:
      `${placeText(site)} は、内部実行が${groundText(site.ground)}を書く形ですが、誰の指示で書くのかが仕様から追えません` +
      '(内部実行のロールは呼び手を問わないので、入口の宣言が無ければ仕組みのどこからでもこの欄を書けます)',
    location: site.holder.location,
    suggestion:
      '入口を宣言する —— サインインの決定表の runs(主語以外の軸の条件つき)・受信 Webhook の emits / event_id_table・' +
      '発火時刻の供給元(due_from)つきの走査のどれか。入口が無いなら by から内部実行のロールを外す(内部実行の書き込みに受け入れの口は無い)' +
      (site.path === 'writes'
        ? '。遷移だけが書く列の印として by: system の行を置いているなら、access_spec の transition_writes へ移す(編集の経路を作らない宣言)'
        : ''),
    counterexample: { field: `${site.ground.entity}.${site.ground.field}`, kind: site.ground.kind, path: site.path },
  });
}

/** 受け入れの要素 1 つ × 書き手 1 人の鍵(宣言 × 要素の番号 × 書き手)。 */
function acceptKey(holder: AcceptHolder, index: number, writer: string): string {
  return `${holder.key}|${index}|${writer}`;
}

/** 受け入れの要素の名前(メッセージ用)。 */
function declText(decl: SelfAssignDecl): string {
  return `${decl.entity}.${decl.field}${decl.role === undefined ? '' : `(役 ${decl.role})`}`;
}

/** 腐った受け入れの指摘 1 件(要素 × 書き手)。 */
function staleFinding(holder: AcceptHolder, decl: SelfAssignDecl, writer: string): Finding {
  const absent = !holder.writers.includes(writer);
  return makeFinding(VERIFIER_ID, {
    message: absent
      ? `${holder.label} の self_assign(${declText(decl)})は書き手 ${writer} を名指していますが、${writer} はこの宣言の by にいません(by を替えた後に残った、腐った受け入れです)`
      : `${holder.label} の self_assign は ${declText(decl)} を書き手 ${writer} について名指していますが、この宣言は ${writer} にその役を持たないまま根拠の欄を書かせていません(何も受け入れていない、腐った受け入れです)`,
    location: decl.location,
    suggestion: absent
      ? `self_assign の by から ${writer} を消す(by に足し直すなら、この理由がその書き手に当てはまるかを確かめる。by: [${holder.writers.join(', ')}] の部分集合だけを書ける)`
      : `self_assign の by から ${writer} を消す(要素の by が空になるなら要素ごと消す。欄・役の綴りが違うなら直す。` +
        '書き手がその役を持つ・含意するなら受け入れは要らない。根拠の欄を書く規則を後で足すときは、そのときに名指して理由を書き直す)',
    counterexample: { declaration: holder.label, field: `${decl.entity}.${decl.field}`, role: decl.role ?? '', writer },
  });
}

/**
 * 腐った受け入れ・理由の空の受け入れの指摘(**要素 × 書き手ごと**)。
 *
 * 要素は名指した欄 × 役 × 書き手にだけ効くので、腐ったかどうかも要素 × 書き手ごとに見る —— 同じ規則の別の要素・同じ要素の
 * 別の書き手が何かを受け入れていても、何も受け入れない組は腐っている(点検 9 回目 A9-2 で要素ごと、10 回目 A10-1 で書き手ごと)。
 * 宣言の `by` に無い書き手を名指した組も腐っている(`by` を替えた後の取り残し)。
 */
function acceptFindings(model: SpecModel, accepted: ReadonlySet<string>): Finding[] {
  return declaredAccepts(model).flatMap((holder) =>
    holder.selfAssign.flatMap((decl, index) => {
      if (decl.reason.trim() === '') {
        return [
          makeFinding(VERIFIER_ID, {
            message: `${holder.label} の self_assign(${declText(decl)})の理由が空です(理由の無い受け入れは、受け入れの無いのと同じものです)`,
            location: decl.location,
            suggestion: '書き手が役の根拠を書いてよい理由を具体的に書く',
            counterexample: { declaration: holder.label, field: `${decl.entity}.${decl.field}`, role: decl.role ?? '' },
          }),
        ];
      }
      // 宣言の by に無い書き手は経路を持たないので受け入れの鍵にも現れず、ここで腐った組として拾われる(文は staleFinding が分ける)。
      return decl.by.flatMap((writer) => (accepted.has(acceptKey(holder, index, writer)) ? [] : [staleFinding(holder, decl, writer)]));
    }),
  );
}

/**
 * R2: 役の根拠の欄の全ての書き込みの経路について、書き手がその役を持つか含意するか、追える内部実行の入口かを見る。
 *
 * @param input 材料
 * @returns 違反と、入口の材料が阻害のため判定を出さなかった書き込み
 */
export function verifyGroundWriters(input: GroundWritersInput): GroundWritersRun {
  const roles = input.model.roles.roles;
  const grounds = collectGrounds(input.model);
  const systemRole = systemRoleId(roles);
  const siteInput: SiteInput = {
    model: input.model,
    actions: input.actions,
    dataTables: input.dataTables,
    actorEntity: grounds.actorEntity,
    systemRole,
  };
  const findings: Finding[] = grounds.unreadableBindings.map(({ role }) =>
    makeFinding(VERIFIER_ID, {
      message: `役 ${role.id} の binding を {集約}.{欄} == actor.id の形として読めません(根拠の欄が決まらないので、書き手を追えません)`,
      location: role.location,
      suggestion: 'binding は "{集約}.{欄} == actor.id" か "{集約}.{欄} contains actor.id" で書く',
      counterexample: { role: role.id, binding: role.binding ?? '' },
    }),
  );
  const withheld: string[] = [];
  const accepted = new Set<string>();
  for (const ground of grounds.grounds) {
    const sites = sitesOf(siteInput, ground);
    for (const site of sites) {
      if (site.writer !== systemRole) {
        const found = humanFinding(roles, site, accepted);
        if (found !== null) findings.push(found);
        continue;
      }
      if (systemTrace(input.catalogs, site, sites) !== null) continue;
      if (input.blockedSources.length > 0) withheld.push(`${placeText(site)} の ${site.ground.entity}.${site.ground.field}`);
      else findings.push(systemFinding(site));
    }
  }
  findings.push(...acceptFindings(input.model, accepted));
  return { findings, withheld };
}
