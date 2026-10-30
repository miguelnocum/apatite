import AppKit
import WebKit

/// Runs only when APATITE_IMPORTTEST lists files ("a.docx|b.pdf") and APATITE_LIBRARY is a throwaway folder.
/// Imports them as essays through the page, then reports what each essay ended up containing.
/// Optional extras: page scripts (APATITE_IMPORTJS…4), a window size (APATITE_WINSIZE "640x900") or page width
/// (APATITE_WEBWIDTH), the reader beside (APATITE_READER), a real click or drag (APATITE_CLICKJS), real key presses
/// (APATITE_TYPE), and a picture of the page (APATITE_WEBSHOT).
@MainActor
enum ImportTest {
    static func runIfRequested() {
        guard let list = TestRun.requested("APATITE_IMPORTTEST") else { return }
        let t = TestRun(report: "importtest.txt")
        t.at(2.5) { importAll(t, list.split(separator: "|").map(String.init)) }
        t.at(5.0) {
            t.page("(document.getElementById('citebar')||{}).hidden===false?document.querySelector('#citebar .cc-f button').textContent:'closed'") { r in
                t.log.append("citation check after import: \(r as? String ?? "?")")
            }
        }
        pageSteps(t)
        windowSetup(t)
        if let js = TestRun.env("APATITE_CLICKJS"), let web = t.s.session.webView { t.at(6.0) { TestInput.click(web, js) } }
        if let keys = TestRun.env("APATITE_TYPE"), let web = t.s.session.webView { t.at(6.5) { TestInput.type(web, keys) } }
        if let shot = TestRun.env("APATITE_WEBSHOT"), let web = t.s.session.webView { t.at(10.5) { TestInput.snapshot(web, to: shot) } }
        t.at(11.5) { t.s.session.flushAll { report(t) } }
    }

    private static func importAll(_ t: TestRun, _ paths: [String]) {
        var results: [EssayImport.Result] = []
        for path in paths {
            do { results.append(try EssayImport.convert(URL(fileURLWithPath: path))) }
            catch { t.log.append("\((path as NSString).lastPathComponent): FAILED \(error.localizedDescription)") }
        }
        t.s.session.deliverImports(results, into: t.s.session.project)
    }

    /// optional steps to run in the page after the import (up to four batches, a pause between), each result logged
    private static func pageSteps(_ t: TestRun) {
        for (i, key) in ["APATITE_IMPORTJS", "APATITE_IMPORTJS2", "APATITE_IMPORTJS3", "APATITE_IMPORTJS4"].enumerated() {
            guard let js = TestRun.env(key) else { continue }
            t.at(5.5 + Double(i) * 1.5) { t.page(js, "page steps\(i == 0 ? "" : " \(i + 1)")") }
        }
    }

    /// optional window size, page width, and the reader beside the notes, to test narrow layouts
    private static func windowSetup(_ t: TestRun) {
        if let size = TestRun.env("APATITE_WINSIZE") {
            let p = size.split(separator: "x").compactMap { Double($0) }
            if p.count == 2 { t.at(1.0) { if let w = t.s.session.webView?.window { w.setFrame(NSRect(x: 40, y: 40, width: p[0], height: p[1]), display: true) } } }
        }
        if let w = TestRun.env("APATITE_WEBWIDTH").flatMap(Double.init) {
            t.at(4.0) {
                for win in NSApp.windows where win.contentView != nil && win.frame.width > 400 {
                    win.minSize = NSSize(width: 300, height: 300)
                    win.setFrame(NSRect(x: win.frame.minX, y: win.frame.minY, width: w, height: win.frame.height), display: true)
                }
            }
        }
        if TestRun.env("APATITE_READER") != nil { t.at(3.0) { t.s.navigation.readerVisible = true; t.s.navigation.notesVisible = true } }
    }

    /// what each imported essay ended up containing
    private static func report(_ t: TestRun) {
        for e in t.ws.items(.essays, in: t.s.session.project) {
            let doc = t.ws.read(e.url)?["doc"] as? String ?? ""
            func n(_ p: String) -> Int { (try? NSRegularExpression(pattern: p).numberOfMatches(in: doc, range: NSRange(doc.startIndex..., in: doc))) ?? 0 }
            t.log.append("— \(e.title) (\(e.url.lastPathComponent))")
            t.log.append("  paragraphs \(n("<p>")), headings h4 \(n("<h4>")) h5 \(n("<h5>")), lists \(n("<(ul|ol)>")) items \(n("<li>")), tables \(n("<table>")), quotes \(n("<blockquote>"))")
            t.log.append("  footnotes \(n("data-fn=")), figures \(n("<figure>")), captions \(n("<figcaption>[^<]")), images \(n("<img")), bold \(n("<strong>")), italic \(n("<em>")), links \(n("<a "))")
            t.log.append("  starts: " + String(plainText(doc).prefix(160)).replacingOccurrences(of: "\n", with: " ¶ "))
        }
        t.log.append("app's source list (what Link to source shows): \(t.s.citations.refs.map(\.label))")
        t.log.append("native theme: \(t.s.theme.map { "\($0.id) dark=\($0.dark) bg=\($0.bg) accent=\($0.accent)" } ?? "system")")
        t.finish()
    }
}

