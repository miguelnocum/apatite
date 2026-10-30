import AppKit

/// Runs only when APATITE_FOLDERTEST names a folder (and APATITE_LIBRARY a throwaway library).
@MainActor
enum FolderTest {
    static func runIfRequested() {
        guard let path = TestRun.requested("APATITE_FOLDERTEST") else { return }
        let t = TestRun(report: "foldertest.txt")
        t.at(2) {
            let scan = FolderImport.scan(URL(fileURLWithPath: path))
            t.log.append("found \(scan.total) PDFs: \(scan.loose) loose, subfolders \(scan.subfolders)")
            importFolder(t, scan, "1. all into a new project", split: false)
            importFolder(t, scan, "2. same folder again", split: false)
            importFolder(t, scan, "3. subfolders as projects", split: true)
            for p in t.ws.projects() {
                let items = Library(project: p.url).loadItems()
                t.log.append("   \(p.name): " + items.map { "\($0.file) (\($0.title))" }.joined(separator: ", "))
            }
            t.finish()
        }
    }

    private static func importFolder(_ t: TestRun, _ scan: FolderImport.Scan, _ label: String, split: Bool) {
        let (plan, _) = FolderImport.plan(scan, destination: nil, split: split, ws: t.ws)
        let r = FolderImport.run(plan) { _ in }
        t.log.append("\(label): imported \(r.imported) into \(r.projects), duplicates \(r.duplicates), failed \(r.failed)")
    }
}

/// Runs only when APATITE_ORGTEST is set (with APATITE_LIBRARY): folders around and inside projects, shared syllabi.
@MainActor
enum OrgTest {
    final class State { var p: ProjectInfo!, nb: DocItem! }

    static func runIfRequested() {
        guard TestRun.requested("APATITE_ORGTEST") != nil else { return }
        let t = TestRun(report: "orgtest.txt"), state = State()
        t.at(1.5) {
            nestedProjects(t, state)
            projectFolders(t, state)
            sharedSyllabus(t, state.p, state.nb)
            mergeOldSyllabi(t)
            // Settings ▸ Syllabus: "New syllabus…" for the open notebook
            t.s.switchTo(state.p, notebook: t.ws.items(.notebooks, in: state.p).first { $0.title == "Second" }!.id, view: "syl")
        }
        t.at(4.5) { t.page(newSyllabusInSettings) { r in t.log.append("page picker before: \(r as? String ?? "?")") } }
        t.at(7.5) { checkNewSyllabus(t, state.p) }
    }

    private static func checkNewSyllabus(_ t: TestRun, _ p: ProjectInfo) {
        let nb2 = t.ws.items(.notebooks, in: p).first { $0.title == "Second" }!
        let sid = t.ws.syllabusOf(.notebooks, nb2.id, in: p)
        t.log.append("after New syllabus…: linked to \(sid.flatMap { t.ws.item(.syllabi, $0, in: p)?.title } ?? "NONE"); syllabi now \(t.ws.items(.syllabi, in: p).map(\.title))")
        t.page("JSON.stringify((window.__NB__||{}).syllabus)") { r in
            t.log.append("page now knows: \(r as? String ?? "?")")
            t.finish()
        }
    }

    static let newSyllabusInSettings = "(function(){nbOpenSettings('syl');var sel=[].find.call(document.querySelectorAll('.setov [data-setsyl=notebooks]'),function(x){return [].some.call(x.options,function(o){return o.value==='__new'})});if(!sel)return 'NOT FOUND';var opts=[].map.call(sel.options,function(o){return o.text}).join('/');sel.value='__new';sel.dispatchEvent(new Event('change',{bubbles:true}));return 'shown '+opts})()"

    /// folders of projects, nested, and a project moved into one
    private static func nestedProjects(_ t: TestRun, _ state: State) {
        let ws = t.ws
        let g = ws.createGroup(named: "Year 2", in: ws.root), g2 = ws.createGroup(named: "Semester 1", in: g)
        state.p = ws.createProject(named: "Deep Learning", in: g2)
        let p = state.p!
        t.log.append("nested project found: \(ws.projects().contains { $0.id == p.id }) at \(p.url.path.replacingOccurrences(of: ws.root.path, with: ""))")
        let loose = ws.createProject(named: "Loose")
        ws.moveDir(loose.url, into: g)
        t.log.append("moved project into Year 2: \(ws.children(of: g).projects.map(\.name)), groups there: \(ws.children(of: g).groups.map(\.lastPathComponent))")
        t.log.append("top level shows: groups \(ws.children(of: ws.root).groups.map(\.lastPathComponent))")
    }

