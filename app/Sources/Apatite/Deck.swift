import SwiftUI

/// One flashcard. The study fields drive spaced repetition (a simplified SM-2) and the confidence suggestions.
struct Card: Codable, Identifiable, Hashable {
    var id: String
    var term: String
    var def: String
    var pt: String?          // spec point it belongs to (in the deck's syllabus)
    var starred = false
    var due: Double?         // seconds since 1970; nil = never studied
    var interval = 0.0       // days
    var ease = 2.5
    var reps = 0
    var lapses = 0
    var right = 0
    var wrong = 0

    init(term: String = "", def: String = "") { id = Workspace.newID(); self.term = term; self.def = def }

    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        term = try c.decodeIfPresent(String.self, forKey: .term) ?? ""
        def = try c.decodeIfPresent(String.self, forKey: .def) ?? ""
        pt = try c.decodeIfPresent(String.self, forKey: .pt)
        starred = try c.decodeIfPresent(Bool.self, forKey: .starred) ?? false
        due = try c.decodeIfPresent(Double.self, forKey: .due)
        interval = try c.decodeIfPresent(Double.self, forKey: .interval) ?? 0
        ease = try c.decodeIfPresent(Double.self, forKey: .ease) ?? 2.5
        reps = try c.decodeIfPresent(Int.self, forKey: .reps) ?? 0
        lapses = try c.decodeIfPresent(Int.self, forKey: .lapses) ?? 0
        right = try c.decodeIfPresent(Int.self, forKey: .right) ?? 0
        wrong = try c.decodeIfPresent(Int.self, forKey: .wrong) ?? 0
    }

    var isBlank: Bool { term.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && def.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var isNew: Bool { due == nil }
    func isDue(_ now: Date = Date()) -> Bool { due.map { $0 <= now.timeIntervalSince1970 } ?? true }
    /// Learnt well: it comes back three weeks or more from now.
    var mastered: Bool { interval >= 21 }
}

struct Deck: Codable {
    var id: String
    var title: String
    var cards: [Card]
    var syllabus: String?
    var folder: String?
    var created: Double?
    var updated: Double?

    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        cards = try c.decodeIfPresent([Card].self, forKey: .cards) ?? []
        syllabus = try c.decodeIfPresent(String.self, forKey: .syllabus)
        folder = try c.decodeIfPresent(String.self, forKey: .folder)
        created = try c.decodeIfPresent(Double.self, forKey: .created)
        updated = try c.decodeIfPresent(Double.self, forKey: .updated)
    }
    init(id: String, title: String) { self.id = id; self.title = title; cards = []; created = Date().timeIntervalSince1970 }
}

/// A confidence rating's colour (0 = not rated … 4 = confident), as in the notebook.
func confidenceColor(_ n: Int) -> Color {
    [Color.gray.opacity(0.35), Color(red: 0.84, green: 0.27, blue: 0.24), Color(red: 0.91, green: 0.53, blue: 0.16),
     Color(red: 0.88, green: 0.71, blue: 0.13), Color(red: 0.18, green: 0.62, blue: 0.36)][max(0, min(4, n))]
}

/// Answers in Learn.
enum Grade: Int, CaseIterable { case again = 1, hard, good, easy
    var label: String { ["Again", "Hard", "Good", "Easy"][rawValue - 1] }
}

extension Card {
    /// The schedule's numbers (SM-2 style): ease never drops below `minEase`; Again and Hard lower it, Easy raises it.
    static let minEase = 1.3, againEaseDrop = 0.2, hardEaseDrop = 0.15, easyEaseRise = 0.15
    /// Hard stretches the interval a little, Easy more than Good; Good's first two intervals are 1 and 3 days, Easy's
    /// first is 4.
    static let hardStretch = 1.2, easyStretch = 1.3, goodFirstDays = 1.0, goodSecondDays = 3.0, easyFirstDays = 4.0
    /// Again comes back in a minute, a hard first look in five.
    static let againDelay: TimeInterval = 60, hardFirstDelay: TimeInterval = 300, secondsPerDay: TimeInterval = 86400

    /// The card after an answer in Learn. Again and a hard first look come back within the session.
    func graded(_ g: Grade, now: Date = Date()) -> (Card, again: Bool) {
        var c = self
        let t = now.timeIntervalSince1970
        guard g != .again else { c.forgot(at: t); return (c, true) }
        c.right += 1
        switch g {
        case .hard:
            if reps == 0 { c.due = t + Self.hardFirstDelay; return (c, true) }
            c.rememberedHard()
        case .good:
            c.interval = reps == 0 ? Self.goodFirstDays : reps == 1 ? Self.goodSecondDays : interval * ease; c.reps += 1
        case .easy:
            c.interval = reps == 0 ? Self.easyFirstDays : max(Self.easyFirstDays, interval * ease * Self.easyStretch); c.ease = ease + Self.easyEaseRise; c.reps += 1
        case .again: break
        }
        c.due = t + c.interval * Self.secondsPerDay
        return (c, false)
    }

