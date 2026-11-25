/**
 * V2 のうち、**access_spec の「列を名指す口」の接地**を見る部分。
 *
 * access_spec には名前をそのまま書く口が 4 つある。どれも**名前の字面の一致**で効く宣言なので、
 * 綴りを違えると「何にも当たらない宣言」になり、しかも何も言われない —— 当たらないことが宣言の
 * 意味を黙って変える。
 *
 * | 口 | 当たらないと何が起きるか | ここが見るもの |
 * |---|---|---|
 * | `fields_hidden[].field` | 外から届く surface のマスクがどの列にも掛からず、**隠したつもりの列が素のまま外へ出る** | 実在すること・同じ列を 2 回宣言しないこと |
 * | `writes[].fields` | 編集の RPC の書き換えてよい列から黙って落ちる(宣言した編集ができない)。状態の列・自動の列を並べると、遷移を通らずに状態を書ける口が開く | 実在すること・状態の列(`state(...)`)と自動の列(`auto: true`)でないこと |
 * | `entity` | access_spec を名前で引く口(RLS の世界・テナント境界の見張りほか)から黙って外れる | 同じ集約の entity_spec の名前と一致すること |
 * | `accept[].filter` / `accept[].by` | テナント境界の受け入れ(V20)がどの規則にも当たらず、受け入れたつもりの宣言が死んだまま残る | 列が実在し、ロールがその access_spec の reads に現れること |
 *
 * 同じ列を 2 回隠せないのは、ビューの計画が列名で 1 つのマスクに畳むからである —— 後の宣言が前の宣言を
 * 黙って上書きし、前に書いた相手から隠れなくなる。隠す相手は 1 つの `from` に並べる。
 *
 * `fields_hidden[].from` のロールの接地(roles.md に実在し、reads に現れ、内部実行のロールでない)は
 * V11 が見る(ロールの接地はロールの検査に 1 か所で持つ。`v11-hidden-from.ts`)。
 */

import { acceptEventSpellings, resolveAcceptEvent } from '../../model/accept-events.js';
import type { AccessSpec, EntitySpec, FieldDef, SpecModel } from '../../model/types.js';
import { refPathTo } from '../../model/ref-path.js';
import type { Finding } from '../../kernel/finding.js';
import { refError as error } from './v2-paths.js';

/**
 * access_spec の名前を書く 4 つの口の接地を見る。
 *
 * entity_spec が無い集約(V1 が先に止める)では列の実在を言えないので、列に依らない判定だけを見る。
 *
 * @param access その集約のアクセス宣言
 * @param entity その集約の entity_spec(無ければ undefined)
 * @param model ドメイン仕様(受け入れの `{集約}.{列}`(祖先の列)の接地に使う。省略すると祖先の列を見ない)
 * @returns 違反のリスト
 */
export function checkAccessFields(access: AccessSpec, entity: EntitySpec | undefined, model?: SpecModel): Finding[] {
  return [
    ...checkEntityName(access, entity),
    ...checkFieldsHidden(access, entity),
    ...checkWriteFields(access, entity),
    ...checkAccepts(access, entity, model),
  ];
}

/**
 * `entity` が同じ集約の entity_spec の名前と一致すること。
 *
 * access_spec を引く口の多くは `access.entity === {エンティティ名}` で探す(RLS の世界・テナント境界の見張り・
 * 計画の世界の行)。綴りが違うと、その宣言は**引かれないまま**黙って欠け、集約名で引く口とだけ食い違う。
 */
function checkEntityName(access: AccessSpec, entity: EntitySpec | undefined): Finding[] {
  if (entity === undefined || access.entity === entity.entity) return [];
  return [
    error(
      `access_spec の entity ${access.entity} が、同じ集約の entity_spec の名前 ${entity.entity} と一致しません`,
      access.location,
      `entity: ${entity.entity} に直してください(access_spec は同じディレクトリの entity_spec の権限であり、名前で引かれます)。`,
      { access_entity: access.entity, entity: entity.entity },
    ),
  ];
}

