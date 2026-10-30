import AppKit

/// Runs only when APATITE_PERFTEST is set (with APATITE_LIBRARY, a copy of a real library).
/// A heartbeat every 16 ms measures how long the app freezes while doing what a person does, and one in the page
/// measures the page's own while it is typed in and saved; the notebook's flush and the app's persist are timed too.
@MainActor
enum PerfTest {
    static var last = Date(), worst = 0.0, stalled = 0.0, phase = "start"
    static var perPhase: [String: (worst: Double, total: Double)] = [:]
    /// the heartbeat's interval, and the gap over it that counts as a freeze (ms)
    static let beat = 0.016, freezeMs = 50.0
    static let phases = ["1 open Database", "2 open a paper from the Database", "3 scroll through the paper", "4 open the notebook from the Database", "5 type in the notes"]

    static func runIfRequested() {
        guard TestRun.requested("APATITE_PERFTEST") != nil else { return }
        let t = TestRun(report: "perftest.txt"), s = t.s, ws = t.ws
        heartbeat()
        let big = ws.projects().max { Library(project: $0.url).loadItems().count < Library(project: $1.url).loadItems().count }!
        let papers = Library(project: big.url).loadItems()
        let paper = largest(papers, in: big)
        at(1.5, "0 start in another project") { if s.project.id == big.id, let other = ws.projects().first(where: { $0.id != big.id }) { s.switchTo(other) } }
        at(3, phases[0]) { s.screen = .database }
        at(5, phases[1]) { perfMarks = ["-- open a paper in another project"]; s.openPaper(big, paper.id) }
        at(8, phases[2]) { repeatEvery(beat, times: 150) { scrollDown(s) } }
        at(12, phases[3]) { s.screen = .database; perfMarks.append("-- open notebook"); if let nb = ws.items(.notebooks, in: big).first { s.openNotebook(big, nb.id) } }
        at(15, phases[4]) { repeatEvery(0.08, times: 40) { s.webView?.evaluateJavaScript(typeAWord) } }
        at(14.9, "4b") { s.webView?.evaluateJavaScript(pageBeat) }
        at(21, "5b") {
            t.page("JSON.stringify(window.__hb)", "page heartbeat while typing + saving")
            t.page(flushTimed, "flush")
        }
        at(23, "end") { report(t, big, papers.count, paper) }
    }

    private static func heartbeat() {
        Timer.scheduledTimer(withTimeInterval: beat, repeats: true) { _ in
            MainActor.assumeIsolated {
                let gap = Date().timeIntervalSince(last) * 1000 - beat * 1000; last = Date()
                if gap > freezeMs { var p = perPhase[phase] ?? (0, 0); p.worst = max(p.worst, gap); p.total += gap; perPhase[phase] = p }
            }
        }
    }

    private static func at(_ d: Double, _ name: String, _ f: @escaping @MainActor () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + d) { MainActor.assumeIsolated { phase = name; f() } }
    }

    /// the largest PDF in that project
    private static func largest(_ papers: [LibItem], in big: ProjectInfo) -> LibItem {
        let size = { (it: LibItem) in (try? Library(project: big.url).url(for: it).resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0 }
        return papers.max { size($0) < size($1) }!
    }

    private static func repeatEvery(_ interval: Double, times: Int, _ f: @escaping @MainActor () -> Void) {
        var n = 0
        Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { timer in
            MainActor.assumeIsolated {
                n += 1
                f()
                if n > times { timer.invalidate() }
            }
        }
    }

    private static func scrollDown(_ s: AppState) {
        guard let sv = s.pdfView?.documentView?.enclosingScrollView else { return }
        let c = sv.contentView; var o = c.bounds.origin; o.y += 40; c.scroll(to: o); sv.reflectScrolledClipView(c)
    }

    /// the page's own heartbeat: freezes over 50 ms, as the app's one counts them
    static let pageBeat = "window.__hb={worst:0,total:0,n:0,last:performance.now()};setInterval(function(){var g=performance.now()-__hb.last-16;__hb.last=performance.now();if(g>50){__hb.n++;__hb.total+=Math.round(g);__hb.worst=Math.max(__hb.worst,Math.round(g))}},16)"
    /// what the notebook's flush (the page's whole state, as the app asks for it when closing or switching) costs
    static let flushTimed = "(function(){var a=performance.now();var s=nbFlush();return 'nbFlush '+Math.round(performance.now()-a)+' ms, '+(s.length/1024|0)+' KB'})()"

    static let typeAWord = "(function(){var e=document.getElementById('ed');if(!e)return;e.focus();var r=document.createRange();r.selectNodeContents(e);r.collapse(false);var s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,'word ')})()"

    private static func report(_ t: TestRun, _ big: ProjectInfo, _ paperCount: Int, _ paper: LibItem) {
        t.log.append("library: \(t.ws.projects().count) projects; test project \(big.name) with \(paperCount) papers; paper \(paper.title) (\(t.s.document?.pageCount ?? 0) pages)")
        t.log.append("steps (time since the previous step):"); t.log += perfMarks
        for k in perPhase.keys.sorted() where k != "end" { let p = perPhase[k]!; t.log.append(String(format: "%@: worst freeze %.0f ms, total frozen %.0f ms", k, p.worst, p.total)) }
        for k in phases where perPhase[k] == nil { t.log.append("\(k): no freezes over 50 ms") }
        t.finish()
    }
}
