/**
 * **Axiom へのログの転送の adapter**(`@kaninabe/adapter-log-axiom`)の公開の入口。
 *
 * 中立の口(`@kaninabe/runtime/log-sink` の `LogSink`)の Axiom 向けの実装だけを持つ。鍵があるときだけ有効にする配線は製品が持つ
 * (環境変数の読み方・`after()` に載せる段取り)。**サーバー専用の印は置かない**(他の adapter と同じ。印は製品の配線が持つ)。
 */

export { AXIOM_DEFAULT_DOMAIN, AXIOM_DEFAULT_TIMEOUT_MS, AXIOM_MAX_BATCH, axiomSinkFromValues, createAxiomSink } from './axiom-sink';
export type { AxiomEnvValues, AxiomSinkOptions } from './axiom-sink';
