#if APATITE_TESTS
import AppKit
import PDFKit

/// Runs only when APATITE_READERTEST points at a PDF (and APATITE_LIBRARY at a throwaway folder).
/// Drives the wheel, highlighter mode, comments, the eraser and "to notes" the way the mouse does.
@MainActor
enum ReaderTest {
    static func runIfRequested() {
        guard let path = TestRun.requested("APATITE_READERTEST") else { return }
        let t = TestRun(report: "readertest.txt"), s = t.s
        t.at(2.0) {
            s.navigation.openReader()
            if t.importPaper(path) != nil { s.reader.current.map { var i = $0; i.pagesSet = true; s.reader.update(i) } }
        }
        t.at(3.5) { wheel(t) }
        t.at(4.5) { highlighterMode(t) }
        t.at(5.5) { comments(t) }
        // to notes
        t.at(6.5) { if let c = s.reader.comments.first(where: { !$0.isPoint }) { s.openNotes(); s.navigation.readerVisible = true; s.reader.commentToNotes(c) } }
        t.at(8.0) { inNotesAndEraser(t) }
        t.at(9.0) { switchProject(t, path) }
        t.at(11.0) { reopenAfterSwitch(t) }
        t.at(12.5) { contents(t) }
        t.at(13.0) { contentsJump(t) }
    }

    /// the wheel: press, move toward "Key ideas", let go; a right click that doesn't move leaves it open
    private static func wheel(_ t: TestRun) {
        let s = t.s, items = s.reader.wheelItems
        t.log.append("wheel segments: " + items.map(\.label).joined(separator: " | "))
        s.reader.openWheel(at: CGPoint(x: 300, y: 300))
        let i = items.firstIndex { $0.label == "Key ideas" }!, seg = 360.0 / Double(items.count), a = (seg * Double(i)) * .pi / 180
        let p = CGPoint(x: 300 + sin(a) * 70, y: 300 - cos(a) * 70)
        s.reader.hoverWheel(at: p)
        t.log.append("hovering: \(s.reader.wheel?.hover.map { items[$0].label } ?? "none")")
        s.reader.releaseWheel(at: p)
        t.log.append("after release: tool \(s.reader.tool), wheel open \(s.reader.wheel != nil)")
        s.reader.openWheel(at: CGPoint(x: 300, y: 300)); s.reader.releaseWheel(at: CGPoint(x: 302, y: 301))
        t.log.append("click without moving: wheel left open \(s.reader.wheel?.sticky == true)"); s.reader.wheel = nil
    }

