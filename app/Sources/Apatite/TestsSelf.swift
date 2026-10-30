#if APATITE_TESTS
import AppKit
import PDFKit

/// Runs only when APATITE_SELFTEST points at a PDF (and APATITE_LIBRARY at a throwaway folder).
/// Exercises import → page numbers → link source → highlight + cite → jump back → save,
/// writes a report next to the library, then quits.
@MainActor
enum SelfTest {
    static func runIfRequested() {
        guard let path = TestRun.requested("APATITE_SELFTEST") else { return }
        let t = TestRun(report: "selftest.txt")
        // an essay is written in the shared editor and must never leak into Notes
        t.at(1.6) { t.s.openEssay() }
        t.at(2.0) { writeEssay(t) }
        t.at(2.3) { t.s.openNotes() }
        t.at(2.5) { importPaper(t, path) }
        t.at(4.0) { setPagesAndSource(t) }
        t.at(5.5) { citeQuote(t) }
        t.at(7.0) { jumpBack(t) }
        t.at(8.5) { checkSaved(t) }
    }

    private static func writeEssay(_ t: TestRun) {
        t.page("""
          (function(){var t=document.getElementById('etitle');t.value='Selftest essay';t.dispatchEvent(new Event('input',{bubbles:true}));
          var e=document.getElementById('ed');e.innerHTML='<p>ESSAYBODY words here</p>';e.dispatchEvent(new Event('input',{bubbles:true}));
          return e.getAttribute('data-doc')})()
          """) { r in t.log.append("essay editor: \(r as? String ?? "NONE")") }
    }

    private static func importPaper(_ t: TestRun, _ path: String) {
        let s = t.s
        do {
            let item = try s.reader.lib.importPDF(from: URL(fileURLWithPath: path))
            s.navigation.openReader() // as if Read was clicked on the welcome page
            s.reader.items.append(item); s.reader.lib.saveItems(s.reader.items); s.reader.open(item.id)
            t.log.append("import: ok, pages=\(s.reader.document?.pageCount ?? 0)")
        } catch { t.log.append("import: FAILED \(error)") }
    }

    /// the PDF view is on page 1, whose printed number is 48
    private static func setPagesAndSource(_ t: TestRun) {
        t.s.reader.setPages(useLabels: false, printedNumber: 48)
        t.log.append("pages: page 1 -> \(t.s.reader.printed(0)), page 2 -> \(t.s.reader.printed(1))")
        t.s.citations.addRef("Argüelles, L. and March, H. (2022). Weeds in action: Vegetal political ecology of unwanted plants. Progress in Human Geography, 46(1), pp.44–66.")
    }

    /// second page holds this paragraph first; a hit on page 2 tests page numbering
    private static func citeQuote(_ t: TestRun) {
        let s = t.s
        t.log.append("linked ref: \(s.citations.currentRef?.label ?? "NONE")")
        guard let doc = s.reader.document, let v = s.reader.pdfView else { t.log.append("no pdf view"); return }
        let hits = doc.findString("harmonious idea", withOptions: [.caseInsensitive])
        hits.forEach { $0.extendForLineBoundaries() }
        let hit = hits.first { doc.index(for: $0.pages[0]) == 1 } ?? hits.first
        if let hit { v.setCurrentSelection(hit, animate: false); s.reader.hasSelection = true }
        t.log.append("selection: \(hit?.string ?? "NONE") on PDF page \(hit.map { doc.index(for: $0.pages[0]) + 1 } ?? 0)")
        s.citations.citeQuote()
    }

    private static func jumpBack(_ t: TestRun) {
        let s = t.s
        let hl = s.reader.current?.highlights.last
        t.log.append("highlight stored: \(hl.map { "page \($0.page + 1), \($0.text.prefix(40))…" } ?? "NONE")")
        let annots = s.reader.document?.page(at: hl?.page ?? 0)?.annotations.filter { ($0.value(forAnnotationKey: .name) as? String)?.hasPrefix("snb:") == true }.count ?? 0
        t.log.append("annotations on page: \(annots)")
        s.reader.pdfView?.go(to: s.reader.document!.page(at: 2)!)
        s.openNotes() // jump from notes with the reader hidden, so it has to reappear first
        if let id = s.reader.current?.id, let h = hl { s.citations.jump(id + "|" + h.id) }
    }

    private static func checkSaved(_ t: TestRun) {
        t.log.append("after jump, PDF view is on PDF page \(t.s.reader.currentIndex + 1) (expected 2)")
        t.s.session.flushAll {
            logSavedSession(t, t.s.session.savedSessionJSON())
            // read the rendered citation text back out of the editor
            t.page("(document.querySelector('#ed .cite.pdf')||{}).textContent||'NONE'") { r in
                t.log.append("rendered citation: \(r as? String ?? "?")")
                let reopened = PDFDocument(url: t.s.reader.lib.url(for: t.s.reader.current!))
                let saved = reopened?.page(at: 1)?.annotations.filter { $0.type == "Highlight" }.count ?? 0
                t.log.append("highlights saved inside the PDF file on page 2: \(saved)")
                t.finish()
            }
        }
    }

    /// the citation in the saved notebook, and the essay saved apart from the notes
    private static func logSavedSession(_ t: TestRun, _ json: String) {
        if let r = json.range(of: "data-pg") {
            let start = json.index(r.lowerBound, offsetBy: -120, limitedBy: json.startIndex) ?? json.startIndex
            let end = json.index(r.upperBound, offsetBy: 160, limitedBy: json.endIndex) ?? json.endIndex
            t.log.append("saved notebook contains the citation: …\(json[start..<end])…")
        } else { t.log.append("saved notebook: NO page citation found") }
        guard let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return }
        let es = (o["essays"] as? [[String: Any]]) ?? []
        let doc = o["doc"] as? String ?? ""
        t.log.append("essays saved: \(es.count), title \(es.first?["title"] as? String ?? "NONE"), body ok \((es.first?["doc"] as? String ?? "").contains("ESSAYBODY")), notes free of essay text \(!doc.contains("ESSAYBODY"))")
    }
}

