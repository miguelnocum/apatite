import Foundation
import WebKit

// The Swift side of the bridge to the notes page. This file is the only place that runs script in the page
// (evaluateJavaScript), the only place that decodes what the page posts, and the one place arguments are encoded
// for it. The page's side is web/scripts/core/bridge.js, which lists every message and entry point with what it does.
// (The tests, Tests*.swift and TestRun.swift, drive the page with their own scripts and are not part of this.)

/// What the page posts to the "nb" handler: one case per message type, decoded the way the app has always read it
/// (a message missing a field it cannot do without is dropped).
enum PageMessage {
    /// the whole notebook as JSON, from the page load numbered `gen` (nil: not said)
    case save(json: String, gen: Int?)
    /// the writing theme's colours (the message's own fields, read by AppTheme)
    case theme([String: Any])
    /// focus mode on or off, and its background colour
    case focus(on: Bool, bg: String?)
    /// this notebook follows another syllabus ("" none, "__new" a new one)
    case linkSyllabus(id: String, view: String?)
    /// another notebook or deck follows a syllabus ("" none)
    case linkDocSyllabus(kind: ItemKind, id: String, syllabus: String)
    /// the highlight key, edited in Settings
    case setKey([KeyColor])
    /// open Settings at the highlight key
    case editKey
    case revealLibrary
    case importEssay
    /// a PDF citation was clicked: "paperId|highlightId"
    case openAnchor(String)
    /// the notes as a web page, to save
    case export(html: String, filename: String)

    init?(_ body: [String: Any]) {
        switch body["type"] as? String ?? "" {
        case "save": guard let json = body["json"] as? String else { return nil }; self = .save(json: json, gen: body["gen"] as? Int)
        case "theme": self = .theme(body)
        case "focus": self = .focus(on: body["on"] as? Bool ?? false, bg: body["bg"] as? String)
        case "linkSyllabus": self = .linkSyllabus(id: body["id"] as? String ?? "", view: body["view"] as? String)
        case "linkDocSyllabus": self.init(linkingDocument: body)
        case "setKey": self.init(key: body["key"])
        case "editKey": self = .editKey
        case "revealLibrary": self = .revealLibrary
        case "importEssay": self = .importEssay
        case "openAnchor": guard let anchor = body["anchor"] as? String else { return nil }; self = .openAnchor(anchor)
        case "export": guard let html = body["html"] as? String else { return nil }; self = .export(html: html, filename: body["filename"] as? String ?? "notebook.html")
        default: return nil
        }
    }

    private init?(linkingDocument body: [String: Any]) {
        guard let kind = ItemKind(rawValue: body["kind"] as? String ?? ""), let id = body["id"] as? String else { return nil }
        self = .linkDocSyllabus(kind: kind, id: id, syllabus: body["sid"] as? String ?? "")
    }

    private init?(key raw: Any?) {
        guard let raw, let data = try? JSONSerialization.data(withJSONObject: raw),
              let key = try? JSONDecoder().decode([KeyColor].self, from: data), !key.isEmpty else { return nil }
        self = .setKey(key)
    }
}

/// What the app asks of the page: one method per entry point (window.nb*). A call made before the page has set
/// the entry point up is kept for it where the page asks for that (showOrQueue, importEssays, openSettings).
@MainActor struct PageBridge {
    let web: WKWebView?

    private func run(_ script: String, _ done: (@MainActor @Sendable (Any?, Error?) -> Void)? = nil) {
        web?.evaluateJavaScript(script, completionHandler: done)
    }

    // MARK: encoding (the only place values are turned into script)

    /// An object as JSON text.
    static func json(_ obj: Any) -> String? {
        guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
        return String(data: d, encoding: .utf8)
    }

    /// A string as a JavaScript string literal (quotes, backslashes, control characters and the two line separators
    /// that older scripts end a line at, all escaped).
    static func literal(_ s: String) -> String {
        let quoted = json([s]).map { String($0.dropFirst().dropLast()) } ?? "''"
        return quoted.replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }

