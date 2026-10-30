import SwiftUI
import AppKit
import PDFKit
import WebKit
import Combine
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

    // The parts of the app's state, each with its own model. A change in any of them also tells the views watching
    // AppState (see watch), so a view updates exactly when it did while all of this lived in one class.
    /// screens, the two sides of the workspace, the reader's window, focus mode
    let navigation = NavigationModel()
    /// the open project and notebook, and the notes page
    let session: SessionModel
    /// the open paper: its PDF, page numbers, highlights, reading tools and contents
    let reader: ReaderModel
    /// Works Cited, citing a quote, linking a PDF to a source
    let citations = CitationModel()
    private var watching: [AnyCancellable] = []

    @Published var alert: AlertItem?

    /// What each highlighter colour is for; shared by notes, essays and the PDF reader.
    @Published var hlKey: [KeyColor] = []
    @Published var showKeyEditor = false
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
    /// A folder of papers waiting to be placed (shows the import sheet).
    @Published var folderImport: FolderImportRequest?
    var defaultKeyId: String { hlKey.first { !$0.hidden }?.id ?? "1" }
    func keyColor(_ id: String) -> KeyColor? { hlKey.first { $0.id == HighlightKey.id(forStored: id) } }

    init() {
        hlKey = HighlightKey.load(workspace.root)
        let all = workspace.projects()
        let p = workspace.project(Self.prefs.string(forKey: "project")) ?? all[0]
        session = SessionModel(project: p, notebookId: SessionModel.pickNotebook(workspace, p, Self.prefs.string(forKey: "notebook." + p.id)))
        reader = ReaderModel(lib: Library(project: p.url))
        navigation.app = self; session.app = self; reader.app = self; citations.app = self
        reader.items = reader.lib.loadItems()
        citations.refs = CitationModel.decodeRefs(workspace.read(workspace.item(.notebooks, session.notebookId, in: p)?.url ?? p.url)?["refs"] as? [JSON] ?? workspace.refs(of: p))
        reader.currentId = reader.rememberedPaper()
        reader.loadCurrent()
        watch(navigation); watch(session); watch(reader); watch(citations)
    }

    private func watch<M: ObservableObject>(_ model: M) where M.ObjectWillChangePublisher == ObservableObjectPublisher {
        watching.append(model.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() })
    }

    /// The notes page, to call its entry points.
    var page: PageBridge { PageBridge(web: session.webView) }

    /// Saves the key, tells the page, and repaints the open PDF's highlights.
    func setHighlightKey(_ key: [KeyColor]) {
        hlKey = key
        HighlightKey.save(key, workspace.root)
        page.setKey(hlKey)
        reader.syncHighlightColors()
    }

    func openNotes() { openEditor("notes") }

    /// Settings (⌘,) live in the editor page; from Home or the database, the editor comes up first.
    /// `section` opens one part of it ("key" for the highlight key…).
    var pendingSettings: String?
    func openSettings(_ section: String? = nil) {
        navigation.showEditor()
        page.openSettings(section)
    }
    func openEssay() { openEditor("essay") }

    /// Notes and Essay share the one editor page; this picks which document it shows.
    private func openEditor(_ view: String) {
        navigation.showEditor()
        page.showOrQueue(view)
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
