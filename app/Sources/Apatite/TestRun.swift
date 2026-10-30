#if APATITE_TESTS
import AppKit
import PDFKit

/// What every test run shares: the app's state, a schedule of steps after launch, a log, and the report it ends with.
/// Test runs happen only with APATITE_LIBRARY set (a throwaway library) and the suite's own variable.
@MainActor
final class TestRun {
    let s = AppState.shared
    var ws: Workspace { s.workspace }
    var log: [String]
    /// the report's file name, written into the library
    let report: String

    init(report: String, log: [String] = []) {
        self.report = report
        self.log = log
    }

    /// the suite's variable, when this is a test run that asks for it
    static func requested(_ key: String) -> String? {
        let env = ProcessInfo.processInfo.environment
        guard env["APATITE_LIBRARY"] != nil else { return nil }
        return env[key]
    }

    static func env(_ key: String) -> String? { ProcessInfo.processInfo.environment[key] }

    /// gives the main window an explicit size, whatever the screen or a saved frame would give it (what a test whose
    /// numbers depend on the window's size starts with; 1500 x 859 is the default size on the machine the baselines were made on)
    func pinMainWindowSize(width: CGFloat = 1500, height: CGFloat = 859) {
        guard let w = NSApp.windows.first(where: { $0.isVisible && !$0.title.hasPrefix("Reader") }) else { return }
        w.setFrame(NSRect(x: w.frame.minX, y: w.frame.maxY - height, width: width, height: height), display: true)
    }

    /// a step, this many seconds after launch
    func at(_ delay: Double, _ f: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: f)
    }

    /// runs a script in the notes page and logs its result under a label
    func page(_ js: String, _ label: String) {
        s.session.webView?.evaluateJavaScript(js) { r, e in self.log.append("\(label): \(r.map { "\($0)" } ?? "ERR \(e?.localizedDescription ?? "")")") }
    }

    /// runs a script in the notes page and hands its result on
    func page(_ js: String, then: @escaping (Any?) -> Void) {
        s.session.webView?.evaluateJavaScript(js) { r, _ in then(r) }
    }

    /// the report written, and the app quits
    func finish() {
        try? log.joined(separator: "\n").write(to: ws.root.appendingPathComponent(report), atomically: true, encoding: .utf8)
        quitAfterTest()
    }

    /// a PDF copied into the open project's library and opened
    @discardableResult
    func importPaper(_ path: String) -> LibItem? {
        guard let item = try? s.reader.lib.importPDF(from: URL(fileURLWithPath: path)) else { return nil }
        s.reader.items.append(item); s.reader.lib.saveItems(s.reader.items); s.reader.open(item.id)
        return item
    }

    /// the first place a phrase appears in the open PDF, selected
    @discardableResult
    func select(_ phrase: String) -> Bool {
        guard let doc = s.reader.document, let v = s.reader.pdfView, let sel = doc.findString(phrase, withOptions: .caseInsensitive).first else { return false }
        v.setCurrentSelection(sel, animate: false); s.reader.hasSelection = true; return true
    }
}

/// Ends a test run. Quitting waits for the notebook page to save, and that reply comes back on the main queue,
/// which can't run again while one of its own blocks (where the tests run) is still going: so quit from a timer.
@MainActor func quitAfterTest() {
    Timer.scheduledTimer(withTimeInterval: 0, repeats: false) { _ in MainActor.assumeIsolated { NSApp.terminate(nil) } }
}
#endif
