import SwiftUI
import AppKit

/// The writing theme chosen in the notebook's Aa panel, applied to the native parts of the app too.
/// Nil means "System": macOS's own light or dark colours.
struct AppTheme: Codable, Equatable {
    var id: String
    var dark: Bool
    var bg: String
    var panel: String
    var fg: String
    var muted: String
    var line: String
    var accent: String

    init?(_ d: [String: Any]) {
        guard let id = d["id"] as? String, id != "graphite",
              let bg = d["bg"] as? String, let panel = d["panel"] as? String, let fg = d["fg"] as? String,
              NSColor(hex: bg) != nil, NSColor(hex: panel) != nil, NSColor(hex: fg) != nil else { return nil }
        self.id = id; self.dark = d["dark"] as? Bool ?? false; self.bg = bg; self.panel = panel; self.fg = fg
        self.muted = d["muted"] as? String ?? fg; self.line = d["line"] as? String ?? fg; self.accent = d["accent"] as? String ?? fg
    }
}

extension AppState {
    /// Page background (around pages, behind panels).
    var themeBG: Color { theme.flatMap { NSColor(hex: $0.bg) }.map(Color.init(nsColor:)) ?? Color(nsColor: .windowBackgroundColor) }
    /// Surfaces: panels, cards.
    var themePanel: Color { theme.flatMap { NSColor(hex: $0.panel) }.map(Color.init(nsColor:)) ?? Color(nsColor: .windowBackgroundColor) }
    /// Behind PDF pages.
    var themeUnderPage: NSColor { theme.flatMap { NSColor(hex: $0.bg) } ?? .underPageBackgroundColor }
    var themeAccent: Color? { theme.flatMap { NSColor(hex: $0.accent) }.map(Color.init(nsColor:)) }
    var themeScheme: ColorScheme? { theme.map { $0.dark ? .dark : .light } }

    func setTheme(_ d: [String: Any]) {
        let t = AppTheme(d)
        guard t != theme else { return }
        theme = t
        if let t, let data = try? JSONEncoder().encode(t) { Self.prefs.set(data, forKey: "theme") } else { Self.prefs.removeObject(forKey: "theme") }
        for w in NSApp.windows { w.backgroundColor = t.flatMap { NSColor(hex: $0.bg) } ?? .windowBackgroundColor }
        reader.pdfView?.backgroundColor = themeUnderPage
    }

    static func savedTheme() -> AppTheme? {
        guard let d = prefs.data(forKey: "theme") else { return nil }
        return try? JSONDecoder().decode(AppTheme.self, from: d)
    }
}
