import SwiftUI
import AppKit

/// Which screen is showing, which sides of the workspace are visible, the reader's own window and focus mode.
@MainActor
final class NavigationModel: ObservableObject {
    /// The model that owns this one (set once, when AppState is built).
    weak var app: AppState!

    @Published var screen: Screen = .welcome
    @Published var notesVisible = true
    @Published var readerVisible = false
    /// The page's focus mode (just the notes and the formatting bar); the window follows it (see FocusMode.swift).
    @Published var focusMode = false
    /// the page's colour in focus mode, for the title bar over it
    @Published var focusBG: String?
    @Published var welcomeTitle = WelcomeTitles.random()
    /// The reader in its own window (for a second monitor); remembered across launches.
    @Published var readerDetached = AppState.prefs.bool(forKey: "readerDetached") {
        didSet { if !quitting { AppState.prefs.set(readerDetached, forKey: "readerDetached") } }
    }
    /// Set while the app quits, so windows closing don't count as "docked again".
    var quitting = false
    /// Opens or brings forward the reader window (set by the main window, which has openWindow).
    var openReaderWindow: (() -> Void)?
    var closeReaderWindow: (() -> Void)?

    /// The notes or essay editor fills the window.
    func showEditor() {
        notesVisible = true; readerVisible = false; screen = .workspace
    }

    func goHome() {
        welcomeTitle = WelcomeTitles.random(excluding: welcomeTitle)
        screen = .welcome
    }

    /// The home button (⌘0): the project's folder, its notebooks, syllabi, essays and decks, to switch between them
    /// (the Database, opened at the project)
    func openProjectFolder() { screen = .database }

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
        if screen != .workspace { app.openNotes(); return }
        notesVisible.toggle()
        if !notesVisible && !readerVisible { readerVisible = true }
    }

    func toggleReader() {
        if readerDetached { openReaderWindow?(); return }
        if screen != .workspace { openReader(); return }
        readerVisible.toggle()
        if !notesVisible && !readerVisible { notesVisible = true }
    }

    func showReader() {
        if readerDetached { openReaderWindow?(); return }
        readerVisible = true
        screen = .workspace
    }
}