/** 列が無いときの対処の文(実在する列を並べる)。 */
function knownColumns(entity: EntitySpec): string {
  return entity.fields.map((field) => field.name).join(' / ');
}

/** `fields_hidden[].field` の実在と一意。 */
function checkFieldsHidden(access: AccessSpec, entity: EntitySpec | undefined): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const rule of access.fieldsHidden) {
    if (entity !== undefined && !entity.fields.some((field) => field.name === rule.field)) {
      findings.push(
        error(
          `${access.entity} の fields_hidden が隠す ${rule.field} は、entity_spec ${entity.entity} の列にありません`,
          rule.location,
          `field を entity_spec の列名(${knownColumns(entity)})に直してください。` +
            '実在しない列名のマスクはどの列にも掛からず、隠したつもりの列が素のまま外へ出ます。',
          { entity: access.entity, field: rule.field },
        ),
      );
    }
    if (seen.has(rule.field)) {
      findings.push(
        error(
          `${access.entity} の fields_hidden が ${rule.field} を 2 回宣言しています`,
          rule.location,
          `${rule.field} の隠す相手を 1 つの要素の from にまとめてください` +
            '(列のマスクは列名で 1 つに畳まれるので、後の宣言が前の宣言を黙って上書きし、前に書いた相手から隠れなくなります)。',
          { entity: access.entity, field: rule.field },
        ),
      );
    }
    seen.add(rule.field);
  }
  return findings;
}

/** `writes[].fields` の実在と、状態の列・自動の列でないこと。 */
function checkWriteFields(access: AccessSpec, entity: EntitySpec | undefined): Finding[] {
  if (entity === undefined) return [];
  const byName = new Map<string, FieldDef>(entity.fields.map((field) => [field.name, field]));
  return access.writes.flatMap((rule) =>
    rule.fields.flatMap((name): Finding[] => {
      const field = byName.get(name);
      if (field === undefined) {
        return [
          error(
            `${access.entity} の writes(by: ${rule.by})の fields にある ${name} は、entity_spec ${entity.entity} の列にありません`,
            rule.location,
            `fields を entity_spec の列名(${knownColumns(entity)})に直してください。` +
              '実在しない列は編集の RPC の書き換えてよい列から黙って落ち、宣言した編集ができません。',
            { entity: access.entity, by: rule.by, field: name },
          ),
        ];
      }
      if (field.type.kind !== 'state' && !field.auto) return [];
      const what = field.type.kind === 'state' ? `状態の列(state(${field.type.machine}))` : '自動の列(auto: true)';
      return [
        error(
          `${access.entity} の writes(by: ${rule.by})の fields にある ${name} は${what}で、編集の対象にできません`,
          rule.location,
          field.type.kind === 'state'
            ? `fields から ${name} を外してください。状態を動かすのは state_spec の遷移だけです —— writes に並べると、` +
                '遷移の by・from・ガードを通らずに状態を書ける編集の口が開きます。'
            : `fields から ${name} を外してください。自動の列は仕組み(採番・DB)が決める値で、人の編集で書き換えません。`,
          { entity: access.entity, by: rule.by, field: name },
        ),
      ];
    }),
  );
}

/**
 * `accept[].filter` が実在する列か。自分の列(`{列}`)か、`context` で辿れる祖先の列(`{集約}.{列}`)。
 *
 * 祖先の列の形は V20 / V26 の候補と同じ綴りである(祖先だけが境界の列を持つ集約の受け入れが名指す)。`model` が無ければ祖先の列は見ない。
 */
function groundedAcceptColumn(column: string, entity: EntitySpec, model: SpecModel | undefined): boolean {
  const dot = column.indexOf('.');
  if (dot < 0) return entity.fields.some((field) => field.name === column);
  if (model === undefined) return true;
  const ancestor = model.aggregates.get(column.slice(0, dot))?.entity;
  return (
    ancestor !== undefined &&
    ancestor.fields.some((field) => field.name === column.slice(dot + 1)) &&
    refPathTo(model, entity.entity, ancestor.entity) !== null
  );
}

