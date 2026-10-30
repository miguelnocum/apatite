import SwiftUI
import AppKit
import WebKit
import UniformTypeIdentifiers

/// The open project and notebook, and the notes page that shows them: opening, switching and reloading it, what the
/// page saves, and what it asks of the app.
@MainActor
final class SessionModel: ObservableObject {
    /// The model that owns this one (set once, when AppState is built).
    weak var app: AppState!

    /// The open project and notebook; Notes, Essay and Read all work inside them.
    @Published var project: ProjectInfo
    @Published var notebookId: String?
    /// Bumped whenever files change, so lists and menus re-read them.
    @Published var revision = 0
    /// The notes editor lives for the whole session, so moving between screens never reloads it or drops typing.
    lazy var webView: WKWebView? = NotebookWebView.makeWebView()
    /// Which load of the notebook page is current; saves from an earlier load are ignored.
    private(set) var pageGen = 0
    /// The page's own view and essay, reported with each save, so a reload can return to them.
    private(set) var pageView = "notes", pageEssay: String?

    /// Essays converted for a project whose page is still loading.
    private var pendingImports: [EssayImport.Result] = []
    /// The settings section the page opens once it has loaded.
    var pendingSettings: String?

    init(project: ProjectInfo, notebookId: String?) {
        self.project = project
        self.notebookId = notebookId
    }

    var currentNotebook: DocItem? { app.workspace.item(.notebooks, notebookId, in: project) }

    /// The remembered notebook if it still exists, else the newest, else a new one.
    static func pickNotebook(_ ws: Workspace, _ p: ProjectInfo, _ want: String?) -> String {
        let nbs = ws.items(.notebooks, in: p)
        return (nbs.first { $0.id == want } ?? nbs.first ?? ws.createNotebook(in: p, title: "Notebook")).id
    }

