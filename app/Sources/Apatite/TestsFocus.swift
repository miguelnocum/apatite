#if APATITE_TESTS
import AppKit
import WebKit

/// Runs only when APATITE_FOCUSTEST is set (with APATITE_LIBRARY at a throwaway folder): the notes in focus mode, with
/// some of everything in them, the window at a few sizes; for each, a picture (the window's own frame, title bar and
/// traffic lights, with the page drawn into it, which a picture of the window alone leaves blank) and a report of what
/// the window and page are doing. Then zoom, a menu from the bar at the bottom, and a selection, and a comment opened from its text. Pictures and report go
/// in the library's "focus" folder. app/tools/focusshots.sh builds the app and runs it.
@MainActor
enum FocusTest {
    static let sizes: [(String, CGFloat, CGFloat)] = [("wide", 1200, 800), ("medium", 720, 780), ("narrow", 420, 700)]

    static func runIfRequested() {
        guard TestRun.requested("APATITE_FOCUSTEST") != nil else { return }
        let t = TestRun(report: "focus/report.txt")
        try? FileManager.default.createDirectory(at: folder(t), withIntermediateDirectories: true)
        t.at(2.0) { t.s.openNotes() }
        t.at(4.0) { t.page(sampleNotes + focusOn, "focus on") }
        for (i, size) in sizes.enumerated() {
            t.at(6.0 + Double(i) * 2.5) { resize(t, size.1, size.2) }
            t.at(7.5 + Double(i) * 2.5) { check(t, size.0) }
        }
        let after = 6.0 + Double(sizes.count) * 2.5
        t.at(after) { resize(t, 900, 760); t.page(zoomIn, "zoom in twice") }
        t.at(after + 1.5) { check(t, "zoomed"); t.page(openHeadingMenu, "heading menu from the bar") }
        t.at(after + 3.0) { check(t, "menu"); t.page(selectAcross, "selection across blocks") }
        t.at(after + 4.5) { check(t, "selection"); t.page(openComment, "comment from its text") }
        t.at(after + 6.0) { check(t, "comments") }
        t.at(after + 7.5) { t.finish() }
    }

    static func folder(_ t: TestRun) -> URL { t.ws.root.appendingPathComponent("focus") }

    static func resize(_ t: TestRun, _ width: CGFloat, _ height: CGFloat) {
        t.s.session.webView?.window?.setFrame(NSRect(x: 60, y: 60, width: width, height: height), display: true)
    }

    /// the window's state, the page's, and a picture
    static func check(_ t: TestRun, _ name: String) {
        guard let web = t.s.session.webView, let window = web.window else { t.log.append("\(name): NO WINDOW"); return }
        t.log.append("— \(name): window \(Int(window.frame.width))×\(Int(window.frame.height)), " + chrome(window, web))
        t.page(pageState, "  page")
        shoot(web, window, into: folder(t).appendingPathComponent("\(name).png"))
    }

    /// what the window's title bar is doing, and where the page starts under it
    static func chrome(_ window: NSWindow, _ web: WKWebView) -> String {
        let inWindow = web.convert(web.bounds, to: nil)
        let gapAtTop = (window.contentView?.bounds.height ?? 0) - inWindow.maxY
        let inset = web.responds(to: NSSelectorFromString("_topContentInset")) ? "\(web.value(forKey: "topContentInset") ?? "?")" : "n/a"
        return "title bar see-through \(window.titlebarAppearsTransparent), full-size content \(window.styleMask.contains(.fullSizeContentView)), "
            + "toolbar shown \(window.toolbar?.isVisible ?? false), traffic lights \(window.standardWindowButton(.closeButton)?.isHidden == false), "
            + "page starts \(Int(gapAtTop)) pt below the window's top, web view's own top inset \(inset)"
    }