    /// highlighter mode: a selection is highlighted on release, no colour click
    private static func highlighterMode(_ t: TestRun) {
        let s = t.s
        if t.select("harmonious idea of people and plants") { (s.reader.pdfView as? NBPDFView)?.afterDrag(at: .zero) }
        let h = s.reader.current?.highlights.last
        t.log.append("highlighter made: \(h.map { "colour \($0.color) \"\($0.text.prefix(30))\"" } ?? "NONE")")
        if t.select("mobilisation and investment of human labour") { (s.reader.pdfView as? NBPDFView)?.afterDrag(at: .zero) }
        t.log.append("second drag, still in the mode: \(s.reader.current?.highlights.count ?? 0) highlights")
    }

    /// comments: on text, and on a point; then where they sit in the margin
    private static func comments(_ t: TestRun) {
        let s = t.s
        s.reader.tool = .comment
        if t.select("politics of cities and urbanisation") { (s.reader.pdfView as? NBPDFView)?.afterDrag(at: .zero) }
        if let id = s.reader.editingComment { s.reader.setComment(id, text: "Compare with Whatmore 2009") }
        s.reader.pdfView?.clearSelection(); s.reader.hasSelection = false
        if let v = s.reader.pdfView, let pg = s.reader.document?.page(at: 0) { (v as? NBPDFView)?.afterDrag(at: v.convert(CGPoint(x: 200, y: 400), from: pg)) }
        if let id = s.reader.editingComment { s.reader.setComment(id, text: "A point note") }
        s.reader.editingComment = nil
        t.log.append("comments: " + s.reader.comments.map { "\($0.isPoint ? "pin" : "on text") \"\($0.text)\"" + ($0.quote.isEmpty ? "" : " quoting \"\($0.quote)\"") }.joined(separator: "; "))
        if let c = s.reader.comments.first(where: { !$0.isPoint }) { s.reader.go(page: c.page, rect: c.cgRects.first) }
        s.reader.pdfView?.layoutDocumentView()
        let spots = s.reader.commentSpots(height: s.reader.pdfView?.bounds.height ?? 0)
        t.log.append("margin notes placed: \(spots.count), first at y \(Int(spots.first?.cardY ?? -1)) next to its text at y \(Int(spots.first?.anchor.first?.minY ?? -1))")
    }

    private static func inNotesAndEraser(_ t: TestRun) {
        t.page("(function(){var p=[].slice.call(document.querySelectorAll('#ed p')).find(function(x){return x.textContent.indexOf('Whatmore 2009')>=0});return p?p.textContent.slice(-140):'NOT INSERTED'})()") { r in
            t.log.append("in notes: \(r as? String ?? "?")")
        }
        erase(t)
        reopen(t)
    }

    /// eraser: click a highlight, click a comment; Esc leaves the tool
    private static func erase(_ t: TestRun) {
        let s = t.s
        s.reader.tool = .eraser
        if let h = s.reader.current?.highlights.first, let (pg, a) = s.reader.annotations(named: h.id).first, let doc = s.reader.document {
            t.log.append("erase highlight: \(s.reader.erase(at: CGPoint(x: a.bounds.midX, y: a.bounds.midY), page: doc.index(for: pg)))")
        }
        if let c = s.reader.comments.first, let r = c.cgRects.first { t.log.append("erase comment: \(s.reader.erase(at: CGPoint(x: r.midX, y: r.midY), page: c.page))") }
        t.log.append("left: \(s.reader.current?.highlights.count ?? 0) highlights, \(s.reader.comments.count) comments")
        (s.reader.pdfView as? NBPDFView)?.cancelOperation(nil)
        t.log.append("after Esc: tool \(s.reader.tool)")
    }

    /// highlights live in the library now, not the PDF: reopening the paper puts them back
    private static func reopen(_ t: TestRun) {
        let s = t.s
        let saved = s.reader.lib.loadItems().first
        t.log.append("saved with the paper: \(saved?.highlights.count ?? -1) highlights, \(saved?.comments?.count ?? -1) comments")
        let fileAnnots = PDFDocument(url: s.reader.lib.url(for: saved!))?.page(at: 0)?.annotations.count ?? -1
        if let id = s.reader.currentId { s.reader.open(id) }
        let back = (0..<(s.reader.document?.pageCount ?? 0)).reduce(0) { n, i in n + (s.reader.document?.page(at: i)?.annotations.filter { ($0.value(forAnnotationKey: .name) as? String)?.hasPrefix("snb:") == true }.count ?? 0) }
        t.log.append("PDF file untouched (page 1 annotations \(fileAnnots)); after reopening, highlight marks shown: \(back) for \(s.reader.current?.highlights.count ?? -1) highlights\(back == 0 && (s.reader.current?.highlights.count ?? 0) > 0 ? " NONE" : "")")
    }

    /// switching to another project's paper while the reader shows this one (this used to crash)
    private static func switchProject(_ t: TestRun, _ path: String) {
        let s = t.s
        let other = s.workspace.createProject(named: "Other project")
        let lib2 = Library(project: other.url)
        if let it = try? lib2.importPDF(from: URL(fileURLWithPath: path)) { lib2.saveItems([it]) }
        s.reader.pdfView?.go(to: s.reader.document!.page(at: 2)!)
        s.session.switchTo(other) { s.navigation.openReader() }
    }

    private static func reopenAfterSwitch(_ t: TestRun) {
        let s = t.s
        t.log.append("after switching project with the reader open: \(s.session.project.name), paper \(s.reader.current?.title ?? "NONE"), page label \(s.reader.pageText)")
        if let second = s.reader.items.first { s.reader.open(second.id) }
        t.log.append("opening a paper again: \(s.reader.pageText)")
        s.reader.loadTOC()
    }

    private static func contents(_ t: TestRun) {
        let s = t.s
        t.log.append("contents: \(s.reader.toc.count) entries from \(s.reader.tocSource)\(s.reader.toc.isEmpty && s.reader.document?.outlineRoot != nil ? " NONE" : "")")
        if s.reader.toc.count > 4 { s.reader.goTo(s.reader.toc[4]) }
    }

    private static func contentsJump(_ t: TestRun) {
        let s = t.s
        let want = s.reader.toc.count > 4 ? s.reader.toc[4] : nil
        t.log.append("jump to \"\(want?.title ?? "-")\" (PDF page \((want?.page ?? -2) + 1)): now on PDF page \(s.reader.currentIndex + 1), current section \"\(s.reader.currentTOCEntry.map { s.reader.toc[$0].title } ?? (s.reader.toc.isEmpty ? "-" : "NONE"))\"")
        t.finish()
    }
}

