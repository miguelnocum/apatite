import SwiftUI
import AppKit
import PDFKit

/// The papers of the open project and the one being read: its PDF, page numbers, highlights, reading tools and contents.
@MainActor
final class ReaderModel: ObservableObject {
    /// The model that owns this one (set once, when AppState is built).
    weak var app: AppState!

    var lib: Library
    @Published var items: [LibItem] = []
    @Published var currentId: String?
    @Published var document: PDFDocument?
    @Published var hasSelection = false
    @Published var selectedHL: String?
    @Published var pageText = ""
    @Published var showPages = false
    // reading tools: the wheel, the current tool, comments, the annotations list
    @Published var tool: ReaderTool = .select
    @Published var wheel: WheelState?
    @Published var layoutTick = 0
    @Published var editingComment: String?
    @Published var showAnnotations = false
    /// The reader's contents panel (remembered), and the open paper's contents.
    @Published var showContents = AppState.prefs.bool(forKey: "showContents") { didSet { AppState.prefs.set(showContents, forKey: "showContents") } }
    @Published var toc: [TOCEntry] = []
    @Published var tocSource = "none"
    var tocFor: String?
    @Published var annFilter = "all"
    weak var pdfView: PDFView?

    init(lib: Library) {
        self.lib = lib
    }

    /// The project's papers, and the one to show: the one asked for, else the one it had open last.
    func openPapers(of p: ProjectInfo, paper: String?) {
        lib = Library(project: p.url)
        items = lib.loadItems()
        currentId = paper.flatMap { id in items.first { $0.id == id }?.id } ?? rememberedPaper()
        if let id = currentId { AppState.prefs.set(id, forKey: "paper." + p.id) }
        loadCurrent()
        perfMark("switch: papers listed + remembered paper loaded")
    }

    /// PDF highlights take their colour from the key (and older ones, stored by colour name, move to key ids).
    func syncHighlightColors() {
        guard var item = current, document != nil else { return }
        var changed = false
        let marks = highlightAnnotations()
        for (i, h) in item.highlights.enumerated() {
            let id = HighlightKey.id(forStored: h.color)
            if id != h.color { item.highlights[i].color = id; changed = true }
            guard let c = app.keyColor(id) else { continue }
            for a in marks[h.id] ?? [] where a.color.hex != c.ns.hex {
                a.color = c.ns.withAlphaComponent(0.5); changed = true
            }
        }
        if changed { update(item) }
    }

    var current: LibItem? { items.first { $0.id == currentId } }

    func update(_ item: LibItem) {
        if let i = items.firstIndex(where: { $0.id == item.id }) { items[i] = item }
        lib.saveItems(items)
    }

