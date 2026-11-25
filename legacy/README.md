# legacy

The old generator and verifier (`legacy/spec-tools`), kept until the new generator takes over each kind.

- Delete on takeover: parts are removed as the new generator replaces them; the directory is empty at the end.
- Not public API and not published.
- Nothing outside `bin/` and `tests/parity/` may import it.
- It takes only fixes found by a real product, each with a sample case.