/// Real mouse and keyboard events into the notes page, and a picture of it, for tests.
@MainActor
enum TestInput {
    /// steps in a drag, and the time between them
    static let dragSteps = 12, dragStepDelay = 0.03, dragRelease = 0.45
    /// time between key presses
    static let keyDelay = 0.08

    /// the script returns "x,y" (a click there) or "x,y,x2,y2" (a press at the first point, a drag to the second, let go)
    static func click(_ web: WKWebView, _ js: String) {
        web.evaluateJavaScript(js) { r, _ in
            let xy = (r as? String ?? "").split(separator: ",").compactMap { Double($0) }
            guard xy.count == 2 || xy.count == 4, let win = web.window else { return }
            win.makeFirstResponder(web)
            let a = point(web, xy[0], xy[1]), z = xy.count == 4 ? point(web, xy[2], xy[3]) : a
            send(.leftMouseDown, a, web)
            guard xy.count == 4 else { send(.leftMouseUp, z, web); return }
            for i in 1...dragSteps {
                let f = Double(i) / Double(dragSteps)
                DispatchQueue.main.asyncAfter(deadline: .now() + dragStepDelay * Double(i)) { send(.leftMouseDragged, NSPoint(x: a.x + (z.x - a.x) * f, y: a.y + (z.y - a.y) * f), web) }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + dragRelease) { send(.leftMouseUp, z, web) }
        }
    }

    /// a point in page pixels, in the window
    private static func point(_ view: NSView, _ x: Double, _ y: Double) -> NSPoint {
        view.convert(NSPoint(x: x, y: view.isFlipped ? y : view.bounds.height - y), to: nil)
    }

    private static func send(_ type: NSEvent.EventType, _ pt: NSPoint, _ view: NSView) {
        guard let win = view.window, let ev = NSEvent.mouseEvent(with: type, location: pt, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                                 windowNumber: win.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1) else { return }
        switch type { case .leftMouseDown: view.mouseDown(with: ev); case .leftMouseDragged: view.mouseDragged(with: ev); default: view.mouseUp(with: ev) }
    }

    /// real key presses (⏎ ⌫ ⌦ ⇥ for those keys), one after another
    static func type(_ web: WKWebView, _ keys: String) {
        web.window?.makeFirstResponder(web)
        for (i, ch) in keys.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * keyDelay) { press(ch, in: web) }
        }
    }

    private static func press(_ ch: Character, in web: NSView) {
        let str = ch == "⏎" ? "\r" : ch == "⌫" ? "\u{7f}" : ch == "⌦" ? "\u{F728}" : ch == "⇥" ? "\t" : String(ch)
        let (code, shift) = keyCodes[ch] ?? (0, false)
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let ev = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: shift ? [.shift] : [], timestamp: ProcessInfo.processInfo.systemUptime,
                                            windowNumber: web.window?.windowNumber ?? 0, context: nil, characters: str,
                                            charactersIgnoringModifiers: str, isARepeat: false, keyCode: code) else { continue }
            if type == .keyDown { web.keyDown(with: ev) } else { web.keyUp(with: ev) }
        }
    }

    /// real Mac key codes (US layout), with Shift where the character needs it, so pages that read the key's code see a real key
    static let keyCodes: [Character: (UInt16, Bool)] = {
        var m: [Character: (UInt16, Bool)] = ["⏎": (36, false), "⌫": (51, false), "⌦": (117, false), "⇥": (48, false), " ": (49, false)]
        let plain: [(String, UInt16)] = [("a",0),("s",1),("d",2),("f",3),("h",4),("g",5),("z",6),("x",7),("c",8),("v",9),("b",11),("q",12),("w",13),("e",14),("r",15),("y",16),("t",17),("1",18),("2",19),("3",20),("4",21),("6",22),("5",23),("=",24),("9",25),("7",26),("-",27),("8",28),("0",29),("]",30),("o",31),("u",32),("[",33),("i",34),("p",35),("l",37),("j",38),("'",39),("k",40),(";",41),("\\",42),(",",43),("/",44),("n",45),("m",46),(".",47),("`",50)]
        for (c, k) in plain { m[Character(c)] = (k, false); if c.first!.isLetter { m[Character(c.uppercased())] = (k, true) } }
        for (c, k) in [("^",22),("_",27),("+",24),("(",25),(")",29),("{",33),("}",30),("|",42),("*",28),("!",18),("<",43),(">",47),(":",41),("\"",39)] as [(String, UInt16)] { m[Character(c)] = (k, true) }
        return m
    }()

    /// a picture of the page itself, as PNG
    static func snapshot(_ web: WKWebView, to path: String) {
        web.takeSnapshot(with: nil) { img, _ in
            guard let img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else { return }
            try? png.write(to: URL(fileURLWithPath: path))
        }
    }
}