    /// the window's frame (title bar and traffic lights included) with the page drawn in where the web view is
    static func shoot(_ web: WKWebView, _ window: NSWindow, into file: URL) {
        guard let frameView = window.contentView?.superview,
              let rep = frameView.bitmapImageRepForCachingDisplay(in: frameView.bounds) else { return }
        frameView.cacheDisplay(in: frameView.bounds, to: rep)
        let place = web.convert(web.bounds, to: frameView)
        web.takeSnapshot(with: nil) { image, _ in
            let out = NSImage(size: frameView.bounds.size)
            out.lockFocus()
            rep.draw(in: frameView.bounds)
            image?.draw(in: place)
            out.unlockFocus()
            if let tiff = out.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                try? png.write(to: file)
            }
        }
    }

    // MARK: the page's side

    static let sampleNotes = """
    (() => { document.querySelector('[data-view="notes"]').click(); const ed = document.getElementById('ed');
    ed.innerHTML = '<h1>Week 4: The Environmental State</h1><h2>Social theoretical accounts of the state</h2><h3>1. Marx and Engels</h3>'
      + '<blockquote>The development of <span data-cmt="c1" data-ct="q" data-note="Which edition is this from?">modern industry</span> cuts from under its feet the very foundation on which the bourgeoisie produces and appropriates products.</blockquote>'
      + '<ul><li>Marx argues that modern industry undermines its own foundations</li><li>The state is the executive committee of the bourgeoisie</li></ul>'
      + '<table><tbody><tr><th>Type</th><th>Years</th><th>Checks</th></tr><tr><td>Car</td><td>6</td><td>Every 2 years</td></tr></tbody></table>'
      + '<p>' + 'Environmental states emerge as capital needs regulation of its own ecological conditions. '.repeat(6) + '</p>'
      + '<p>More text. </p>'.repeat(30);
    ed.dispatchEvent(new Event('input', { bubbles: true })); })();
    """

    static let focusOn = "if (!document.documentElement.classList.contains('focus')) nbToggleFocus(); 'focus ' + document.documentElement.classList.contains('focus')"

    static let pageState = """
    (() => { const r = document.documentElement, d = document.querySelector('.doc'), e = document.getElementById('ed');
      const b = d && d.getBoundingClientRect(), first = e && e.firstElementChild && e.firstElementChild.getBoundingClientRect();
      const tb = document.getElementById('tb').getBoundingClientRect();
      return 'classes ' + r.className + '; window ' + innerWidth + '×' + innerHeight + '; page ' + (b ? Math.round(b.left) + '..' + Math.round(b.right) : 'none')
        + '; first line at y=' + (first ? Math.round(first.top) : '?') + '; text size ' + (e ? getComputedStyle(e).fontSize : '?')
        + '; sideways overflow ' + (r.scrollWidth > innerWidth) + '; bar ' + Math.round(tb.left) + '..' + Math.round(tb.right) + ' at y=' + Math.round(tb.top)
        + '; zoom ' + document.getElementById('zlab').textContent; })()
    """

    static let zoomIn = """
    [1, 2].forEach(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true }))); getComputedStyle(document.getElementById('ed')).fontSize
    """

    static let openHeadingMenu = """
    (() => { const ed = document.getElementById('ed'); ed.focus(); const r = document.createRange(); r.selectNodeContents(ed.querySelector('h3')); r.collapse(false);
      getSelection().removeAllRanges(); getSelection().addRange(r); document.getElementById('tb-head').click();
      const m = document.querySelector('.tbmenu'), b = document.getElementById('tb-head').getBoundingClientRect();
      return m ? 'menu ' + Math.round(m.getBoundingClientRect().top) + '..' + Math.round(m.getBoundingClientRect().bottom) + ', button at y=' + Math.round(b.top)
        + (m.getBoundingClientRect().bottom <= b.top ? ' (opens upward)' : ' (opens DOWNWARD)') : 'NO MENU'; })()
    """

    static let openComment = """
    (() => { getSelection().removeAllRanges(); document.querySelector('#ed span[data-cmt]').click();
      const box = document.getElementById('cmts'), r = box.getBoundingClientRect(), fab = document.getElementById('cmtfab');
      return (box.classList.contains('drawer-open') ? 'drawer open ' : 'DRAWER SHUT ') + Math.round(r.left) + '..' + Math.round(r.right)
        + ' × ' + Math.round(r.top) + '..' + Math.round(r.bottom) + ', cards ' + box.querySelectorAll('.cmtcard').length
        + ', count button ' + (fab && !fab.hidden ? 'shown' : 'hidden'); })()
    """

    static let selectAcross = """
    (() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); const ed = document.getElementById('ed');
      const q = ed.querySelector('blockquote').firstChild, li = ed.querySelectorAll('li')[1].firstChild, r = document.createRange();
      r.setStart(q, 4); r.setEnd(li, 12); getSelection().removeAllRanges(); getSelection().addRange(r); return 'selected'; })()
    """
}
#endif
