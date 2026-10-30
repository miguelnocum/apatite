import SwiftUI
import AppKit
import PDFKit
import WebKit
import UniformTypeIdentifiers

struct AlertItem: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

enum Screen: String {
    case welcome, workspace, database, deck
}

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    let workspace = Workspace()
    /// Remembered project and notebooks. Test runs (APATITE_LIBRARY set) keep their own, so they never
    /// change which project the real app reopens.
    static let prefs: UserDefaults = ProcessInfo.processInfo.environment["APATITE_LIBRARY"] != nil
        ? (UserDefaults(suiteName: "local.tracy.apatite.tests") ?? .standard) : .standard

    /// The open project and notebook; Notes, Essay and Read all work inside them.
    @Published var project: ProjectInfo
    @Published var notebookId: String?
    /// Bumped whenever files change, so lists and menus re-read them.
    @Published var revision = 0
    var lib: Library
    @Published var items: [LibItem] = []
    @Published var refs: [RefInfo] = []
    @Published var currentId: String?
    @Published var document: PDFDocument?
    @Published var screen: Screen = .welcome
    @Published var notesVisible = true
    @Published var readerVisible = false
    /// The page's focus mode (just the notes and the formatting bar); the window follows it (see FocusMode.swift).
    @Published var focusMode = false
    /// the page's colour in focus mode, for the title bar over it
    @Published var focusBG: String?
    @Published var welcomeTitle = WelcomeTitles.random()
    @Published var hasSelection = false
    @Published var selectedHL: String?
    @Published var pageText = ""
    @Published var showLink = false
    @Published var showPages = false
    @Published var alert: AlertItem?
    /// What each highlighter colour is for; shared by notes, essays and the PDF reader.
    @Published var hlKey: [KeyColor] = []
    @Published var showKeyEditor = false
    // reading tools: the wheel, the current tool, comments, the annotations list
    @Published var tool: ReaderTool = .select
    @Published var wheel: WheelState?
    @Published var layoutTick = 0
    @Published var editingComment: String?
    @Published var showAnnotations = false
    /// The deck open in the study screen.
    @Published var deck: Deck?
    var deckURL: URL?
    var deckProject: ProjectInfo?
    var deckSave: DispatchWorkItem?
    /// The deck in its own window (beside the notes), and how that window is opened and closed (set by the main window).
    @Published var deckDetached = false
    var openDeckWindow: (() -> Void)?
    var closeDeckWindow: (() -> Void)?
    /// The next deck view starts in Edit (it was opened to add cards).
    var deckStartEdit = false
    /// The notebook's theme, for the native parts of the app (nil: follow macOS).
    @Published var theme: AppTheme? = AppState.savedTheme()
    /// The reader's contents panel (remembered), and the open paper's contents.
    @Published var showContents = AppState.prefs.bool(forKey: "showContents") { didSet { Self.prefs.set(showContents, forKey: "showContents") } }
    @Published var toc: [TOCEntry] = []
    @Published var tocSource = "none"
    var tocFor: String?
    @Published var annFilter = "all"
    /// The reader in its own window (for a second monitor); remembered across launches.
    @Published var readerDetached = AppState.prefs.bool(forKey: "readerDetached") {
        didSet { if !quitting { Self.prefs.set(readerDetached, forKey: "readerDetached") } }
    }
    private var refCacheKey = "", refCache: [RefInfo] = []
    /// Set while the app quits, so windows closing don't count as "docked again".
    var quitting = false
    /// Opens or brings forward the reader window (set by the main window, which has openWindow).
    var openReaderWindow: (() -> Void)?
    var closeReaderWindow: (() -> Void)?

    /// A folder of papers waiting to be placed (shows the import sheet).
    @Published var folderImport: FolderImportRequest?
    var defaultKeyId: String { hlKey.first { !$0.hidden }?.id ?? "1" }
    func keyColor(_ id: String) -> KeyColor? { hlKey.first { $0.id == HighlightKey.id(forStored: id) } }

    /// The notes editor lives for the whole session, so moving between screens never reloads it or drops typing.
    lazy var webView: WKWebView? = NotebookWebView.makeWebView()
    weak var pdfView: PDFView?
    var pendingCite = false
    private var pendingAnchor: (String, String)?

    /// Which load of the notebook page is current; saves from an earlier load are ignored.
    private(set) var pageGen = 0
    /// The page's own view and essay, reported with each save, so a reload can return to them.
    private(set) var pageView = "notes", pageEssay: String?

    init() {
        hlKey = HighlightKey.load(workspace.root)
        let all = workspace.projects()
        let p = workspace.project(Self.prefs.string(forKey: "project")) ?? all[0]
        project = p
        lib = Library(project: p.url)
        notebookId = Self.pickNotebook(workspace, p, Self.prefs.string(forKey: "notebook." + p.id))
        items = lib.loadItems()
        refs = Self.decodeRefs(workspace.read(workspace.item(.notebooks, notebookId, in: p)?.url ?? p.url)?["refs"] as? [JSON] ?? workspace.refs(of: p))
        currentId = rememberedPaper()
        loadCurrent()
    }

    // MARK: projects

    var currentNotebook: DocItem? { workspace.item(.notebooks, notebookId, in: project) }

    /// The remembered notebook if it still exists, else the newest, else a new one.
    private static func pickNotebook(_ ws: Workspace, _ p: ProjectInfo, _ want: String?) -> String {
        let nbs = ws.items(.notebooks, in: p)
        return (nbs.first { $0.id == want } ?? nbs.first ?? ws.createNotebook(in: p, title: "Notebook")).id
    }

    private static func decodeRefs(_ list: Any) -> [RefInfo] {
        guard let d = try? JSONSerialization.data(withJSONObject: list) else { return [] }
        return (try? JSONDecoder().decode([RefInfo].self, from: d)) ?? []
    }

    private func remember() {
        Self.prefs.set(project.id, forKey: "project")
        if let n = notebookId { Self.prefs.set(n, forKey: "notebook." + project.id) }
    }

    /// Essays converted for a project whose page is still loading.
    private var pendingImports: [EssayImport.Result] = []

    /// Word, PDF (and .doc/.rtf/.odt) files into essays: into the open project, or another one from the Database.
    func importEssays(into target: ProjectInfo? = nil) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.pdf, .rtf] + ["docx", "doc", "odt"].compactMap { UTType(filenameExtension: $0) }
        panel.allowsMultipleSelection = true
        panel.message = "Choose Word documents or PDFs to import as essays"
        panel.prompt = "Import"
        guard panel.runModal() == .OK else { return }
        var results: [EssayImport.Result] = [], failed: [String] = []
        for u in panel.urls {
            do { results.append(try EssayImport.convert(u)) } catch { failed.append("\(u.lastPathComponent): \(error.localizedDescription)") }
        }
        deliverImports(results, into: target ?? project)
        if !failed.isEmpty { alert = AlertItem(title: "Some files could not be imported", message: failed.joined(separator: "\n")) }
    }

    func deliverImports(_ r: [EssayImport.Result], into p: ProjectInfo) {
        guard !r.isEmpty else { return }
        if p.id == project.id, webView != nil {
            showEditor()
            page.importEssays(r)
        } else {
            pendingImports = r
            switchTo(p, view: "essay") { [self] in showEditor() }
        }
    }

    /// The script the notebook page boots with.
    func bootScript(view: String? = nil, essay: String? = nil) -> String {
        PageBridge.bootScript(notebook: workspace.sessionJSON(project, notebook: currentNotebook), gen: pageGen, view: view, essay: essay,
                              imports: takePendingImports(), key: hlKey, library: workspace.root.path, settings: pendingSettings)
    }

    /// The notes page, to call its entry points.
    var page: PageBridge { PageBridge(web: webView) }

    /// Saves the key, tells the page, and repaints the open PDF's highlights.
    func setHighlightKey(_ key: [KeyColor]) {
        hlKey = key
        HighlightKey.save(key, workspace.root)
        page.setKey(hlKey)
        syncHighlightColors()
    }

    /// PDF highlights take their colour from the key (and older ones, stored by colour name, move to key ids).
    func syncHighlightColors() {
        guard var item = current, document != nil else { return }
        var changed = false
        let marks = highlightAnnotations()
        for (i, h) in item.highlights.enumerated() {
            let id = HighlightKey.id(forStored: h.color)
            if id != h.color { item.highlights[i].color = id; changed = true }
            guard let c = keyColor(id) else { continue }
            for a in marks[h.id] ?? [] where a.color.hex != c.ns.hex {
                a.color = c.ns.withAlphaComponent(0.5); changed = true
            }
        }
        if changed { update(item) }
    }

    private func takePendingImports() -> String {
        defer { pendingImports = [] }
        return PageBridge.importsJSON(pendingImports)
    }

    /// Saves the page, then loads it again for the current project and notebook.
    private func reloadPage(view: String?, essay: String?) {
        pageGen += 1
        if let web = webView { NotebookWebView.reload(web, boot: bootScript(view: view, essay: essay)) }
    }

    /// The project's papers, and the one to show: the one asked for, else the one it had open last.
    private func openPapers(of p: ProjectInfo, paper: String?) {
        lib = Library(project: p.url)
        items = lib.loadItems()
        currentId = paper.flatMap { id in items.first { $0.id == id }?.id } ?? rememberedPaper()
        if let id = currentId { Self.prefs.set(id, forKey: "paper." + p.id) }
        loadCurrent()
        perfMark("switch: papers listed + remembered paper loaded")
    }

    /// Opens a project (and optionally a notebook, view or essay in it). Everything open is saved first.
    func switchTo(_ p: ProjectInfo, notebook nid: String? = nil, view: String? = nil, essay: String? = nil, paper: String? = nil, then: (() -> Void)? = nil) {
        perfMark("switch: start")
        flushAll { [self] in
            perfMark("switch: page saved (flush)")
            let sameProject = p.id == project.id
            if !sameProject { rememberPage() }
            project = p
            if !sameProject || lib.root != p.url { openPapers(of: p, paper: paper) }
            notebookId = Self.pickNotebook(workspace, p, nid ?? Self.prefs.string(forKey: "notebook." + p.id))
            refs = Self.decodeRefs(workspace.refs(of: p))
            remember()
            perfMark("switch: notebook + refs")
            reloadPage(view: view ?? (sameProject ? pageView : "notes"), essay: essay ?? (sameProject ? pageEssay : nil))
            perfMark("switch: page reload started")
            revision += 1
            then?()
            perfMark("switch: then (open paper / show screen)")
            DispatchQueue.main.async { perfMark("switch: next run loop (SwiftUI redraw done)") }
        }
    }

    func openNotebook(_ p: ProjectInfo, _ id: String) {
        if p.id == project.id && id == notebookId {
            // already loaded in the page: just show it
            showEditor()
            page.show("notes")
            return
        }
        switchTo(p, notebook: id, view: "notes") { [self] in showEditor() }
    }

    /// A syllabus opens in the Syllabus view of a notebook that follows it (a new one if none does yet).
    func openSyllabus(_ p: ProjectInfo, _ sid: String) {
        var nb = workspace.users(of: sid, in: p).first { $0.0 == .notebooks }?.1
        if nb == nil {
            let t = workspace.item(.syllabi, sid, in: p)?.title ?? "Syllabus"
            let made = workspace.createNotebook(in: p, title: t + " notes")
            workspace.linkSyllabus(.notebooks, made.id, to: sid, in: p)
            nb = made
        }
        guard let id = nb?.id else { return }
        switchTo(p, notebook: id, view: "syl") { [self] in showEditor() }
    }

    func openEssay(_ p: ProjectInfo, _ id: String) {
        if p.id == project.id { openEssayHere(id); return }  // its project's essays are already in the page
        switchTo(p, view: "essay", essay: id) { [self] in showEditor() }
    }

    func openPaper(_ p: ProjectInfo, _ id: String) {
        if p.id == project.id { if id != currentId { open(id) }; openReader(); return }
        switchTo(p, paper: id) { [self] in openReader() }
    }

    /// Essays in the open project are already in the page, so opening or making one needs no reload.
    func openEssayHere(_ id: String) {
        showEditor()
        page.openEssay(id)
    }

    func newEssay() {
        showEditor()
        page.newEssay()
    }

    /// The notes or essay editor fills the window.
    func showEditor() {
        notesVisible = true; readerVisible = false; screen = .workspace
    }

    func newNotebook() {
        let nb = workspace.createNotebook(in: project, title: "Untitled notebook")
        openNotebook(project, nb.id)
    }

    /// Database changes: save the page first, change the files, then reload whatever they touched.
    /// `then` runs once the change is made (the save comes first, so that is a moment later).
    func change(_ touched: [ProjectInfo], _ f: @escaping () -> Void, then: (() -> Void)? = nil) {
        flushAll { [self] in
            defer { then?() }
            f()
            revision += 1
            // the open project may have been renamed or deleted
            let ps = workspace.projects()
            let p = ps.first { $0.id == project.id } ?? ps.first ?? workspace.createProject(named: "Untitled project")
            if p != project || touched.contains(where: { $0.id == project.id }) { reloadProject(p) }
        }
    }

    /// Everything shown from the open project, read again (it may have moved).
    private func reloadProject(_ p: ProjectInfo) {
        let moved = lib.root != p.url || p.id != project.id
        project = p
        if moved { lib = Library(project: p.url) }
        items = lib.loadItems()
        if current == nil { currentId = rememberedPaper() }
        loadCurrent()
        notebookId = Self.pickNotebook(workspace, p, notebookId)
        refs = Self.decodeRefs(workspace.refs(of: p))
        remember()
        reloadPage(view: pageView, essay: pageEssay)
    }

    /// For the self-test: what is on disk for the open project and notebook.
    func savedSessionJSON() -> String { workspace.sessionJSON(project, notebook: currentNotebook) }

    // MARK: screens

    func goHome() {
        welcomeTitle = WelcomeTitles.random(excluding: welcomeTitle)
        screen = .welcome
    }

    /// The home button (⌘0): the project's folder, its notebooks, syllabi, essays and decks, to switch between them
    /// (the Database, opened at the project)
    func openProjectFolder() { screen = .database }

    func openNotes() { openEditor("notes") }

    /// Settings (⌘,) live in the editor page; from Home or the database, the editor comes up first.
    /// `section` opens one part of it ("key" for the highlight key…).
    var pendingSettings: String?
    func openSettings(_ section: String? = nil) {
        showEditor()
        page.openSettings(section)
    }
    func openEssay() { openEditor("essay") }

    /// Notes and Essay share the one editor page; this picks which document it shows.
    private func openEditor(_ view: String) {
        showEditor()
        page.showOrQueue(view)
    }
    func openReader() {
        if readerDetached { openReaderWindow?(); return }
        notesVisible = false; readerVisible = true; screen = .workspace
    }

    /// The ↗ button: the reader moves to its own window; the main window keeps the writing.
    func popOutReader() {
        readerDetached = true
        notesVisible = true; readerVisible = false
        openReaderWindow?()
    }

    /// The ↙ button (or closing the reader window): back into the main window beside the writing.
    func dockReader() {
        guard readerDetached else { return }
        readerDetached = false
        closeReaderWindow?()
        readerVisible = true; screen = .workspace
    }

    /// Show or hide one side of the workspace; hiding the only visible side swaps to the other.
    func toggleNotes() {
        if screen != .workspace { openNotes(); return }
        notesVisible.toggle()
        if !notesVisible && !readerVisible { readerVisible = true }
    }

    func toggleReader() {
        if readerDetached { openReaderWindow?(); return }
        if screen != .workspace { openReader(); return }
        readerVisible.toggle()
        if !notesVisible && !readerVisible { notesVisible = true }
    }

    private func showReader() {
        if readerDetached { openReaderWindow?(); return }
        readerVisible = true
        screen = .workspace
    }

    // MARK: library

    var current: LibItem? { items.first { $0.id == currentId } }
    var currentRef: RefInfo? { current?.refId.flatMap { id in refs.first { $0.id == id } ?? projectRefs.first { $0.id == id } } }

    /// Every source in the open project: the open document's list, then every notebook's and essay's,
    /// without repeats. A PDF belongs to the project, so it can be linked to any of them.
    var projectRefs: [RefInfo] {
        let key = "\(project.id)|\(revision)|\(refs.count)"
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
            for it in workspace.items(k, in: project) { add(Self.decodeRefs(workspace.read(it.url)?["refs"] as? [JSON] ?? [])) }
        }
        refCacheKey = key; refCache = out
        return out
    }

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
            showReader()
            open(last.id)
            if !refs.isEmpty { showLink = true }
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
                alert = AlertItem(title: "Could not import \(url.lastPathComponent)", message: error.localizedDescription)
            }
        }
        lib.saveItems(items)
        return last
    }

    func open(_ id: String) {
        rememberPage()
        currentId = id
        Self.prefs.set(id, forKey: "paper." + project.id)
        loadCurrent()
    }

    /// The paper this project had open last, else its first.
    func rememberedPaper() -> String? {
        let want = Self.prefs.string(forKey: "paper." + project.id)
        return items.first { $0.id == want }?.id ?? items.first?.id
    }

    func rememberPage() {
        guard let id = currentId, document != nil, pdfView?.currentPage?.document === document else { return }
        Self.prefs.set(currentIndex, forKey: "page." + id)
    }

    private func loadCurrent() {
        selectedHL = nil
        hasSelection = false
        guard let item = current else { document = nil; pageText = ""; return }
        document = PDFDocument(url: lib.url(for: item))
        if document == nil {
            alert = AlertItem(title: "Could not open \(item.title)", message: "The file is missing from the library folder.")
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
        if pendingCite { pendingCite = false; DispatchQueue.main.async { self.citeQuote() } }
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
        let color = keyColor(keyId)?.ns ?? .yellow
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
        let color = keyColor(keyId)?.ns ?? .yellow
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
            let color = (keyColor(HighlightKey.id(forStored: h.color))?.ns ?? .yellow).withAlphaComponent(Self.highlightAlpha)
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

    // MARK: citing

    func citeQuote() {
        guard var item = current else {
            alert = AlertItem(title: "No PDF open", message: "Import or open a PDF, select a sentence, then cite it.")
            return
        }
        guard readyToCite(item) else { return }
        let hl = quotedHighlight(&item)
        guard let h = hl, let refId = item.refId else {
            alert = AlertItem(title: "Select some text first", message: "Select a sentence or paragraph in the PDF, or click an existing highlight, then choose Cite quote.")
            return
        }
        let payload: [String: String] = ["text": h.text, "refId": refId, "pg": printedPages(h), "anchor": item.id + "|" + h.id, "refRaw": currentRef?.raw ?? item.refRaw ?? ""]
        notesVisible = true // so the new quote is visible
        page.insertQuote(payload)
    }

    /// a PDF needs its source (a PDF linked from another document's list still cites: its reference comes along)
    /// and its page numbers before it can be cited; until then, those are asked for and the citing waits
    private func readyToCite(_ item: LibItem) -> Bool {
        if item.refId == nil || (currentRef == nil && item.refRaw == nil) {
            pendingCite = true; showLink = true; return false
        }
        if !item.pagesSet {
            pendingCite = true; showPages = true; return false
        }
        return true
    }

    /// the selection, highlighted now; or the highlight clicked
    private func quotedHighlight(_ item: inout LibItem) -> Highlight? {
        if hasSelection {
            let made = highlight(defaultKeyId)
            item = current ?? item
            return made
        }
        guard let id = selectedHL else { return nil }
        return item.highlights.first { $0.id == id }
    }

    /// the printed page number (or range) a highlight is on
    private func printedPages(_ h: Highlight) -> String {
        var pages = printed(h.page)
        if h.pageEnd != h.page { pages += "\u{2013}" + printed(h.pageEnd) }
        return pages
    }

    // MARK: linking a PDF to a Works Cited entry

    func link(_ refId: String?) {
        guard var item = current else { return }
        item.refId = refId
        item.refRaw = refId.flatMap { id in projectRefs.first { $0.id == id }?.raw }
        update(item)
        showLink = false
        if pendingCite && refId != nil { pendingCite = false; DispatchQueue.main.async { self.citeQuote() } }
    }

    func addRef(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        page.addRef(trimmed) { [weak self] answer, err in
            guard let self else { return }
            guard let s = answer, let d = s.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let id = obj["id"] as? String else {
                self.alert = AlertItem(title: "Could not add the reference", message: err?.localizedDescription ?? "Try again.")
                return
            }
            if let list = obj["refs"] { self.refs = Self.decodeRefs(list) }
            self.link(id)
        }
    }

    // MARK: jumping from a citation to its highlight

    func jump(_ anchor: String) {
        let parts = anchor.split(separator: "|").map(String.init)
        guard parts.count == 2, items.contains(where: { $0.id == parts[0] }) else {
            alert = AlertItem(title: "PDF not found", message: "The PDF for this citation is no longer in your library.")
            return
        }
        let readerOnScreen = pdfView?.window != nil
        showReader()
        pendingAnchor = (parts[0], parts[1])
        // A reader that is only now appearing makes a fresh PDF view, which calls pdfReady() when loaded.
        if currentId != parts[0] { open(parts[0]) } else if readerOnScreen { applyPendingJump() }
    }

    /// Called when a PDF view finishes loading a document.
    func pdfReady() {
        updatePageText()
        if pendingAnchor != nil { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.applyPendingJump() } }
        else if let id = currentId, let doc = document, let i = Self.prefs.object(forKey: "page." + id) as? Int, i > 0, i < doc.pageCount, let p = doc.page(at: i) {
            // back to the page this paper was left on
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.pdfView?.go(to: p); self.updatePageText() }
        }
    }

    private func applyPendingJump() {
        guard let (docId, hlId) = pendingAnchor, docId == currentId, let view = pdfView else { return }
        pendingAnchor = nil
        let found = annotations(named: hlId)
        guard let (page, _) = found.first else {
            if let h = current?.highlights.first(where: { $0.id == hlId }), let p = document?.page(at: h.page) { view.go(to: p) }
            return
        }
        let rect = found.filter { $0.0 == page }.map { $0.1.bounds }.reduce(found[0].1.bounds) { $0.union($1) }
        view.go(to: rect.insetBy(dx: 0, dy: -60), on: page)
        selectedHL = hlId
        if let sel = page.selection(for: rect) {
            view.setCurrentSelection(sel, animate: true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { view.clearSelection() }
        }
    }

    // MARK: messages from the notebook

    /// what each kind of message from the page does
    func receive(_ message: PageMessage) {
        switch message {
        case .save(let json, let gen): receiveSave(json, gen: gen)
        case .theme(let colours): setTheme(colours)
        case .focus(let on, let bg): setFocusMode(on, bg: bg)
        case .linkSyllabus(let id, let view): linkNotebookSyllabus(id, view: view)
        case .editKey: openSettings("key")
        case .setKey(let key): setHighlightKey(key)
        case .linkDocSyllabus(let kind, let id, let syllabus): linkDocSyllabus(kind, id, syllabus)
        case .revealLibrary: NSWorkspace.shared.activateFileViewerSelecting([workspace.root])
        case .importEssay: importEssays()
        case .openAnchor(let anchor): jump(anchor)
        case .export(let html, let filename): export(html: html, name: filename)
        }
    }

    /// a save from a page load that has since been replaced belongs to files that may have moved on
    private func receiveSave(_ json: String, gen: Int?) {
        if let g = gen, g != pageGen { return }
        persist(json)
    }

    /// the open notebook follows another syllabus (or none, or a new one); the page reloads on its syllabus
    private func linkNotebookSyllabus(_ v: String, view: String?) {
        flushAll { [self] in
            guard let nb = currentNotebook else { return }
            var sid: String? = v.isEmpty ? nil : v
            if v == "__new" { sid = workspace.createSyllabus(in: project, title: nb.title + " syllabus").id }
            workspace.linkSyllabus(.notebooks, nb.id, to: sid, in: project)
            reloadPage(view: view ?? "syl", essay: nil)
            revision += 1
        }
    }

    /// another notebook, or a deck, following a different syllabus (Settings ▸ Syllabus)
    private func linkDocSyllabus(_ k: ItemKind, _ id: String, _ v: String) {
        workspace.linkSyllabus(k, id, to: v.isEmpty ? nil : v, in: project)
        revision += 1
    }

    private func export(html: String, name: String) {
        let p = NSSavePanel()
        p.nameFieldStringValue = name
        p.allowedContentTypes = [.html]
        guard p.runModal() == .OK, let url = p.url else { return }
        do { try html.write(to: url, atomically: true, encoding: .utf8) }
        catch { alert = AlertItem(title: "Could not save", message: error.localizedDescription) }
    }

    /// Writes what the page saved into the open project's files.
    private func persist(_ json: String) {
        let started = Date(); defer { perfPersist(started, kb: json.utf8.count / 1024) }
        if !workspace.saveSession(json, project, notebook: currentNotebook) {
            alert = AlertItem(title: "Could not save your notebook", message: "Check that \(project.url.path) is writable.")
        }
        if let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            refs = (o["activeRefs"] ?? o["refs"]).map(Self.decodeRefs) ?? []  // the open document's list
            if let v = o["view"] as? String { pageView = v }
            pageEssay = o["essayId"] as? String
        }
        revision += 1
    }

    /// Save everything (notes and PDF highlights), then call done.
    func flushAll(_ done: @escaping () -> Void) {
        guard webView != nil else { done(); return }
        let gen = pageGen
        var finished = false
        let finish = { if !finished { finished = true; done() } }
        page.flush { [weak self] notebook in
            // only if nothing has been reloaded or changed since this flush began
            if let self, !finished, gen == self.pageGen, let s = notebook { self.persist(s) }
            finish()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { finish() }
    }
}


/// Timing marks for the performance test (no-ops otherwise).
@MainActor var perfMarks: [String] = []
@MainActor private var perfLast = Date()
@MainActor func perfPersist(_ started: Date, kb: Int) {
    guard ProcessInfo.processInfo.environment["APATITE_PERFTEST"] != nil else { return }
    perfMarks.append(String(format: "   persist %.1f ms for %d KB", Date().timeIntervalSince(started) * 1000, kb))
}
@MainActor func perfMark(_ label: String) {
    guard ProcessInfo.processInfo.environment["APATITE_PERFTEST"] != nil else { return }
    perfMarks.append(String(format: "   %5.0f ms  %@", Date().timeIntervalSince(perfLast) * 1000, label)); perfLast = Date()
}
