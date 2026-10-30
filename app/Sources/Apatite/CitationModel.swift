import SwiftUI
import AppKit
import PDFKit

/// Works Cited: the open document's sources, citing a quote from the open PDF into the notes, linking a PDF to a source,
/// and jumping from a citation back to its highlight.
@MainActor
final class CitationModel: ObservableObject {
    /// The model that owns this one (set once, when AppState is built).
    weak var app: AppState!

    @Published var refs: [RefInfo] = []
    @Published var showLink = false
    var pendingCite = false
    var pendingAnchor: (String, String)?
    private var refCacheKey = "", refCache: [RefInfo] = []

    static func decodeRefs(_ list: Any) -> [RefInfo] {
        guard let d = try? JSONSerialization.data(withJSONObject: list) else { return [] }
        return (try? JSONDecoder().decode([RefInfo].self, from: d)) ?? []
    }

    var currentRef: RefInfo? { app.reader.current?.refId.flatMap { id in refs.first { $0.id == id } ?? projectRefs.first { $0.id == id } } }

    /// Every source in the open project: the open document's list, then every notebook's and essay's,
    /// without repeats. A PDF belongs to the project, so it can be linked to any of them.
    var projectRefs: [RefInfo] {
        let key = "\(app.session.project.id)|\(app.session.revision)|\(refs.count)"
        if key == refCacheKey { return refCache }
        var seen = Set<String>(), out: [RefInfo] = []
        func add(_ list: [RefInfo]) {
            for r in list {
                let raw = r.raw.lowercased().trimmingCharacters(in: .whitespaces)
                if seen.contains(r.id) || seen.contains(raw) { continue }
                seen.insert(r.id); seen.insert(raw); out.append(r)
            }
        }
        add(refs)
        for k in [ItemKind.notebooks, .essays] {
            for it in app.workspace.items(k, in: app.session.project) { add(Self.decodeRefs(app.workspace.read(it.url)?["refs"] as? [JSON] ?? [])) }
        }
        refCacheKey = key; refCache = out
        return out
    }

    // MARK: citing

    func citeQuote() {
        guard var item = app.reader.current else {
            app.alert = AlertItem(title: "No PDF open", message: "Import or open a PDF, select a sentence, then cite it.")
            return
        }
        guard readyToCite(item) else { return }
        let hl = quotedHighlight(&item)
        guard let h = hl, let refId = item.refId else {
            app.alert = AlertItem(title: "Select some text first", message: "Select a sentence or paragraph in the PDF, or click an existing highlight, then choose Cite quote.")
            return
        }
        let payload: [String: String] = ["text": h.text, "refId": refId, "pg": printedPages(h), "anchor": item.id + "|" + h.id, "refRaw": currentRef?.raw ?? item.refRaw ?? ""]
        app.navigation.notesVisible = true // so the new quote is visible
        app.page.insertQuote(payload)
    }

    /// a PDF needs its source (a PDF linked from another document's list still cites: its reference comes along)
    /// and its page numbers before it can be cited; until then, those are asked for and the citing waits
    private func readyToCite(_ item: LibItem) -> Bool {
        if item.refId == nil || (currentRef == nil && item.refRaw == nil) {
            pendingCite = true; showLink = true; return false
        }
        if !item.pagesSet {
            pendingCite = true; app.reader.showPages = true; return false
        }
        return true
    }

    /// the selection, highlighted now; or the highlight clicked
    private func quotedHighlight(_ item: inout LibItem) -> Highlight? {
        if app.reader.hasSelection {
            let made = app.reader.highlight(app.defaultKeyId)
            item = app.reader.current ?? item
            return made
        }
        guard let id = app.reader.selectedHL else { return nil }
        return item.highlights.first { $0.id == id }
    }

    /// the printed page number (or range) a highlight is on
    private func printedPages(_ h: Highlight) -> String {
        var pages = app.reader.printed(h.page)
        if h.pageEnd != h.page { pages += "\u{2013}" + app.reader.printed(h.pageEnd) }
        return pages
    }

    // MARK: linking a PDF to a Works Cited entry

    func link(_ refId: String?) {
        guard var item = app.reader.current else { return }
        item.refId = refId
        item.refRaw = refId.flatMap { id in projectRefs.first { $0.id == id }?.raw }
        app.reader.update(item)
        showLink = false
        if pendingCite && refId != nil { pendingCite = false; DispatchQueue.main.async { self.citeQuote() } }
    }

    func addRef(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        app.page.addRef(trimmed) { [weak self] answer, err in
            guard let self else { return }
            guard let s = answer, let d = s.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let id = obj["id"] as? String else {
                self.app.alert = AlertItem(title: "Could not add the reference", message: err?.localizedDescription ?? "Try again.")
                return
            }
            if let list = obj["refs"] { self.refs = Self.decodeRefs(list) }
            self.link(id)
        }
    }

    // MARK: jumping from a citation to its highlight

    func jump(_ anchor: String) {
        let parts = anchor.split(separator: "|").map(String.init)
        guard parts.count == 2, app.reader.items.contains(where: { $0.id == parts[0] }) else {
            app.alert = AlertItem(title: "PDF not found", message: "The PDF for this citation is no longer in your library.")
            return
        }
        let readerOnScreen = app.reader.pdfView?.window != nil
        app.navigation.showReader()
        pendingAnchor = (parts[0], parts[1])
        // A reader that is only now appearing makes a fresh PDF view, which calls pdfReady() when loaded.
        if app.reader.currentId != parts[0] { app.reader.open(parts[0]) } else if readerOnScreen { applyPendingJump() }
    }

    func applyPendingJump() {
        guard let (docId, hlId) = pendingAnchor, docId == app.reader.currentId, let view = app.reader.pdfView else { return }
        pendingAnchor = nil
        let found = app.reader.annotations(named: hlId)
        guard let (page, _) = found.first else {
            if let h = app.reader.current?.highlights.first(where: { $0.id == hlId }), let p = app.reader.document?.page(at: h.page) { view.go(to: p) }
            return
        }
        let rect = found.filter { $0.0 == page }.map { $0.1.bounds }.reduce(found[0].1.bounds) { $0.union($1) }
        view.go(to: rect.insetBy(dx: 0, dy: -60), on: page)
        app.reader.selectedHL = hlId
        if let sel = page.selection(for: rect) {
            view.setCurrentSelection(sel, animate: true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { view.clearSelection() }
        }
    }
}