    /// folders inside a project; deleting one moves what's in it up
    private static func projectFolders(_ t: TestRun, _ state: State) {
        let ws = t.ws, p = state.p!
        let f = ws.createFolder(named: "Week 1", parent: nil, in: p), f2 = ws.createFolder(named: "Readings", parent: f.id, in: p)
        state.nb = ws.items(.notebooks, in: p).first!
        let nb = state.nb!
        ws.setFolder(.notebooks, nb.id, f2.id, in: p)
        let e = ws.createEssay(in: p, title: "Essay A"); ws.setFolder(.essays, e.id, f.id, in: p)
        t.log.append("folders: \(ws.folders(in: p).map { "\($0.name) in \($0.parent.flatMap { id in ws.folders(in: p).first { $0.id == id }?.name } ?? "top")" }), notebook in Readings: \(ws.folderOf(.notebooks, nb.id, in: p) == f2.id)")
        ws.deleteFolder(f2.id, in: p)
        t.log.append("after deleting Readings, notebook moved up to Week 1: \(ws.folderOf(.notebooks, nb.id, in: p) == f.id); folders left \(ws.folders(in: p).map(\.name))")
    }

    /// a syllabus followed by two notebooks and an essay: a rating set in one shows in the other
    private static func sharedSyllabus(_ t: TestRun, _ p: ProjectInfo, _ nb: DocItem) {
        let ws = t.ws
        let e = ws.items(.essays, in: p).first { $0.title == "Essay A" }!
        let sy = ws.createSyllabus(in: p, title: "DL syllabus", pts: [["id": "a", "sec": "1 Intro", "code": "1.1", "text": "One", "status": 2]])
        let nb2 = ws.createNotebook(in: p, title: "Second")
        ws.linkSyllabus(.notebooks, nb.id, to: sy.id, in: p); ws.linkSyllabus(.notebooks, nb2.id, to: sy.id, in: p); ws.linkSyllabus(.essays, e.id, to: sy.id, in: p)
        t.log.append("used by: \(ws.users(of: sy.id, in: p).map { $0.1.title })")
        func session(_ d: DocItem) -> [String: Any] { (try? JSONSerialization.jsonObject(with: Data(ws.sessionJSON(p, notebook: d).utf8))) as? [String: Any] ?? [:] }
        var s2 = session(nb2)
        t.log.append("second notebook boots with the shared points: \((s2["pts"] as? [Any])?.count ?? 0), syllabus \((s2["syllabus"] as? [String: Any])?["title"] ?? "none")")
        var pts = s2["pts"] as? [[String: Any]] ?? []; pts[0]["status"] = 4; s2["pts"] = pts
        ws.saveSession(String(data: try! JSONSerialization.data(withJSONObject: s2), encoding: .utf8)!, p, notebook: nb2)
        let r1 = ((session(nb)["pts"] as? [[String: Any]])?.first?["status"] as? Int) ?? -1
        t.log.append("rating set in the second notebook shows in the first: \(r1 == 4)")
    }

    /// two old-style notebooks carrying the same syllabus merge into one
    private static func mergeOldSyllabi(_ t: TestRun) {
        let ws = t.ws
        let pm = ws.createProject(named: "Merge test")
        let dir = pm.url.appendingPathComponent("Notebooks")
        let mk: (String, String, Int) -> [String: Any] = { id, title, st in ["id": id, "meta": ["title": title], "doc": "<p data-sp=\"\(id)-p\">notes</p>",
            "pts": [["id": "\(id)-p", "sec": "1 S", "code": "1.1", "text": "Same point", "status": st]]] }
        ws.write(mk("n1", "First copy", 1), to: dir.appendingPathComponent("a.json")); ws.write(mk("n2", "Second copy", 3), to: dir.appendingPathComponent("b.json"))
        ws.migrateSyllabi(pm)
        let syls = ws.items(.syllabi, in: pm)
        let a = ws.read(dir.appendingPathComponent("a.json")) ?? [:], b = ws.read(dir.appendingPathComponent("b.json")) ?? [:]
        let spts = syls.first.flatMap { ws.read($0.url)?["pts"] as? [[String: Any]] } ?? []
        let sp = spts.first?["id"] as? String ?? "?"
        let tagged = (a["doc"] as? String ?? "").contains(sp) && (b["doc"] as? String ?? "").contains(sp) ? "yes" : "NO"
        t.log.append("merge: \(syls.count) syllabus for 2 notebooks, both linked to it: \(a["syllabus"] as? String == syls.first?.id && b["syllabus"] as? String == syls.first?.id), rating kept the higher: \(spts.first?["status"] as? Int ?? -1), both notebooks' tags point at the shared point: \(tagged)")
    }
}

