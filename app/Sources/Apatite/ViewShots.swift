import AppKit

/// Runs only when APATITE_VIEWSHOTS is set (with APATITE_LIBRARY at a throwaway folder and APATITE_SHOTPDF at a PDF):
/// opens each screen and sheet in turn and saves a picture of every visible window into the library's "shots"
/// folder, so two builds can be compared picture by picture.
@MainActor
enum ViewShots {
    /// time for each screen to settle before its picture
    static let settle: Double = 1.2

    static func runIfRequested() {
        let env = ProcessInfo.processInfo.environment
        guard env["APATITE_VIEWSHOTS"] != nil, let library = env["APATITE_LIBRARY"], let pdf = env["APATITE_SHOTPDF"] else { return }
        let dir = URL(fileURLWithPath: library).appendingPathComponent("shots")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let s = AppState.shared
        var steps = screens(s, pdf: pdf)
        steps.append(("done", {
            try? menuBar().write(to: dir.appendingPathComponent("menus.txt"), atomically: true, encoding: .utf8)
            try? "done".write(to: dir.appendingPathComponent("done.txt"), atomically: true, encoding: .utf8)
            quitAfterTest()
        }))
        for (i, (name, act)) in steps.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0 + Double(i) * settle * 2) {
                act()
                DispatchQueue.main.asyncAfter(deadline: .now() + settle) { if name != "done" { shoot(name, into: dir) } }
            }
        }
    }

    /// each screen and sheet in turn: (picture name, what opens it)
    private static func screens(_ s: AppState, pdf: String) -> [(String, () -> Void)] {
        [
            ("01-welcome", { s.welcomeTitle = WelcomeTitles.all[0] }),
            ("02-reader", {
                if let item = try? s.lib.importPDF(from: URL(fileURLWithPath: pdf)) { s.items.append(item); s.lib.saveItems(s.items); s.openReader(); s.open(item.id) }
            }),
            ("03-contents", { s.showContents = true }),
            ("04-annotations", { s.showContents = false; s.showAnnotations = true }),
            ("04b-wheel", { s.showAnnotations = false; s.openWheel(at: CGPoint(x: 500, y: 400)) }),
            ("04c-comment", { s.wheel = nil; s.commentAt(page: 0, point: CGPoint(x: 120, y: 600)) }),
            ("04d-annotations-comment", { s.showAnnotations = true }),
        ] + otherScreens(s, pdf: pdf)
    }

    /// the sheets, the key, the database, a deck, a folder import, and the notes
    private static func otherScreens(_ s: AppState, pdf: String) -> [(String, () -> Void)] {
        [
            ("05-link", { s.showAnnotations = false; s.editingComment = nil; s.showLink = true }),
            ("06-pages", { s.showLink = false; s.showPages = true }),
            ("07-key", { s.showPages = false; s.showKeyEditor = true }),
            ("08-database", { s.showKeyEditor = false; s.screen = .database }),
            ("09-deck", { openDeck(s) }),
            ("09b-deck-edit", { s.deckStartEdit = true; s.screen = .database; DispatchQueue.main.async { s.screen = .deck } }),
            ("10-folder", { s.folderImport = FolderImportRequest(scan: FolderImport.scan(URL(fileURLWithPath: pdf).deletingLastPathComponent()), target: nil) }),
            ("11-notes", { s.folderImport = nil; s.showEditor() })
        ]
    }

    /// a deck with two cards, open in the study screen
    private static func openDeck(_ s: AppState) {
        let deck = s.workspace.createDeck(in: s.project, title: "Shot deck")
        s.openDeck(s.project, deck.id)
        let first = Card(term: "Overfitting", def: "Fitting noise in the training data")
        let second = Card(term: "Underfitting", def: "Too simple a model")
        s.deck?.cards = [first, second]
    }

    /// the menu bar's menus and their items (with shortcuts), one per line
    private static func menuBar() -> String {
        (NSApp.mainMenu?.items ?? []).map { menu in
            menu.title + ": " + (menu.submenu?.items ?? []).map { $0.isSeparatorItem ? "—" : $0.title + ($0.keyEquivalent.isEmpty ? "" : " [\($0.keyEquivalentModifierMask.rawValue)+\($0.keyEquivalent)]") }.joined(separator: " | ")
        }.joined(separator: "\n")
    }

    /// every visible window, the main one at a fixed size, as PNG
    private static func shoot(_ name: String, into dir: URL) {
        for (i, window) in NSApp.windows.enumerated() where window.isVisible {
            if window.isMainWindow || i == 0 { window.setFrame(NSRect(x: 80, y: 80, width: 1200, height: 800), display: true) }
            guard let view = window.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { continue }
            view.cacheDisplay(in: view.bounds, to: rep)
            try? rep.representation(using: .png, properties: [:])?.write(to: dir.appendingPathComponent("\(name)-\(i).png"))
        }
    }
}
