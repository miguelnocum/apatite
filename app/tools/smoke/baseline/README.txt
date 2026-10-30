Smoke reports of the Phase 0 baseline (git tag phase0-baseline; the page is identical to the tag's apart from the formatting
of web/scripts/25-folding.js, now web/scripts/editor/folding.js). Made as page-smoke.js describes. A refactor of the page must keep native.json the same:

  python3 app/tools/smoke/compare.py baseline/native.json <your run>     # prints SAME, or the steps that differ

native.json          the page as the Mac app runs it (/native/notebook.html: fake WKWebView bridge + fixture notebook).
native-bridge.json   what that run sent the fake bridge: kinds of message and how many (compare with diff, not compare.py).
web.json             the same test on the web page (/app/Resources/notebook.html), for what differs between the two modes.

How it was checked: two runs of the same build on the native page compared SAME; so did a run of notebook-old.html built from
the phase0-baseline tag. The browser pane must be showing and driven (polled from the page) while a run goes: a run that sits
in the background compares different, because layout and timer steps (equation annotation cards, comment positions) change.
The report's ResizeObserver loop warnings come and go with timing; compare.py leaves them out.

Not clean, and the same in both modes (so not the native path): `errors` holds three TypeErrors,
"Cannot read properties of undefined (reading 'options')", two in step "equation editor details" and one in "annotate".
They are the baseline; a change that adds an error, or removes these, shows in the diff.

Steps that behave differently in native mode (native.json against web.json), all of them what the app does on purpose:
  syllabus view, spec points   the notebook follows a linked syllabus: no "example syllabus" hint, and the tagging panel
                               is named after the syllabus
  essay view, essay writing,
  word count, page actions     no list of essays and no "+ New essay" in the side panel (the app opens essays from the
                               project folder); page actions reports "#newessay (missing)" and the essay list is gone
  menu hl                      an extra "Edit key…" item
  settings                     the Library and Syllabus sections are the app's (a library folder, syllabi the app keeps)
  app calls and export         Export is a message to the app (the bridge report counts it), not a download, so the
                               exported page the web step reads back is "none" there
Two steps are adjusted for native in page-smoke.js, not skipped: the Syllabus and Works Cited tabs go back to the notes when
clicked while showing (as in the app), so view() leaves them be when they are already showing.
Nothing in the test is skipped on the native page; every step ran and none threw (a "THREW:" in a step would show in the report).