/// Runs only when APATITE_WINDOWTEST names a PDF (with APATITE_LIBRARY). Two launches:
/// the first pops the reader out and quits; the second checks it came back as it was, then docks it.
@MainActor
enum WindowTest {
    static func runIfRequested() {
        guard let path = TestRun.requested("APATITE_WINDOWTEST") else { return }
        let out = AppState.shared.workspace.root.appendingPathComponent("windowtest.txt")
        let second = FileManager.default.fileExists(atPath: out.path)
        let t = TestRun(report: "windowtest.txt", log: (try? String(contentsOf: out, encoding: .utf8)).map { [$0] } ?? [])
        if second { secondLaunch(t) } else { firstLaunch(t, path) }
    }

    private static func readerWindow() -> NSWindow? { NSApp.windows.first { $0.title.hasPrefix("Reader") && $0.isVisible } }

    private static func firstLaunch(_ t: TestRun, _ path: String) {
        let s = t.s
        t.at(2.0) {
            s.openNotes()
            t.importPaper(path)
            s.navigation.readerVisible = true
        }
        t.at(3.0) {
            if let p = s.reader.document?.page(at: 2) { s.reader.pdfView?.go(to: p) }
            s.navigation.popOutReader()
        }
        t.at(4.5) { poppedOut(t) }
    }

    private static func poppedOut(_ t: TestRun) {
        let s = t.s
        t.log.append("1st launch: popped out \(s.navigation.readerDetached), reader window open \(readerWindow() != nil) titled \"\(readerWindow()?.title ?? "-")\", main window shows the reader too: \(s.navigation.readerVisible && !s.navigation.readerDetached)")
        if t.select("politics of cities") { _ = s.reader.highlight(s.defaultKeyId) }
        t.log.append("   highlighting in the popped-out reader: \(s.reader.current?.highlights.count ?? 0) highlight(s)")
        let before = s.navigation.screen; s.navigation.openReader()
        t.log.append("   opening a paper while popped out leaves the main window as it was: \(s.navigation.screen == before && s.navigation.notesVisible)")
        if let p = s.reader.document?.page(at: 2) { s.reader.pdfView?.go(to: p) }
        t.log.append("   quitting on PDF page \(s.reader.currentIndex + 1)")
        t.finish()
    }

    private static func secondLaunch(_ t: TestRun) {
        let s = t.s
        t.at(3.0) {
            t.log.append("2nd launch: reader window reopened \(readerWindow() != nil), popped out \(s.navigation.readerDetached), paper \(s.reader.current?.title ?? "NONE"), on PDF page \(s.reader.currentIndex + 1)")
            s.navigation.dockReader()
        }
        t.at(4.0) {
            t.log.append("   after docking: reader window open \(readerWindow() != nil), reader back in main window \(s.navigation.readerVisible && !s.navigation.readerDetached)")
            t.finish()
        }
    }
}

/// Runs only when APATITE_LINKTEST names a PDF (with APATITE_LIBRARY): linking a PDF to a source that is
/// in the notebook's list while an essay (whose list lacks it) is open, then citing into that essay.
@MainActor
enum LinkTest {
    static func runIfRequested() {
        guard let path = TestRun.requested("APATITE_LINKTEST") else { return }
        let t = TestRun(report: "linktest.txt"), s = t.s
        t.at(2.0) { s.session.openEssayHere("es1") }   // the essay whose list lacks the book
        t.at(3.0) {
            t.log.append("open document's list: \(s.citations.refs.map(\.label))")
            t.log.append("Link to source offers: \(s.citations.projectRefs.map(\.label))")
            t.importPaper(path)
            s.navigation.readerVisible = true; s.navigation.notesVisible = true
        }
        t.at(4.0) { linkAndCite(t) }
        t.at(5.5) {
            t.page("(function(){var j=JSON.parse(nbFlush());return 'view '+j.view+' | essay list now: '+j.activeRefs.map(function(r){return r.authors.join(' & ')+' '+r.year}).join(', ')+' | citation: '+((document.querySelector('#ed .cite')||{}).textContent||'NONE')})()") { r in
                t.log.append("\(r as? String ?? "?")")
                t.finish()
            }
        }
    }

    private static func linkAndCite(_ t: TestRun) {
        let s = t.s
        guard let prince = s.citations.projectRefs.first(where: { $0.raw.contains("Prince") }) else { t.log.append("Prince NOT OFFERED"); return }
        s.citations.link(prince.id)
        s.reader.current.map { var i = $0; i.pagesSet = true; s.reader.update(i) }
        t.log.append("linked to: \(s.citations.currentRef?.label ?? "NONE")")
        if t.select("politics of cities") {
            s.citations.citeQuote()
            t.log.append("after Cite quote: asked for pages \(s.reader.showPages), asked to link \(s.citations.showLink)")
        } else { t.log.append("phrase not found") }
    }
}
#endif
