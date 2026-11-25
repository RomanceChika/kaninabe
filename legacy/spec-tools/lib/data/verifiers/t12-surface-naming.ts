/**
 * T12 のうち **公開面(surface)の生成 migration の名前の規則**(`surface_migration` / `surface_base_migration`)。
 *
 * 新しい migration の名前は固定の綴りではなく、**外に出すスキーマの名前 `PlatformProfile.exposedSchema`** から導く:
 *
 *   - ビュー … `{14 桁}_{exposedSchema}_view_{表名}.sql`
 *   - 土台   … `{14 桁}_{exposedSchema}_base.sql`
 *
 * いまの後段(SQL がそのまま公開面になる構成)は `exposedSchema = api` なので、従来の綴り(`_api_view_` / `_api_base`)と同じになる(差分 0)。
 *
 * ## 規則はいつも照らす(適用済みかどうかを機械が推測しない)
 *
 * 宣言された名前は、置き場にファイルがあるかどうかに関わらず**いつも**この規則と照らす。「置き場に既にある = 適用済み」と読んで免除すると、
 * 生成が先に書いたファイルが規則を素通りしてしまう(適用済みかどうかは置き場の実在では決まらない)。食い違ったときは 2 つの場合を名指す ——
 * 新しい migration なら名前を直す。適用済みの migration の公開スキーマを改名したのなら、適用済みの migration は名前を動かせない
 * (`check:migrations`)ので、適用済みの名前の付け替えの規則は無い(未対応)。どちらなのかは人が決める。
 */

import type { PlatformProfile } from '../../model/product/platform-profile.js';
import { MIGRATION_SEQUENCE } from './migration-sequence.js';

/** 公開面の判定が `PlatformProfile` から読む 2 つの値(名前の規則の `exposedSchema` と、公開面を外へ出せるかの能力 `surfaceExposure`)。 */
export type SurfacePlatform = Pick<PlatformProfile, 'exposedSchema' | 'surfaceExposure'>;

/** 名前の判定の結果。 */
export type NameVerdict = { readonly kind: 'ok' } | { readonly kind: 'bad'; readonly expected: string };

/** 規則が見る migration の種類(ビューは表ごと・土台は系に 1 本)。 */
export type SurfaceMigrationKind = { readonly kind: 'view'; readonly table: string } | { readonly kind: 'base' };

/** 連番の後ろの形(`_{スキーマ名}_view_{表名}.sql` / `_{スキーマ名}_base.sql`)。 */
function tailOf(kind: SurfaceMigrationKind, exposedSchema: string): string {
  return kind.kind === 'view' ? `_${exposedSchema}_view_${kind.table}.sql` : `_${exposedSchema}_base.sql`;
}

/**
 * 宣言された migration の名前を、名前の規則で判定する(置き場の実在は見ない)。
 *
 * @param migration 宣言された migration のファイル名
 * @param kind ビュー(表名つき)か土台か
 * @param exposedSchema 外に出すスキーマの名前
 * @returns 規則に合う / 合わない(期待する形つき)
 */
export function judgeSurfaceName(migration: string, kind: SurfaceMigrationKind, exposedSchema: string): NameVerdict {
  const expected = tailOf(kind, exposedSchema);
  const index = migration.indexOf('_');
  const sequence = index === -1 ? '' : migration.slice(0, index);
  const tail = index === -1 ? '' : migration.slice(index);
  return MIGRATION_SEQUENCE.test(sequence) && tail === expected ? { kind: 'ok' } : { kind: 'bad', expected };
}

/**
 * 規則に合わない名前への対処(新しい migration の場合と、適用済みの migration の公開スキーマを改名した場合の両方を名指す)。
 *
 * @param expected 期待する連番の後ろの形
 * @param shape 何の migration か(「表 1 枚につきビュー 1 枚」など、文の続き)
 */
export function nameSuggestion(expected: string, shape: string): string {
  return (
    `新しい migration なら "{14 桁の連番}${expected}" の形に直す(${shape}。公開スキーマの名前は exposedSchema から導く)。` +
    '適用済みの migration の公開スキーマを改名したのなら、適用済みの migration は名前を動かせず、名前の付け替えの規則はまだ無い(未対応)' +
    ' — exposedSchema を元に戻すか、この規則を足す設計を先に行う'
  );
}
