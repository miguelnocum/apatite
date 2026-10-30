import SwiftUI
import AppKit

@main
struct ApatiteApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var state = AppState.shared

    var body: some Scene {
        Window("Apatite", id: "main") {
            ContentView()
                .environmentObject(state)
                .frame(minWidth: state.focusActive ? 340 : 960, minHeight: state.focusActive ? 300 : 620)
        }
        .defaultSize(width: 1500, height: 940)
        .commands { AppCommands(state: state) }
        sideWindows
    }

    @SceneBuilder private var sideWindows: some Scene {
        // the reader, popped out (macOS remembers its size and which monitor it's on)
        Window("Reader", id: "reader") {
            ReaderWindow()
                .environmentObject(state)
                .frame(minWidth: 480, minHeight: 500)
        }
        .defaultSize(width: 820, height: 1000)
        // a deck beside the notes, for adding cards while writing
        Window("Deck", id: "deck") {
            DeckWindow()
                .environmentObject(state)
                .frame(minWidth: 520, minHeight: 480)
        }
        .defaultSize(width: 760, height: 820)
    }
}

/// The menus: Settings, importing, Go, and Reader.
struct AppCommands: Commands {
    @ObservedObject var state: AppState

    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") { state.openSettings() }
                .keyboardShortcut(",")
        }
        CommandGroup(after: .newItem) {
            Button("Import PDF…") { state.importPDFs() }
                .keyboardShortcut("o")
            Button("Show Library Folder in Finder") { state.revealLibrary() }
            Button("Import Folder of Papers…") { state.importFolder() }
                .keyboardShortcut("o", modifiers: [.command, .shift])
            Divider()
            Button("Import Essay…") { state.importEssays() }
                .keyboardShortcut("i", modifiers: [.command, .shift])
        }
        viewMenu
        goMenu
        readerMenu
    }

    private var viewMenu: some Commands {
        CommandGroup(after: .toolbar) {
            Button(state.focusMode ? "Leave Focus Mode" : "Focus Mode") { state.toggleFocus() }
                .keyboardShortcut("f", modifiers: [.command, .shift])
        }
    }

    private var goMenu: some Commands {
        CommandMenu("Go") {
            Button("Project Folder") { state.openProjectFolder() }
                .keyboardShortcut("0")
            Button("Welcome Page") { state.goHome() }
                .keyboardShortcut("0", modifiers: [.command, .shift])
            Divider()
            Button("Notes") { state.openNotes() }
            Button("Essay") { state.openEssay() }
            Button("Read") { state.openReader() }
            Divider()
            Button("Deck in Its Own Window") { state.deckWindowShortcut() }
                .keyboardShortcut("d", modifiers: [.command, .shift])
        }
    }

    private var readerMenu: some Commands {
        CommandMenu("Reader") {
            Button("Toggle Notes") { state.toggleNotes() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Button("Toggle Reader") { state.toggleReader() }
                .keyboardShortcut("r", modifiers: [.command, .shift])
            Divider()
            Button("Cite Selection as Quote") { state.citeQuote() }
                .keyboardShortcut("c", modifiers: [.command, .shift])
            Button("Highlight Selection") { state.highlight(state.defaultKeyId) }
                .keyboardShortcut("h", modifiers: [.command, .shift])
            Button("Highlight Key…") { state.openSettings("key") }
            Button(state.showContents ? "Hide Contents" : "Show Contents") { state.showContents.toggle() }
                .keyboardShortcut("t", modifiers: [.command, .option])
            Divider()
            Button("Link PDF to Source…") { state.showLink = true }
            Button("Set Page Numbers…") { state.showPages = true }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let testing = ProcessInfo.processInfo.environment["APATITE_LIBRARY"] != nil
        if testing {
            hideTestWindows()
        } else {
            NSApp.setActivationPolicy(.regular)
            NSApp.activate(ignoringOtherApps: true)
        }
        // Load the notes editor straight away, even while the welcome page is showing.
        MainActor.assumeIsolated { _ = AppState.shared.webView }
        MainActor.assumeIsolated {
            SelfTest.runIfRequested(); ProjectTest.runIfRequested(); ImportTest.runIfRequested(); ReaderTest.runIfRequested(); FolderTest.runIfRequested(); WindowTest.runIfRequested(); LinkTest.runIfRequested(); PerfTest.runIfRequested(); OrgTest.runIfRequested(); DeckTest.runIfRequested(); ViewShots.runIfRequested(); FocusTest.runIfRequested()
            if testing { openTestScreen() }
        }
    }

    /// test runs: no Dock icon, never take focus, every window invisible, including ones opened later (the reader
    /// window); they still lay out for the tests
    private func hideTestWindows() {
        NSApp.setActivationPolicy(.accessory)
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            MainActor.assumeIsolated { for w in NSApp.windows where w.alphaValue != 0 { w.alphaValue = 0; w.ignoresMouseEvents = true; w.orderBack(nil) } }
        }
    }

    /// for screenshots in tests: open straight onto a screen (APATITE_SCREEN), and picture the window (APATITE_SNAPSHOT)
    @MainActor private func openTestScreen() {
        let env = ProcessInfo.processInfo.environment
        if let sc = env["APATITE_SCREEN"].flatMap(Screen.init(rawValue:)) { AppState.shared.screen = sc }
        guard let out = env["APATITE_SNAPSHOT"] else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            // the window draws itself into a PNG (no screen-recording permission needed)
            guard let v = NSApp.windows.first(where: { $0.isVisible })?.contentView?.superview,
                  let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) else { return }
            v.cacheDisplay(in: v.bounds, to: rep)
            try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: out))
            quitAfterTest()
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Pull the latest notes out of the editor before quitting so nothing typed is lost.
        MainActor.assumeIsolated {
            AppState.shared.quitting = true
            AppState.shared.rememberPage()
            AppState.shared.flushAll {
                NSApp.reply(toApplicationShouldTerminate: true)
            }
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

struct ContentView: View {
    @EnvironmentObject var state: AppState

    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismissWindow) private var dismissWindow

    var body: some View {
        Group { screen }
        .toolbar { toolbarItems }
        .focusChrome(state)
        .onAppear {
            state.openReaderWindow = { openWindow(id: "reader") }
            state.closeReaderWindow = { dismissWindow(id: "reader") }
            state.openDeckWindow = { openWindow(id: "deck") }
            state.closeDeckWindow = { dismissWindow(id: "deck") }
            if state.readerDetached { openWindow(id: "reader") }
            state.restoreDeckWindow()
        }
        .sheet(isPresented: $state.showKeyEditor) { KeyEditor().environmentObject(state) }
        .preferredColorScheme(state.themeScheme)
        .tint(state.themeAccent)
        .sheet(item: $state.folderImport) { r in FolderImportSheet(req: r).environmentObject(state) }
        .alert(item: $state.alert) { a in
            Alert(title: Text(a.title), message: Text(a.message), dismissButton: .default(Text("OK")))
        }
    }

    @ViewBuilder private var screen: some View {
        switch state.screen {
        case .welcome:
            WelcomeView()
        case .database:
            DatabaseView()
        case .deck:
            DeckView()
        case .workspace:
            workspace
        }
    }

    /// the notes and the reader, side by side
    private var workspace: some View {
        HSplitView {
            if state.notesVisible || state.focusActive {
                NotebookWebView()
                    .frame(minWidth: state.focusActive ? 300 : 460, maxWidth: .infinity, maxHeight: .infinity)
            }
            if state.readerVisible && !state.readerDetached && !state.focusActive {
                ReaderPane()
                    .frame(minWidth: 460, idealWidth: 700, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    @ToolbarContentBuilder private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            if state.screen != .welcome && state.screen != .database {
                Button { state.openProjectFolder() } label: {
                    Label("Project Folder", systemImage: "house")
                }
                .help("This project's notebooks, syllabi and essays (⌘0)")
            }
        }
        ToolbarItem(placement: .navigation) {
            if state.screen == .workspace { ProjectSwitcher() }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if state.screen == .workspace { workspaceButtons }
        }
    }

    /// import, and show or hide the notes and the reader
    @ViewBuilder private var workspaceButtons: some View {
        Button {
            state.importPDFs()
        } label: {
            Label("Import PDF", systemImage: "doc.badge.plus")
        }
        .help("Import PDFs into your library (⌘O)")
        Toggle(isOn: Binding(get: { state.notesVisible }, set: { _ in state.toggleNotes() })) {
            Label("Notes", systemImage: "sidebar.left")
        }
        .help("Show or hide your notes (⇧⌘N)")
        Toggle(isOn: Binding(get: { state.readerVisible || state.readerDetached }, set: { _ in state.toggleReader() })) {
            Label("Reader", systemImage: "sidebar.right")
        }
        .help("Show or hide the PDF reader (⇧⌘R)")
    }
}

/// "Machine Learning › Notebook" in the toolbar: switch project or notebook, or open the Database.
struct ProjectSwitcher: View {
    @EnvironmentObject var state: AppState
    private var ws: Workspace { state.workspace }

    var body: some View {
        let _ = state.revision
        Menu {
            Section("Projects") { projects }
            Section("Notebooks in \(state.project.name)") { notebooks }
            Section("Essays in \(state.project.name)") { essays }
            Section("Decks in \(state.project.name)") {
                ForEach(ws.items(.decks, in: state.project)) { d in Button(d.title) { state.openDeck(state.project, d.id) } }
                Button("New Deck") { state.newDeck() }
                Button("Deck in Its Own Window (\u{21E7}\u{2318}D)") { state.deckWindowShortcut() }
            }
            Divider()
            Button("Open Database") { state.screen = .database }
        } label: { label }
        .help("Switch project, notebook or essay")
    }

    private var projects: some View {
        ForEach(ws.projects()) { p in
            Button { if p.id != state.project.id { state.switchTo(p) } } label: {
                if p.id == state.project.id { Label(p.name, systemImage: "checkmark") } else { Text(p.name) }
            }
        }
    }

    @ViewBuilder private var notebooks: some View {
        ForEach(ws.items(.notebooks, in: state.project)) { nb in
            Button { if nb.id != state.notebookId { state.openNotebook(state.project, nb.id) } } label: {
                if nb.id == state.notebookId { Label(nb.title, systemImage: "checkmark") } else { Text(nb.title) }
            }
        }
        Button("New Notebook") { state.newNotebook() }
    }

    @ViewBuilder private var essays: some View {
        ForEach(ws.items(.essays, in: state.project)) { es in
            Button { state.openEssayHere(es.id) } label: {
                if state.pageView == "essay" && es.id == state.pageEssay { Label(es.title, systemImage: "checkmark") } else { Text(es.title) }
            }
        }
        Button("New Essay") { state.newEssay() }
        Button("Import Essay…") { state.importEssays() }
    }

    /// "Project › Notebook": what the page is showing, the essay or the notebook
    private var label: some View {
        let inEssay = state.pageView == "essay"
        let essayTitle = ws.items(.essays, in: state.project).first { $0.id == state.pageEssay }?.title
        return HStack(spacing: 5) {
            Image(systemName: "folder")
            Text(state.project.name).fontWeight(.semibold)
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
            Text(inEssay ? (essayTitle ?? "Essay") : (state.currentNotebook?.title ?? "Notebook")).lineLimit(1).frame(maxWidth: 320, alignment: .leading)
        }
    }
}

/// A deck in its own window. Closing it puts the deck away (saved); the ⇲ button brings it back into the main window.
struct DeckWindow: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        Group {
            if state.deckDetached && state.deck != nil { DeckView().id(state.deck?.id) }
            else { Text("No deck open").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .preferredColorScheme(state.themeScheme)
        .tint(state.themeAccent)
        .navigationTitle(state.deck.map { "Deck \u{2014} " + ($0.title.isEmpty ? "Untitled deck" : $0.title) } ?? "Deck")
        .onDisappear { state.deckWindowClosed() }
    }
}

/// The reader in its own window. Closing it docks the reader back into the main window.
struct ReaderWindow: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        Group {
            if state.readerDetached { ReaderPane() }
            else { Color.clear }
        }
        .preferredColorScheme(state.themeScheme)
        .tint(state.themeAccent)
        .navigationTitle(state.current.map { "Reader \u{2014} " + $0.title } ?? "Reader")
        .onDisappear { if !state.quitting && state.readerDetached { state.dockReader() } }
    }
}