    func importPDFs() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.pdf]
        panel.allowsMultipleSelection = true
        panel.message = "Choose PDFs to copy into your library"
        guard panel.runModal() == .OK else { return }
        if let last = copyPDFs(panel.urls) {
            app.navigation.showReader()
            open(last.id)
            if !app.citations.refs.isEmpty { app.citations.showLink = true }
        }
    }

    /// Each PDF copied into the library (a failure says so); returns the last one copied.
    private func copyPDFs(_ urls: [URL]) -> LibItem? {
        var last: LibItem?
        for url in urls {
            do {
                let item = try lib.importPDF(from: url)
                items.append(item)
                last = item
            } catch {
                app.alert = AlertItem(title: "Could not import \(url.lastPathComponent)", message: error.localizedDescription)
            }
        }
        lib.saveItems(items)
        return last
    }

    func open(_ id: String) {
        rememberPage()
        currentId = id
        AppState.prefs.set(id, forKey: "paper." + app.session.project.id)
        loadCurrent()
    }

    /// The paper this project had open last, else its first.
    func rememberedPaper() -> String? {
        let want = AppState.prefs.string(forKey: "paper." + app.session.project.id)
        return items.first { $0.id == want }?.id ?? items.first?.id
    }

    func rememberPage() {
        guard let id = currentId, document != nil, pdfView?.currentPage?.document === document else { return }
        AppState.prefs.set(currentIndex, forKey: "page." + id)
    }

    func loadCurrent() {
        selectedHL = nil
        hasSelection = false
        guard let item = current else { document = nil; pageText = ""; return }
        document = PDFDocument(url: lib.url(for: item))
        if document == nil {
            app.alert = AlertItem(title: "Could not open \(item.title)", message: "The file is missing from the library folder.")
        }
        restoreHighlights()
        updatePageText()
        syncHighlightColors()
    }

    func removeCurrent() {
        guard let item = current else { return }
        let a = NSAlert()
        a.messageText = "Remove “\(item.title)” from your library?"
        a.informativeText = "The PDF and its highlights move to the Trash. Citations in your notes keep their text and page numbers but will no longer open the PDF."
        a.addButton(withTitle: "Remove")
        a.addButton(withTitle: "Cancel")
        guard a.runModal() == .alertFirstButtonReturn else { return }
        lib.remove(item)
        items.removeAll { $0.id == item.id }
        lib.saveItems(items)
        currentId = rememberedPaper()
        loadCurrent()
    }

    func revealLibrary() { NSWorkspace.shared.activateFileViewerSelecting([lib.pdfDir]) }

    // MARK: page numbers

    var docHasLabels: Bool { document?.hasRealLabels ?? false }

    var currentIndex: Int {
        // while switching papers the view can still show the old one; its pages aren't in this document
        guard let doc = document, let p = pdfView?.currentPage, p.document === doc else { return 0 }
        let i = doc.index(for: p)
        return i == NSNotFound || i < 0 || i >= doc.pageCount ? 0 : i
    }

    func printed(_ index: Int) -> String {
        guard index >= 0, index < 1_000_000 else { return "?" }
        guard let item = current else { return String(index + 1) }
        if item.useLabels, let l = document?.page(at: index)?.label, !l.isEmpty { return l }
        return String(index &+ 1 &+ item.offset)
    }

    func updatePageText() {
        guard document != nil else { pageText = ""; return }
        pageText = "p. " + printed(currentIndex)
    }

    func setPages(useLabels: Bool, printedNumber: Int?) {
        guard var item = current else { return }
        item.useLabels = useLabels
        if !useLabels, let n = printedNumber { item.offset = n - (currentIndex + 1) }
        item.pagesSet = true
        update(item)
        updatePageText()
        showPages = false
        if app.citations.pendingCite { app.citations.pendingCite = false; DispatchQueue.main.async { self.app.citations.citeQuote() } }
    }

    // MARK: highlights

    func cleanText(_ s: String) -> String {
        var t = s.replacingOccurrences(of: "-\n", with: "")
        t = t.replacingOccurrences(of: "\u{00AD}", with: "")
        t = t.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        return t
    }

    @discardableResult
    func highlight(_ keyId: String) -> Highlight? {
        let color = app.keyColor(keyId)?.ns ?? .yellow
        guard let view = pdfView, let doc = document, var item = current,
              let sel = view.currentSelection,
              !(sel.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let id = UUID().uuidString
        let boxes = markLines(of: sel, id: id, color: color, in: doc)
        guard let first = boxes.map({ Int($0[0]) }).min(), let last = boxes.map({ Int($0[0]) }).max() else { return nil }
        let hl = Highlight(id: id, page: first, pageEnd: last, text: cleanText(sel.string ?? ""), color: keyId, boxes: boxes)
        item.highlights.append(hl)
        update(item)
        view.clearSelection()
        hasSelection = false
        selectedHL = id
        return hl
    }

    /// a highlight mark on each line of the selection; returns each mark's box as [page, x, y, width, height]
    private func markLines(of selection: PDFSelection, id: String, color: NSColor, in doc: PDFDocument) -> [[Double]] {
        var boxes: [[Double]] = []
        for line in selection.selectionsByLine() {
            for page in line.pages {
                let b = line.bounds(for: page)
                if b.width < 1 || b.height < 1 { continue }
                page.addAnnotation(Self.highlightMark(b, color: color.withAlphaComponent(Self.highlightAlpha), id: id))
                boxes.append([Double(doc.index(for: page)), b.origin.x, b.origin.y, b.width, b.height])
            }
        }
        return boxes
    }

    /// highlights are drawn at this opacity over the text
    static let highlightAlpha: CGFloat = 0.5

    /// a highlight mark, named after its highlight so it can be found again
    static func highlightMark(_ bounds: CGRect, color: NSColor, id: String) -> PDFAnnotation {
        let mark = PDFAnnotation(bounds: bounds, forType: .highlight, withProperties: nil)
        mark.color = color
        mark.setValue("snb:" + id, forAnnotationKey: .name)
        return mark
    }

    func annotations(named id: String) -> [(PDFPage, PDFAnnotation)] {
        guard let doc = document else { return [] }
        var out: [(PDFPage, PDFAnnotation)] = []
        for i in 0..<doc.pageCount {
            guard let p = doc.page(at: i) else { continue }
            for a in p.annotations where (a.value(forAnnotationKey: .name) as? String) == "snb:" + id {
                out.append((p, a))
            }
        }
        return out
    }

    /// Every highlight mark on the open PDF, by highlight id, in one pass over the pages.
    private func highlightAnnotations() -> [String: [PDFAnnotation]] {
        guard let doc = document else { return [:] }
        var out: [String: [PDFAnnotation]] = [:]
        for i in 0..<doc.pageCount {
            for a in doc.page(at: i)?.annotations ?? [] {
                if let n = a.value(forAnnotationKey: .name) as? String, n.hasPrefix("snb:") { out[String(n.dropFirst(4)), default: []].append(a) }
            }
        }
        return out
    }

    /// Takes a highlight off the page and out of the library.
    func removeHighlight(_ id: String) {
        for (p, a) in annotations(named: id) { p.removeAnnotation(a) }
        if var item = current { item.highlights.removeAll { $0.id == id }; update(item) }
        if selectedHL == id { selectedHL = nil }
    }

    func removeSelectedHighlight() {
        if let id = selectedHL { removeHighlight(id) }
    }

    func recolorSelectedHighlight(_ keyId: String) {
        let color = app.keyColor(keyId)?.ns ?? .yellow
        guard let id = selectedHL, var item = current else { return }
        for (_, a) in annotations(named: id) { a.color = color.withAlphaComponent(Self.highlightAlpha) }
        if let i = item.highlights.firstIndex(where: { $0.id == id }) { item.highlights[i].color = keyId }
        update(item)
    }

    /// Puts the stored highlights on the open PDF: adds the ones it lacks, drops ones deleted since, and
    /// fills in positions for highlights made before positions were stored (they live in the file itself).
    func restoreHighlights() {
        guard let doc = document, var item = current else { return }
        let inFile = marksInFile(doc, keeping: Set(item.highlights.map(\.id)))
        var changed = false
        for (k, h) in item.highlights.enumerated() {
            if let found = inFile[h.id] {
                if h.boxes == nil { item.highlights[k].boxes = found; changed = true }
                continue
            }
            let color = (app.keyColor(HighlightKey.id(forStored: h.color))?.ns ?? .yellow).withAlphaComponent(Self.highlightAlpha)
            for bx in h.boxes ?? [] where bx.count == 5 {
                guard let p = doc.page(at: Int(bx[0])) else { continue }
                p.addAnnotation(Self.highlightMark(CGRect(x: bx[1], y: bx[2], width: bx[3], height: bx[4]), color: color, id: h.id))
            }
        }
        if changed { update(item) }
    }

    /// The highlight marks in the file, by highlight id ([page, x, y, width, height] each); marks of highlights
    /// deleted since are taken off.
    private func marksInFile(_ doc: PDFDocument, keeping ids: Set<String>) -> [String: [[Double]]] {
        var inFile: [String: [[Double]]] = [:]
        for i in 0..<doc.pageCount {
            guard let p = doc.page(at: i) else { continue }
            for a in p.annotations {
                guard let n = a.value(forAnnotationKey: .name) as? String, n.hasPrefix("snb:") else { continue }
                let id = String(n.dropFirst(4))
                if !ids.contains(id) { p.removeAnnotation(a); continue }
                let b = a.bounds
                inFile[id, default: []].append([Double(i), b.origin.x, b.origin.y, b.width, b.height])
            }
        }
        return inFile
    }

    /// Called when a PDF view finishes loading a document.
    func pdfReady() {
        updatePageText()
        if app.citations.pendingAnchor != nil { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.app.citations.applyPendingJump() } }
        else if let id = currentId, let doc = document, let i = AppState.prefs.object(forKey: "page." + id) as? Int, i > 0, i < doc.pageCount, let p = doc.page(at: i) {
            // back to the page this paper was left on
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.pdfView?.go(to: p); self.updatePageText() }
        }
    }
}