    private func remember() {
        AppState.prefs.set(project.id, forKey: "project")
        if let n = notebookId { AppState.prefs.set(n, forKey: "notebook." + project.id) }
    }

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
        if !failed.isEmpty { app.alert = AlertItem(title: "Some files could not be imported", message: failed.joined(separator: "\n")) }
    }

    func deliverImports(_ r: [EssayImport.Result], into p: ProjectInfo) {
        guard !r.isEmpty else { return }
        if p.id == project.id, webView != nil {
            app.navigation.showEditor()
            app.page.importEssays(r)
        } else {
            pendingImports = r
            switchTo(p, view: "essay") { [self] in app.navigation.showEditor() }
        }
    }

    /// The script the notebook page boots with.
    func bootScript(view: String? = nil, essay: String? = nil) -> String {
        PageBridge.bootScript(notebook: app.workspace.sessionJSON(project, notebook: currentNotebook), gen: pageGen, view: view, essay: essay,
                              imports: takePendingImports(), key: app.hlKey, library: app.workspace.root.path, settings: pendingSettings)
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

    /// Opens a project (and optionally a notebook, view or essay in it). Everything open is saved first.
    func switchTo(_ p: ProjectInfo, notebook nid: String? = nil, view: String? = nil, essay: String? = nil, paper: String? = nil, then: (() -> Void)? = nil) {
        perfMark("switch: start")
        flushAll { [self] in
            perfMark("switch: page saved (flush)")
            let sameProject = p.id == project.id
            if !sameProject { app.reader.rememberPage() }
            project = p
            if !sameProject || app.reader.lib.root != p.url { app.reader.openPapers(of: p, paper: paper) }
            notebookId = Self.pickNotebook(app.workspace, p, nid ?? AppState.prefs.string(forKey: "notebook." + p.id))
            app.citations.refs = CitationModel.decodeRefs(app.workspace.refs(of: p))
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
            app.navigation.showEditor()
            app.page.show("notes")
            return
        }
        switchTo(p, notebook: id, view: "notes") { [self] in app.navigation.showEditor() }
    }

    /// A syllabus opens in the Syllabus view of a notebook that follows it (a new one if none does yet).
    func openSyllabus(_ p: ProjectInfo, _ sid: String) {
        var nb = app.workspace.users(of: sid, in: p).first { $0.0 == .notebooks }?.1
        if nb == nil {
            let t = app.workspace.item(.syllabi, sid, in: p)?.title ?? "Syllabus"
            let made = app.workspace.createNotebook(in: p, title: t + " notes")
            app.workspace.linkSyllabus(.notebooks, made.id, to: sid, in: p)
            nb = made
        }
        guard let id = nb?.id else { return }
        switchTo(p, notebook: id, view: "syl") { [self] in app.navigation.showEditor() }
    }

    func openEssay(_ p: ProjectInfo, _ id: String) {
        if p.id == project.id { openEssayHere(id); return }  // its project's essays are already in the page
        switchTo(p, view: "essay", essay: id) { [self] in app.navigation.showEditor() }
    }

    func openPaper(_ p: ProjectInfo, _ id: String) {
        if p.id == project.id { if id != app.reader.currentId { app.reader.open(id) }; app.navigation.openReader(); return }
        switchTo(p, paper: id) { [self] in app.navigation.openReader() }
    }

    /// Essays in the open project are already in the page, so opening or making one needs no reload.
    func openEssayHere(_ id: String) {
        app.navigation.showEditor()
        app.page.openEssay(id)
    }

    func newEssay() {
        app.navigation.showEditor()
        app.page.newEssay()
    }

    func newNotebook() {
        let nb = app.workspace.createNotebook(in: project, title: "Untitled notebook")
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
            let ps = app.workspace.projects()
            let p = ps.first { $0.id == project.id } ?? ps.first ?? app.workspace.createProject(named: "Untitled project")
            if p != project || touched.contains(where: { $0.id == project.id }) { reloadProject(p) }
        }
    }

    /// Everything shown from the open project, read again (it may have moved).
    private func reloadProject(_ p: ProjectInfo) {
        let moved = app.reader.lib.root != p.url || p.id != project.id
        project = p
        if moved { app.reader.lib = Library(project: p.url) }
        app.reader.items = app.reader.lib.loadItems()
        if app.reader.current == nil { app.reader.currentId = app.reader.rememberedPaper() }
        app.reader.loadCurrent()
        notebookId = Self.pickNotebook(app.workspace, p, notebookId)
        app.citations.refs = CitationModel.decodeRefs(app.workspace.refs(of: p))
        remember()
        reloadPage(view: pageView, essay: pageEssay)
    }

    /// For the self-test: what is on disk for the open project and notebook.
    func savedSessionJSON() -> String { app.workspace.sessionJSON(project, notebook: currentNotebook) }

    // MARK: messages from the notebook

    /// what each kind of message from the page does
    func receive(_ message: PageMessage) {
        switch message {
        case .save(let json, let gen): receiveSave(json, gen: gen)
        case .theme(let colours): app.setTheme(colours)
        case .focus(let on, let bg): app.navigation.setFocusMode(on, bg: bg)
        case .linkSyllabus(let id, let view): linkNotebookSyllabus(id, view: view)
        case .editKey: app.openSettings("key")
        case .setKey(let key): app.setHighlightKey(key)
        case .linkDocSyllabus(let kind, let id, let syllabus): linkDocSyllabus(kind, id, syllabus)
        case .revealLibrary: NSWorkspace.shared.activateFileViewerSelecting([app.workspace.root])
        case .importEssay: importEssays()
        case .openAnchor(let anchor): app.citations.jump(anchor)
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
            if v == "__new" { sid = app.workspace.createSyllabus(in: project, title: nb.title + " syllabus").id }
            app.workspace.linkSyllabus(.notebooks, nb.id, to: sid, in: project)
            reloadPage(view: view ?? "syl", essay: nil)
            revision += 1
        }
    }

    /// another notebook, or a deck, following a different syllabus (Settings ▸ Syllabus)
    private func linkDocSyllabus(_ k: ItemKind, _ id: String, _ v: String) {
        app.workspace.linkSyllabus(k, id, to: v.isEmpty ? nil : v, in: project)
        revision += 1
    }

    private func export(html: String, name: String) {
        let p = NSSavePanel()
        p.nameFieldStringValue = name
        p.allowedContentTypes = [.html]
        guard p.runModal() == .OK, let url = p.url else { return }
        do { try html.write(to: url, atomically: true, encoding: .utf8) }
        catch { app.alert = AlertItem(title: "Could not save", message: error.localizedDescription) }
    }

    /// Writes what the page saved into the open project's files.
    private func persist(_ json: String) {
        let started = Date(); defer { perfPersist(started, kb: json.utf8.count / 1024) }
        let o = json.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }   // parsed once, for the files and for the lines below
        if !(o.map { app.workspace.saveSession($0, project, notebook: currentNotebook) } ?? false) {
            app.alert = AlertItem(title: "Could not save your notebook", message: "Check that \(project.url.path) is writable.")
        }
        if let o {
            app.citations.refs = (o["activeRefs"] ?? o["refs"]).map(CitationModel.decodeRefs) ?? []  // the open document's list
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
        app.page.flush { [weak self] notebook in
            // only if nothing has been reloaded or changed since this flush began
            if let self, !finished, gen == self.pageGen, let s = notebook { self.persist(s) }
            finish()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { finish() }
    }
}