/// Runs only when APATITE_PROJECTTEST is set (with APATITE_LIBRARY at a throwaway folder).
/// Exercises what the Database does: create, move (with citations), switch, rename, delete.
@MainActor
enum ProjectTest {
    final class State { var b: ProjectInfo! }

    static func runIfRequested() {
        guard TestRun.requested("APATITE_PROJECTTEST") != nil else { return }
        let t = TestRun(report: "projecttest.txt"), a = t.s.session.project, state = State()
        t.at(2.0) { addSource(t) }
        t.at(3.5) { t.s.session.change([a]) { _ = t.ws.createEssay(in: a, title: "Draft one") } }
        t.at(5.0) { secondProject(t, state) }
        t.at(6.5) { t.s.session.change([a, state.b]) { moveCitingEssay(t, from: a, to: state.b) } }
        t.at(8.5) { checkMoved(t, from: a, to: state.b) }
        t.at(10.0) { stillGoneThenSwitch(t, from: a, to: state.b) }
        t.at(12.0) { checkSwitched(t, state) }
        t.at(13.5) { checkRenamedThenDelete(t, state) }
        t.at(15.0) {
            t.log.append("after delete: open project \(t.s.session.project.name); projects \(t.ws.projects().map(\.name))")
            t.finish()
        }
    }

    private static func secondProject(_ t: TestRun, _ state: State) {
        t.page("JSON.stringify(window.nbFlush&&JSON.parse(nbFlush()).essays.map(function(e){return e.title}))", "page essays after create")
        t.s.session.change([]) { state.b = t.ws.createProject(named: "Second project") }
    }

    /// a save from the page must not bring the moved essay back
    private static func stillGoneThenSwitch(_ t: TestRun, from a: ProjectInfo, to b: ProjectInfo) {
        t.log.append("still gone after page save: \(!t.ws.items(.essays, in: a).contains { $0.title == "Draft one" })")
        t.s.session.switchTo(b, view: "essay")
    }

    private static func checkRenamedThenDelete(_ t: TestRun, _ state: State) {
        t.log.append("after rename: open project \(t.s.session.project.name), folder \(t.s.session.project.url.lastPathComponent), papers at \(t.s.reader.lib.pdfDir.deletingLastPathComponent().lastPathComponent)")
        t.s.session.change([state.b]) { t.ws.deleteProject(state.b) }
    }

    /// a source and a citation in the notes, so moving can carry the source along
    private static func addSource(_ t: TestRun) {
        t.s.openNotes()
        t.page("""
          (function(){var r=window.nbAddRef('Smith, J. (2020). Learning machines. Press.');var id=JSON.parse(r).id;
          var e=document.getElementById('ed');e.insertAdjacentHTML('beforeend','<p>Cited <span data-cite="'+id+'"></span></p>');
          e.dispatchEvent(new Event('input',{bubbles:true}));return id})()
          """, "added source")
    }

    /// after the page has saved: the essay on disk gets the notebook's source and cites it, then moves
    private static func moveCitingEssay(_ t: TestRun, from a: ProjectInfo, to b: ProjectInfo) {
        let ws = t.ws
        guard let e = ws.items(.essays, in: a).first(where: { $0.title == "Draft one" }), var o = ws.read(e.url) else { t.log.append("essay to move: NOT FOUND"); return }
        let nbRefs = ws.items(.notebooks, in: a).first.flatMap { ws.read($0.url)?["refs"] as? [JSON] } ?? []
        let refID = (nbRefs.first?["id"] as? String) ?? "none"
        o["refs"] = Array(nbRefs.prefix(1))
        o["doc"] = "<p>Essay cites <span data-cite=\"\(refID)\"></span></p>"
        ws.write(o, to: e.url)
        ws.move(.essays, e, from: a, to: b)
    }

    private static func checkMoved(_ t: TestRun, from a: ProjectInfo, to b: ProjectInfo) {
        let ws = t.ws
        t.log.append("essay now in second project: \(ws.items(.essays, in: b).map(\.title))")
        t.log.append("essay left in first project: \(ws.items(.essays, in: a).map(\.title))")
        let movedRefs = ws.items(.essays, in: b).first.flatMap { ws.read($0.url)?["refs"] as? [JSON] }?.count ?? 0
        t.log.append("essay keeps its own sources: \(movedRefs) source(s)")
        t.page("JSON.stringify(JSON.parse(nbFlush()).essays.map(function(e){return e.title}))", "page essays after move (should be [])")
    }

    private static func checkSwitched(_ t: TestRun, _ state: State) {
        t.log.append("switched to: \(t.s.session.project.name), notebook \(t.s.session.currentNotebook?.title ?? "NONE")")
        t.page("document.getElementById('etitle')&&document.getElementById('etitle').value", "page shows essay")
        t.page("(document.querySelector('#ed span[data-cite]')||{}).textContent||'NONE'", "essay citation renders as")
        t.page("(function(){var st=JSON.parse(nbFlush());return 'essay list '+st.activeRefs.length+', notebook list '+st.refs.length})()", "separate lists (want essay 1, notebook 0)")
        t.s.session.change([state.b]) { state.b = t.ws.renameProject(state.b, to: "Renamed project") }
    }
}
#endif