    /// Hard (not the first time): a little longer, a little harder from now on
    private mutating func rememberedHard() {
        interval = max(1, interval * Self.hardStretch); ease = max(Self.minEase, ease - Self.hardEaseDrop); reps += 1
    }

    /// Again: a lapse (if it had been learned), back to the start, a little harder from now on
    private mutating func forgot(at t: TimeInterval) {
        lapses += reps > 0 ? 1 : 0; reps = 0; interval = 0; ease = max(Self.minEase, ease - Self.againEaseDrop); wrong += 1
        due = t + Self.againDelay
    }

    /// "1 min", "3 days" … what each answer would schedule, for the buttons.
    func preview(_ g: Grade) -> String {
        let (c, again) = graded(g)
        if again { return g == .again ? "1 min" : "5 min" }
        let d = c.interval
        return d < 1 ? "today" : d < 30 ? "\(Int(d.rounded())) day\(Int(d.rounded()) == 1 ? "" : "s")" : d < 365 ? "\(Int((d / 30).rounded())) mo" : "\(String(format: "%.1f", d / 365)) yr"
    }
}

/// "Paris" matches "paris", "Paris." and (for longer answers) a slip or two.
func answerMatches(_ typed: String, _ answer: String) -> Bool {
    func norm(_ s: String) -> String {
        s.lowercased().folding(options: .diacriticInsensitive, locale: nil)
            .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
    }
    let a = norm(typed), b = norm(answer)
    guard !a.isEmpty else { return false }
    if a == b { return true }
    let allowed = b.count >= 12 ? 2 : b.count >= 6 ? 1 : 0
    return allowed > 0 && levenshtein(a, b) <= allowed
}

func levenshtein(_ a: String, _ b: String) -> Int {
    let x = Array(a), y = Array(b)
    if x.isEmpty { return y.count }; if y.isEmpty { return x.count }
    var prev = Array(0...y.count), cur = prev
    for i in 1...x.count {
        cur[0] = i
        for j in 1...y.count { cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] == y[j - 1] ? 0 : 1)) }
        prev = cur
    }
    return prev[y.count]
}

/// A spec point's study record, and the rating it suggests.
struct PointSuggestion: Identifiable {
    let id: String          // point id
    let code: String
    let text: String
    let current: Int
    let suggested: Int
    let attempts: Int
    let accuracy: Double
}

extension Workspace {
    func createDeck(in p: ProjectInfo, title: String, folder: String? = nil) -> DocItem {
        let dir = p.url.appendingPathComponent(ItemKind.decks.folder)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let u = freeURL(in: dir, name: Self.safeName(title, fallback: "Deck"), ext: "json")
        let id = Self.newID()
        var o: JSON = ["id": id, "title": title, "cards": [Any](), "created": Date().timeIntervalSince1970]
        if let folder { o["folder"] = folder }
        write(o, to: u)
        return DocItem(id: id, title: title, url: u, modified: Date())
    }

    /// A syllabus's points, in order: (id, code, text, rating).
    func points(of sid: String?, in p: ProjectInfo) -> [(id: String, code: String, text: String, status: Int, sub: Bool)] {
        guard let sid, let it = item(.syllabi, sid, in: p), let pts = read(it.url)?["pts"] as? [JSON] else { return [] }
        return pts.compactMap { x in
            guard let id = x["id"] as? String else { return nil }
            return (id, x["code"] as? String ?? "", x["text"] as? String ?? "", max(0, min(4, x["status"] as? Int ?? 0)), (x["lvl"] as? Int) == 3)
        }
    }

    func setRating(_ pid: String, _ n: Int, syllabus sid: String, in p: ProjectInfo) {
        guard let it = item(.syllabi, sid, in: p), var o = read(it.url), var pts = o["pts"] as? [JSON] else { return }
        for i in pts.indices where pts[i]["id"] as? String == pid { pts[i]["status"] = n }
        o["pts"] = pts; write(o, to: it.url)
    }
}

extension AppState {
    /// Opens a deck: in its own window while that window is in use, otherwise on the deck screen.
    func openDeck(_ p: ProjectInfo, _ id: String, ownWindow: Bool = false) {
        flushAll { [self] in
            guard let it = workspace.item(.decks, id, in: p), let d = try? Data(contentsOf: it.url), let dk = try? JSONDecoder().decode(Deck.self, from: d) else { return }
            saveDeckNow()
            deck = dk; deckURL = it.url; deckProject = p
            if ownWindow || deckDetached { showDeckWindow() } else { screen = .deck }
        }
    }

