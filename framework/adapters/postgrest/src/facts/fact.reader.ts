import type { FactReader, FactScalar } from '@kaninabe/runtime/ports';
import { dbFailure, type PostgrestErrorLike } from '../rpc/rpc-outcome';

/**
 * **汎用の事実リーダー**（保存点の `permit` が要る「保存点の外の行」を読む口）。
 *
 * 仕様: docs/rules/decisions/common/ADR-0011-usecase-layer-two-origins.md §4
 *       docs/specs/frontend/usecases/*.md（保存点の `steps`。読む表と列は生成物
 *       `@/domain/generated/usecase-plans` の `reads` が持つ）
 *
 * 集約ごとのリーダー（`{集約}.reader.ts`）と違い、**この口は集約を知らない**。表名と列名は
 * 実行計画（仕様からの生成物）が渡し、ここは「その表のその行のその列を読む」だけを行う。
 * 保存点は集約をまたいで書くので、集約ごとの口を並べると保存点の数だけ配線が増える
 * ——「軸は仕組み・語はアプリ」に従い、軸（1 行を id で引く）だけをここに置く。
 *
 * 読むのは `api` スキーマのビューであり、クライアントは service role である
 * （書き込み経路の判断材料であって画面に返す読み取りではない。ARCH-BE-0016 の線の内側）。
 */

/**
 * 表名を実行時に決める最小の口。
 *
 * `AppSupabaseClient` を丸ごと受け取らずこの形にするのは、要る能力がこれだけだからである
 * （`query-window.ts` の `ActorFilterable` と同じ構え）。生成した列名の並びを `.select()` に
 * 渡すため、Supabase の型引数（列名のリテラル型）にはここでは踏み込まない。
 */
export interface RowSource {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: unknown;
          error: PostgrestErrorLike | null;
        }>;
      };
    };
  };
}

/** 読んだ行を、ガード式が扱えるスカラーだけの表に写す（それ以外の型の列は落とす）。 */
function toFacts(row: Record<string, unknown>, fields: readonly string[]): Readonly<Record<string, FactScalar>> {
  const facts: Record<string, FactScalar> = {};
  for (const field of fields) {
    const value = row[field];
    if (value === null || value === undefined) {
      facts[field] = null;
      continue;
    }
    // 集合・オブジェクトはガード式が扱えない（`GuardValue` はスカラーだけ）。
    // 読めた事実だけを載せ、載らなかった変数はエンジンが `guard_unknown` として診断する。
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      facts[field] = value;
    }
  }
  return facts;
}

/**
 * `FactReader` を作る。
 *
 * **接続層そのものは受け取らない。** 表名を実行時に決めるので、列名のリテラル型に依存した
 * Supabase の型は通さない（通すと全表 × 全列の組み合わせを解こうとして型の展開が発散する）。
 * 要る能力は `RowSource` の 3 メソッドだけであり、実クライアントをその形に適合させるのは
 * **製品の接続層の仕事**である（`rowSourceOf`。ADR-0013 §3-1 のポート）。
 *
 * @param source - 表・行・列を指定して読む最小の口
 * @returns 表・行・列を指定して読む口
 */
export function createFactReader(source: RowSource): FactReader {
  return {
    async readFields(table, id, fields) {
      const { data, error } = await source.from(table).select(fields.join(',')).eq('id', id).maybeSingle();
      // 手書きのリポジトリと同じ作り方(点検 19 回目 B19-1。SQLSTATE を欄に、DB の文言は cause に)。
      if (error !== null) throw dbFailure(`${table} の取得`, error);
      if (data === null || typeof data !== 'object') return null;
      return toFacts(data as Record<string, unknown>, fields);
    },
  };
}
