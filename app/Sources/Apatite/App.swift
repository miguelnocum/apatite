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
                .frame(minWidth: state.navigation.focusActive ? 340 : 960, minHeight: state.navigation.focusActive ? 300 : 620)
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
            Button("Import PDF…") { state.reader.importPDFs() }
                .keyboardShortcut("o")
            Button("Show Library Folder in Finder") { state.reader.revealLibrary() }
            Button("Import Folder of Papers…") { state.importFolder() }
                .keyboardShortcut("o", modifiers: [.command, .shift])
            Divider()
            Button("Import Essay…") { state.session.importEssays() }
                .keyboardShortcut("i", modifiers: [.command, .shift])
        }
        viewMenu
        goMenu
        readerMenu
    }

    private var viewMenu: some Commands {
        CommandGroup(after: .toolbar) {
            Button(state.navigation.focusMode ? "Leave Focus Mode" : "Focus Mode") { state.toggleFocus() }
                .keyboardShortcut("f", modifiers: [.command, .shift])
        }
    }

    private var goMenu: some Commands {
        CommandMenu("Go") {
            Button("Project Folder") { state.navigation.openProjectFolder() }
                .keyboardShortcut("0")
            Button("Welcome Page") { state.navigation.goHome() }
                .keyboardShortcut("0", modifiers: [.command, .shift])
            Divider()
            Button("Notes") { state.openNotes() }
            Button("Essay") { state.openEssay() }
            Button("Read") { state.navigation.openReader() }
            Divider()
            Button("Deck in Its Own Window") { state.deckWindowShortcut() }
                .keyboardShortcut("d", modifiers: [.command, .shift])
        }
    }

    private var readerMenu: some Commands {
        CommandMenu("Reader") {
            Button("Toggle Notes") { state.navigation.toggleNotes() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Button("Toggle Reader") { state.navigation.toggleReader() }
                .keyboardShortcut("r", modifiers: [.command, .shift])
            Divider()
            Button("Cite Selection as Quote") { state.citations.citeQuote() }
                .keyboardShortcut("c", modifiers: [.command, .shift])
            Button("Highlight Selection") { state.reader.highlight(state.defaultKeyId) }
                .keyboardShortcut("h", modifiers: [.command, .shift])
            Button("Highlight Key…") { state.openSettings("key") }
            Button(state.reader.showContents ? "Hide Contents" : "Show Contents") { state.reader.showContents.toggle() }
                .keyboardShortcut("t", modifiers: [.command, .option])
            Divider()
            Button("Link PDF to Source…") { state.citations.showLink = true }
            Button("Set Page Numbers…") { state.reader.showPages = true }
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
        MainActor.assumeIsolated { _ = AppState.shared.session.webView }
        MainActor.assumeIsolated {
            runRequestedTests(testing: testing)
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

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Pull the latest notes out of the editor before quitting so nothing typed is lost.
        MainActor.assumeIsolated {
            AppState.shared.navigation.quitting = true
            AppState.shared.reader.rememberPage()
            AppState.shared.session.flushAll {
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
            state.navigation.openReaderWindow = { openWindow(id: "reader") }
            state.navigation.closeReaderWindow = { dismissWindow(id: "reader") }
            state.openDeckWindow = { openWindow(id: "deck") }
            state.closeDeckWindow = { dismissWindow(id: "deck") }
            if state.navigation.readerDetached { openWindow(id: "reader") }
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
        switch state.navigation.screen {
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
            if state.navigation.notesVisible || state.navigation.focusActive {
                NotebookWebView()
                    .frame(minWidth: state.navigation.focusActive ? 300 : 460, maxWidth: .infinity, maxHeight: .infinity)
            }
            if state.navigation.readerVisible && !state.navigation.readerDetached && !state.navigation.focusActive {
                ReaderPane()
                    .frame(minWidth: 460, idealWidth: 700, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    @ToolbarContentBuilder private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            if state.navigation.screen != .welcome && state.navigation.screen != .database {
                Button { state.navigation.openProjectFolder() } label: {
                    Label("Project Folder", systemImage: "house")
                }
                .help("This project's notebooks, syllabi and essays (⌘0)")
            }
        }
        ToolbarItem(placement: .navigation) {
            if state.navigation.screen == .workspace { ProjectSwitcher() }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if state.navigation.screen == .workspace { workspaceButtons }
        }
    }

    /// import, and show or hide the notes and the reader
    @ViewBuilder private var workspaceButtons: some View {
        Button {
            state.reader.importPDFs()
        } label: {
            Label("Import PDF", systemImage: "doc.badge.plus")
        }
        .help("Import PDFs into your library (⌘O)")
        Toggle(isOn: Binding(get: { state.navigation.notesVisible }, set: { _ in state.navigation.toggleNotes() })) {
            Label("Notes", systemImage: "sidebar.left")
        }
        .help("Show or hide your notes (⇧⌘N)")
        Toggle(isOn: Binding(get: { state.navigation.readerVisible || state.navigation.readerDetached }, set: { _ in state.navigation.toggleReader() })) {
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
        let _ = state.session.revision
        Menu {
            Section("Projects") { projects }
            Section("Notebooks in \(state.session.project.name)") { notebooks }
            Section("Essays in \(state.session.project.name)") { essays }
            Section("Decks in \(state.session.project.name)") {
                ForEach(ws.items(.decks, in: state.session.project)) { d in Button(d.title) { state.openDeck(state.session.project, d.id) } }
                Button("New Deck") { state.newDeck() }
                Button("Deck in Its Own Window (\u{21E7}\u{2318}D)") { state.deckWindowShortcut() }
            }
            Divider()
            Button("Open Database") { state.navigation.screen = .database }
        } label: { label }
        .help("Switch project, notebook or essay")
    }

    private var projects: some View {
        ForEach(ws.projects()) { p in
            Button { if p.id != state.session.project.id { state.session.switchTo(p) } } label: {
                if p.id == state.session.project.id { Label(p.name, systemImage: "checkmark") } else { Text(p.name) }
            }
        }
    }

    @ViewBuilder private var notebooks: some View {
        ForEach(ws.items(.notebooks, in: state.session.project)) { nb in
            Button { if nb.id != state.session.notebookId { state.session.openNotebook(state.session.project, nb.id) } } label: {
                if nb.id == state.session.notebookId { Label(nb.title, systemImage: "checkmark") } else { Text(nb.title) }
            }
        }
        Button("New Notebook") { state.session.newNotebook() }
    }

    @ViewBuilder private var essays: some View {
        ForEach(ws.items(.essays, in: state.session.project)) { es in
            Button { state.session.openEssayHere(es.id) } label: {
                if state.session.pageView == "essay" && es.id == state.session.pageEssay { Label(es.title, systemImage: "checkmark") } else { Text(es.title) }
            }
        }
        Button("New Essay") { state.session.newEssay() }
        Button("Import Essay…") { state.session.importEssays() }
    }

    /// "Project › Notebook": what the page is showing, the essay or the notebook
    private var label: some View {
        let inEssay = state.session.pageView == "essay"
        let essayTitle = ws.items(.essays, in: state.session.project).first { $0.id == state.session.pageEssay }?.title
        return HStack(spacing: 5) {
            Image(systemName: "folder")
            Text(state.session.project.name).fontWeight(.semibold)
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
            Text(inEssay ? (essayTitle ?? "Essay") : (state.session.currentNotebook?.title ?? "Notebook")).lineLimit(1).frame(maxWidth: 320, alignment: .leading)
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
            if state.navigation.readerDetached { ReaderPane() }
            else { Color.clear }
        }
        .preferredColorScheme(state.themeScheme)
        .tint(state.themeAccent)
        .navigationTitle(state.reader.current.map { "Reader \u{2014} " + $0.title } ?? "Reader")
        .onDisappear { if !state.navigation.quitting && state.navigation.readerDetached { state.navigation.dockReader() } }
    }
}