/**
 * `accept[].events` の名指しが、受け入れのロールで起こせる遷移の定義の**ちょうど 1 本**に当たること(A4-4・A5-1)。
 * 当たらない名指しは死んだ宣言、2 本以上に当たる名指しは、後から足した同じ ID の遷移まで黙って受け入れる。
 */
function acceptEventFindings(access: AccessSpec, accept: AccessSpec['accepts'][number], model: SpecModel): Finding[] {
  const events = [...model.aggregates.values()].find((specs) => specs.access === access)?.stateMachines.flatMap((machine) => machine.events) ?? [];
  const known = [...new Set(events.filter((event) => event.by.includes(accept.by)).map((event) => event.id))];
  const findings: Finding[] = [];
  const unknown: string[] = [];
  for (const raw of accept.events ?? []) {
    const resolved = resolveAcceptEvent(raw, events, accept.by);
    if (resolved.kind === 'unknown' || resolved.kind === 'malformed') unknown.push(raw);
    if (resolved.kind !== 'ambiguous') continue;
    const spellings = resolved.events.flatMap((event) => acceptEventSpellings(event, events, accept.by));
    findings.push(
      error(
        `${access.entity} の accept(by: ${accept.by})の events ${raw} は、${accept.by} が起こせる遷移の定義 ${resolved.events.length} 本` +
          `(${resolved.events.map((event) => `${event.id}: ${event.from.join(' / ')} → ${event.to}`).join('、')})に当たり、どれを受け入れるかが決まりません`,
        accept.location,
        (spellings.length > 0 ? `受け入れる遷移を遷移元の状態で名指す(${spellings.join(' / ')} のどれか)。` : '遷移元の状態でも分けられないので、遷移のイベント ID を分ける。') +
          '理由は 1 本の遷移について書かれるので、同じ ID の別の遷移に黙って効かせない',
        { entity: access.entity, by: accept.by, events: raw, kind: 'ambiguous' },
      ),
    );
  }
  if (unknown.length > 0) {
    findings.push(
      error(
        `${access.entity} の accept(by: ${accept.by})の events ${unknown.join(' / ')} は、${access.entity} の状態遷移のうち ${accept.by} が起こせるものにありません`,
        accept.location,
        `events を ${access.entity} の state_spec の、${accept.by} が by に並ぶイベント(${known.join(' / ') || 'なし'}。同じ ID が複数あれば {ID}@{遷移元の状態})に直してください。` +
          '当たらない受け入れは何も受け入れず、死んだ宣言として残ります。',
        { entity: access.entity, by: accept.by, events: unknown.join(',') },
      ),
    );
  }
  return findings;
}

/** `accept[]` の列が実在し、ロールが reads に現れること。 */
function checkAccepts(access: AccessSpec, entity: EntitySpec | undefined, model: SpecModel | undefined): Finding[] {
  const readers = new Set(access.reads.map((rule) => rule.by));
  const findings: Finding[] = [];
  for (const accept of access.accepts) {
    if (entity !== undefined && !groundedAcceptColumn(accept.field, entity, model)) {
      findings.push(
        error(
          `${access.entity} の accept(by: ${accept.by})の filter ${accept.field} は、entity_spec ${entity.entity} の列にありません`,
          accept.location,
          `filter をテナントを表す列の名前(${knownColumns(entity)} のいずれか)に直してください。` +
            '当たらない受け入れは何も受け入れず、死んだ宣言として残ります。',
          { entity: access.entity, by: accept.by, field: accept.field },
        ),
      );
    }
    if (model !== undefined) findings.push(...acceptEventFindings(access, accept, model));
    if (!readers.has(accept.by)) {
      findings.push(
        error(
          `${access.entity} の accept の by ${accept.by} は、この access_spec の reads に現れません`,
          accept.location,
          `by を reads の規則のロール(${[...readers].join(' / ')})に直してください。` +
            '受け入れは「その読み取り規則が境界で狭めないこと」を名指す宣言なので、規則の無いロールには当たりません。',
          { entity: access.entity, by: accept.by },
        ),
      );
    }
  }
  return findings;
}