    static func importsJSON(_ r: [EssayImport.Result]) -> String {
        json(r.map { ["title": $0.title, "html": $0.html] }) ?? "[]"
    }

    static func keyJSON(_ key: [KeyColor]) -> String {
        (try? JSONEncoder().encode(key)).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }

    // MARK: before the page's scripts

    /// The script the page boots with, run before any of its scripts: the notebook, the page load's number, what to
    /// open first, essays waiting to be imported, the highlight key, the library's folder, a Settings section.
    static func bootScript(notebook: String, gen: Int, view: String?, essay: String?, imports: String, key: [KeyColor],
                           library: String, settings: String?) -> String {
        func js(_ s: String?) -> String { s.map(literal) ?? "null" }
        return "window.__NB__ = \(notebook); window.__NBGEN__ = \(gen);"
            + " window.__nbStartView = \(js(view)); window.__nbStartEssay = \(js(essay));"
            + " window.__nbPendingImports = \(imports); window.__HLKEY__ = \(keyJSON(key));"
            + " window.__NBLIB__ = \(literal(library)); window.__nbOpenSettings = \(js(settings));"
    }

    // MARK: entry points

    /// essays converted from Word or PDF (kept for the page if it has not set up yet)
    func importEssays(_ r: [EssayImport.Result]) {
        let list = Self.importsJSON(r)
        run("window.nbImportEssays ? nbImportEssays(\(list)) : (window.__nbPendingImports = (window.__nbPendingImports || []).concat(\(list)))")
    }

    /// the highlight key changed
    func setKey(_ key: [KeyColor]) { run("window.nbSetKey && nbSetKey(\(Self.keyJSON(key)))") }

    /// the Notes / Essay / Syllabus screen
    func show(_ view: String) { run("window.nbShow && nbShow(\(Self.literal(view)))") }

    /// the same, kept for the page if it has not set up yet
    func showOrQueue(_ view: String) {
        let v = Self.literal(view)
        run("window.nbShow ? nbShow(\(v)) : (window.__nbStartView = \(v))")
    }

    func openEssay(_ id: String) { run("window.nbOpenEssay && nbOpenEssay(\(Self.literal(id)))") }

    func newEssay() { run("window.nbNewEssay && nbNewEssay()") }

    /// Settings, at a section ("key" for the highlight key; nil for its top), kept for the page if it has not set up yet
    func openSettings(_ section: String?) {
        let s = section.map(Self.literal) ?? "''"
        run("window.nbOpenSettings ? nbOpenSettings(\(s)) : (window.__nbOpenSettings = \(s))")
    }

    /// a quote from the PDF with its citation, at the cursor
    func insertQuote(_ payload: [String: String]) {
        guard let json = Self.json(payload) else { return }
        run("window.nbInsertQuote && window.nbInsertQuote(\(json))") { _, err in
            if let err { NSLog("insert quote failed: \(err)") }
        }
    }

    /// a comment from the PDF with its quote and citation, at the cursor
    func insertNote(_ payload: [String: String]) {
        guard let json = Self.json(payload) else { return }
        run("window.nbInsertNote && window.nbInsertNote(\(json))")
    }

    func toggleFocus() { run("window.nbToggleFocus && nbToggleFocus()") }

    /// a source added from the app: the page answers with {id, refs} as JSON text (nil, and the error, if it could not)
    func addRef(_ raw: String, done: @escaping @MainActor (String?, Error?) -> Void) {
        run("window.nbAddRef(\(Self.literal(raw)))") { result, err in
            let answer = result as? String
            Task { @MainActor in done(answer, err) }
        }
    }

    /// the page saves the open document and hands over the notebook as JSON text (nil if it is not ready)
    func flush(done: @escaping @MainActor (String?) -> Void) {
        run("window.nbFlush ? window.nbFlush() : null") { result, _ in
            let notebook = result as? String
            Task { @MainActor in done(notebook) }
        }
    }
}
