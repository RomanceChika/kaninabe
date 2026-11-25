/**
 * 拒否の記録の**接続点の名前**(認証の組み立ての根が export しなければならないもの)。
 *
 * 生成された Server Action(`generate/render/refusal-log-entry.ts`)が import し、H7(`auth/verifiers/h7-refusal-log.ts`)が実在を見る。
 * 名前の正をここ 1 か所にして、生成物と検査が別々に綴らない(PRIN-0007)。アプリの語彙は持たない。
 */

/** 認証の組み立ての根が export する、記録の接続点(名前順)。 */
export const REFUSAL_LOG_EXPORTS = ['recordActionRefusal', 'resolveRequestId'] as const;

/** 記録の口の名前(拒否を 1 行記録する関数)。 */
export const REFUSAL_RECORDER = 'recordActionRefusal';

/** 実行者の解決の関数の名前(パースより先に呼ぶ)。 */
export const ACTOR_RESOLVER = 'resolveActorId';