    // MARK: a deck in its own window, beside the notes

    /// The deck moves to its own window (for adding cards while the notes stay open); the main window goes back to the notes.
    func popOutDeck() {
        saveDeckNow()
        deckStartEdit = true
        showDeckWindow()
        if screen == .deck { showEditor() }
    }

    func showDeckWindow() {
        deckDetached = true
        if let p = deckProject, let d = deck { Self.prefs.set(p.id + "|" + d.id, forKey: "deckWindow") }
        openDeckWindow?()
    }

    /// Back into the main window.
    func dockDeck() {
        guard deckDetached else { return }
        saveDeckNow()
        deckDetached = false
        Self.prefs.removeObject(forKey: "deckWindow")
        closeDeckWindow?()
        if deck != nil { screen = .deck }
    }

    /// Closing the deck's window keeps the deck saved and out of the way.
    func deckWindowClosed() {
        guard deckDetached, !quitting else { return }
        saveDeckNow()
        deckDetached = false
        Self.prefs.removeObject(forKey: "deckWindow")
    }

    /// Go ▸ Deck in Its Own Window (⇧⌘D): the open deck, else this project's latest, else a new one, ready for new cards.
    func deckWindowShortcut() {
        if deckDetached { openDeckWindow?(); return }
        deckStartEdit = true
        if deck != nil, deckProject?.id == project.id { popOutDeck(); return }
        if let d = workspace.items(.decks, in: project).first { openDeck(project, d.id, ownWindow: true); return }
        let made = workspace.createDeck(in: project, title: "Untitled deck")
        revision += 1
        openDeck(project, made.id, ownWindow: true)
    }

    /// At launch: the deck that was in its own window when the app quit comes back there.
    func restoreDeckWindow() {
        guard let v = Self.prefs.string(forKey: "deckWindow") else { return }
        let parts = v.split(separator: "|").map(String.init)
        guard parts.count == 2, let p = workspace.project(parts[0]), workspace.item(.decks, parts[1], in: p) != nil else {
            Self.prefs.removeObject(forKey: "deckWindow"); return
        }
        openDeck(p, parts[1], ownWindow: true)
    }

    func newDeck(in p: ProjectInfo? = nil) {
        let pr = p ?? project
        let made = workspace.createDeck(in: pr, title: "Untitled deck")
        revision += 1
        openDeck(pr, made.id)
    }

    func saveDeckSoon() {
        deckSave?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.saveDeckNow() }
        deckSave = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: w)
    }

    func saveDeckNow() {
        deckSave?.cancel(); deckSave = nil
        guard var dk = deck, let u = deckURL, FileManager.default.fileExists(atPath: u.path) else { return }
        dk.updated = Date().timeIntervalSince1970
        // keep anything else in the file (written by other parts of the app), replace what the deck owns
        var o = workspace.read(u) ?? [:]
        if let d = try? JSONEncoder().encode(dk), let mine = (try? JSONSerialization.jsonObject(with: d)) as? JSON { for (k, v) in mine { o[k] = v } }
        if dk.syllabus == nil { o["syllabus"] = nil }
        workspace.write(o, to: u)
        // the file name follows the title
        if let p = deckProject, let it = workspace.item(.decks, dk.id, in: p), it.title != (dk.title.isEmpty ? "Untitled deck" : dk.title) || it.url != u {
            workspace.rename(.decks, it, to: dk.title)
            deckURL = workspace.item(.decks, dk.id, in: p)?.url
        }
    }

    /// Spec points whose cards have been studied enough to suggest a confidence rating different from the current one.
    func ratingSuggestions() -> [PointSuggestion] {
        guard let dk = deck, let p = deckProject, let sid = dk.syllabus else { return [] }
        return workspace.points(of: sid, in: p).compactMap { pt in
            let cs = dk.cards.filter { $0.pt == pt.id }
            let r = cs.reduce(0) { $0 + $1.right }, w = cs.reduce(0) { $0 + $1.wrong }
            guard r + w >= 3 else { return nil }
            let acc = Double(r) / Double(r + w)
            let allMastered = !cs.isEmpty && cs.allSatisfy(\.mastered)
            let sug = allMastered || acc >= 0.9 ? 4 : acc >= 0.7 ? 3 : acc >= 0.4 ? 2 : 1
            guard sug != pt.status else { return nil }
            return PointSuggestion(id: pt.id, code: pt.code, text: pt.text, current: pt.status, suggested: sug, attempts: r + w, accuracy: acc)
        }
    }
}
