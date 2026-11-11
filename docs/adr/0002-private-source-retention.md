# 0002 Private source retention

Date: 2026-10-28. Ticket: DAV-406.

Full source text, full quotations with context, and raw provider responses are kept in a private directory outside git: `.cache/private-sources/` by default, or `PC_PRIVATE_DIR`. Files are written once with mode 0600 and never overwritten; snapshot files are named and checked by their sha256.

This is the operator's local disk. It is not durable beyond that machine and is not shared with CI. Consequences:

- CI cannot re-verify a quotation against full text. Quotation checks run where the private text exists, and their results (status, offsets, quote hash, normalisation version) are recorded in public records that CI checks for consistency.
- If the private directory is lost, a public hash cannot reconstruct a source. New assessments then need a fresh capture, and the coverage page says so.
- Public CI artifacts are never treated as private.

Durable private retention (an encrypted bucket or a private repository the owner controls) is an open owner decision. Until then the limit is stated on /method and /coverage.
