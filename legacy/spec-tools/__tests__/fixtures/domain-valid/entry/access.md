---
doc_type: access_spec
scope: common
id: entry-access
entity: entry
reads:
  - by: performer
    scope: own
  - by: organizer
    scope: "context(workshop)"
  - by: member
    scope: none
  - by: anonymous
    scope: none
  - by: system
    scope: all
fields_hidden:
  - field: note
    from: [member]
writes:
  - by: performer
    fields: [title, duration_min, note]
    when: "state == draft"
  - by: organizer
    fields: [note]
    when: "state in [submitted, accepted]"
---

# エントリーのアクセス権限