/// Runs only when APATITE_DECKTEST is set (with APATITE_LIBRARY): flashcard decks.
@MainActor
enum DeckTest {
    static func runIfRequested() {
        guard TestRun.requested("APATITE_DECKTEST") != nil else { return }
        let t = TestRun(report: "decktest.txt")
        t.at(1.5) {
            schedule(t)
            let p = t.s.project
            let sy = t.ws.createSyllabus(in: p, title: "Deck syllabus", pts: [["id": "pt1", "sec": "1 S", "code": "1.1", "text": "Overfitting", "status": 1]])
            let d = t.ws.createDeck(in: p, title: "Test deck")
            t.s.openDeck(p, d.id)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                cardsAndSuggestions(t, p, deckID: d.id, syllabusID: sy.id)
                ownWindow(t)
            }
        }
    }

    /// the spaced repetition schedule, forgetting, and how answers are checked
    private static func schedule(_ t: TestRun) {
        var c = Card(term: "Overfitting", def: "Fitting noise in the training data")
        var trail: [String] = []
        for g in [Grade.good, .good, .good, .easy] { let r = c.graded(g); c = r.0; trail.append("\(g.label)→\(String(format: "%.1f", c.interval))d") }
        t.log.append("spaced repetition: \(trail.joined(separator: ", "))")
        let lapse = c.graded(.again)
        t.log.append("forgetting it: back in \(Int(((lapse.0.due ?? 0) - Date().timeIntervalSince1970).rounded()))s, again in session: \(lapse.again), ease \(String(format: "%.2f", lapse.0.ease))")
        t.log.append("answer checks: exact \(answerMatches("Paris.", "paris")), slip \(answerMatches("the gradient desent method", "the gradient descent method")), wrong \(answerMatches("London", "Paris"))")
    }

    /// cards saved and read back, and rating suggestions from how they went
    private static func cardsAndSuggestions(_ t: TestRun, _ p: ProjectInfo, deckID: String, syllabusID: String) {
        let s = t.s, ws = t.ws
        t.log.append("deck screen open: \(s.screen == .deck) with \(s.deck?.title ?? "NONE")")
        var a = Card(term: "Overfitting", def: "Fitting noise"); a.pt = "pt1"; a.right = 5; a.wrong = 0
        var b = Card(term: "Underfitting", def: "Too simple a model"); b.pt = "pt1"; b.right = 4; b.wrong = 1
        s.deck?.cards = [a, b]; s.deck?.syllabus = syllabusID
        s.saveDeckNow()
        let back = ws.item(.decks, deckID, in: p).flatMap { try? JSONDecoder().decode(Deck.self, from: Data(contentsOf: $0.url)) }
        t.log.append("saved and read back: \(back?.cards.count ?? -1) cards, linked to syllabus \(back?.syllabus == syllabusID)")
        let sug = s.ratingSuggestions()
        t.log.append("suggestion: \(sug.map { "\($0.code) \($0.current)→\($0.suggested) (\(Int($0.accuracy * 100))%)" })")
        if let g = sug.first { ws.setRating(g.id, g.suggested, syllabus: syllabusID, in: p) }
        t.log.append("after applying: rating \(ws.points(of: syllabusID, in: p).first?.status ?? -1), suggestions left \(s.ratingSuggestions().count)")
        t.log.append("database sees the deck: \(ws.items(.decks, in: p).map(\.title)), used by for syllabus: \(ws.users(of: syllabusID, in: p).map { $0.1.title })")
    }

    private static func deckWindow() -> NSWindow? { NSApp.windows.first { $0.title.hasPrefix("Deck") && $0.isVisible } }

    /// the deck in its own window, beside the notes: popped out, docked, and from the Go menu
    private static func ownWindow(_ t: TestRun) {
        let s = t.s
        s.popOutDeck()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            t.log.append("popped out: window \"\(deckWindow()?.title ?? "NONE")\", main window back on the notes \(s.screen == .workspace && s.notesVisible), starts in Edit \(!s.deckStartEdit)")
            s.dockDeck()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                t.log.append("docked: window gone \(deckWindow() == nil), main window shows the deck \(s.screen == .deck)")
                s.deckWindowShortcut()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    t.log.append("Go ▸ Deck in Its Own Window: \(deckWindow()?.title ?? "NONE"), remembered for next launch \(AppState.prefs.string(forKey: "deckWindow") != nil)")
                    t.finish()
                }
            }
        }
    }
}
