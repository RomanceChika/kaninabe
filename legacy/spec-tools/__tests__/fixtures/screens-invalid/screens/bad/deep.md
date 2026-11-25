---
doc_type: screen_spec
scope: frontend
id: screen-deep

name: deep
route: /deep
for: [member]

overlays:
  - id: ReportDialog
    layout:
      body:
        center: [report_form]

layout:
  body:
    center:
      - own_entry:
          footer:
            - inner_panel:
                header:
                  - deeper_panel:
                      footer: [too_deep]
    left:
      - variants: {}
    right:
      - variants: [not_a_mapping]
---

# 入れ子が深すぎる画面と、snake_case でない重ね表示 id(fixture)
