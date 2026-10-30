import Foundation

/// A project is a Finder folder under ~/Documents/Apatite:
///
///     Machine Learning/
///       project.json     id, name, Works Cited (refs, refSort)
///       Notebooks/       one JSON file per notebook (syllabus points + notes)
///       Essays/          one JSON file per essay
///       Papers/          the PDFs, plus papers.json (highlights, page numbers, linked source)
///       Syllabi/         one JSON file per syllabus (points and confidence); notebooks and essays link to one
///
/// Projects can sit inside ordinary folders (Year 2/Semester 1/Machine Learning). Inside a project,
/// project.json can list folders of its own that mix notebooks, essays, papers and syllabi.
///       Backups/         hourly copies of notebooks
struct ProjectInfo: Identifiable, Hashable {
    let id: String
    var name: String
    var url: URL
}

enum ItemKind: String, CaseIterable, Identifiable {
    case notebooks, essays, papers, syllabi, decks
    var id: String { rawValue }
    var title: String { switch self { case .notebooks: "Notes"; case .essays: "Essays"; case .papers: "Papers"; case .syllabi: "Syllabi"; case .decks: "Decks" } }
    var icon: String { switch self { case .notebooks: "square.and.pencil"; case .essays: "text.quote"; case .papers: "books.vertical"; case .syllabi: "list.bullet.rectangle"; case .decks: "rectangle.on.rectangle.angled" } }
    var folder: String { switch self { case .notebooks: "Notebooks"; case .essays: "Essays"; case .papers: "Papers"; case .syllabi: "Syllabi"; case .decks: "Decks" } }
    var single: String { switch self { case .notebooks: "Notebook"; case .essays: "Essay"; case .papers: "Paper"; case .syllabi: "Syllabus"; case .decks: "Deck" } }
    /// What a nameless one is called in lists.
    var untitled: String { "Untitled " + single.lowercased() }
}

/// A notebook or essay file.
struct DocItem: Identifiable, Hashable {
    let id: String
    var title: String
    var url: URL
    var modified: Date
}

typealias JSON = [String: Any]

@MainActor
final class Workspace {
    let root: URL
    let fm = FileManager.default
    private var lastBackup: [String: Date] = [:]
    /// Parsed files, kept while they are unchanged on disk: lists and saves read the same files over and over.
    private var parsed: [String: (stamp: Date, size: Int, obj: JSON)] = [:]

    init() {
        if let custom = ProcessInfo.processInfo.environment["APATITE_LIBRARY"], !custom.isEmpty {
            // Lets a test run use a throwaway folder instead of the real library.
            root = URL(fileURLWithPath: custom, isDirectory: true)
        } else {
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            root = docs.appendingPathComponent("Apatite", isDirectory: true)
            // The app used to be called Syllabus Notebook; bring its library across once.
            let old = docs.appendingPathComponent("Syllabus Notebook", isDirectory: true)
            if !fm.fileExists(atPath: root.path), fm.fileExists(atPath: old.path) {
                do { try fm.moveItem(at: old, to: root) }
                catch { NSLog("Could not move \(old.path) to \(root.path): \(error)") }
            }
        }
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)
        migrateSingleNotebook()
        migrateToOwnLists()
        for p in projects() { migrateSyllabi(p) }
        if projects().isEmpty { _ = createProject(named: "My first project") }
    }

    // MARK: files

    /// A file's modification date and size, straight from disk (URL resource values can be stale).
    private func stamp(_ path: String) -> (Date, Int)? {
        guard let a = try? fm.attributesOfItem(atPath: path), let d = a[.modificationDate] as? Date, let n = a[.size] as? NSNumber else { return nil }
        return (d, n.intValue)
    }

    func read(_ url: URL) -> JSON? {
        let path = url.standardizedFileURL.path
        guard let (d, n) = stamp(path) else { parsed[path] = nil; return nil }
        if let c = parsed[path], c.stamp == d, c.size == n { return c.obj }
        guard let data = try? Data(contentsOf: url), let o = (try? JSONSerialization.jsonObject(with: data)) as? JSON else { return nil }
        parsed[path] = (d, n, o)
        return o
    }

    @discardableResult
    func write(_ obj: JSON, to url: URL) -> Bool {
        guard let d = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]) else { return false }
        if let old = try? Data(contentsOf: url), old == d { return true }
        do {
            try d.write(to: url, options: .atomic)
            parsed[url.standardizedFileURL.path] = nil
            return true
        } catch { NSLog("write \(url.path): \(error)"); return false }
    }

    /// A Finder-safe file or folder name.
    nonisolated static func safeName(_ s: String, fallback: String) -> String {
        var t = s.replacingOccurrences(of: "/", with: "–").replacingOccurrences(of: ":", with: "–")
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        while t.hasPrefix(".") { t.removeFirst() }
        if t.count > 80 { t = String(t.prefix(80)).trimmingCharacters(in: .whitespaces) }
        return t.isEmpty ? fallback : t
    }

    /// `dir/name.ext`, or `dir/name 2.ext`… if taken by another file.
    func freeURL(in dir: URL, name: String, ext: String, keeping current: URL? = nil) -> URL {
        var n = 1
        while true {
            let base = n == 1 ? name : "\(name) \(n)"
            let u = ext.isEmpty ? dir.appendingPathComponent(base, isDirectory: true) : dir.appendingPathComponent(base).appendingPathExtension(ext)
            if u.standardizedFileURL.path == current?.standardizedFileURL.path || !fm.fileExists(atPath: u.path) { return u }
            n += 1
        }
    }

    nonisolated static func newID() -> String { UUID().uuidString.lowercased() }

    // MARK: projects

    func projects() -> [ProjectInfo] {
        var out: [ProjectInfo] = []
        func walk(_ dir: URL, _ depth: Int) {
            let c = children(of: dir)
            out += c.projects
            if depth < 8 { c.groups.forEach { walk($0, depth + 1) } }
        }
        walk(root, 0)
        return out.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    func project(_ id: String?) -> ProjectInfo? { projects().first { $0.id == id } }

    private func makeFolders(_ dir: URL) {
        for k in ItemKind.allCases { try? fm.createDirectory(at: dir.appendingPathComponent(k.folder), withIntermediateDirectories: true) }
        try? fm.createDirectory(at: dir.appendingPathComponent("Backups"), withIntermediateDirectories: true)
    }

    func createProject(named raw: String, in parent: URL? = nil) -> ProjectInfo {
        let name = Self.safeName(raw, fallback: "Untitled project")
        let dir = freeURL(in: parent ?? root, name: name, ext: "")
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        makeFolders(dir)
        let id = Self.newID()
        write(["id": id, "name": dir.lastPathComponent, "refs": [Any](), "refSort": "auto", "created": Date().timeIntervalSince1970], to: dir.appendingPathComponent("project.json"))
        let p = ProjectInfo(id: id, name: dir.lastPathComponent, url: dir)
        _ = createNotebook(in: p, title: "Notebook")
        return p
    }

    func renameProject(_ p: ProjectInfo, to raw: String) -> ProjectInfo {
        let name = Self.safeName(raw, fallback: p.name)
        let dest = freeURL(in: p.url.deletingLastPathComponent(), name: name, ext: "", keeping: p.url)
        if dest.standardizedFileURL.path != p.url.standardizedFileURL.path { try? fm.moveItem(at: p.url, to: dest) }
        let pj = dest.appendingPathComponent("project.json")
        var obj = read(pj) ?? [:]
        obj["name"] = dest.lastPathComponent
        write(obj, to: pj)
        return ProjectInfo(id: p.id, name: dest.lastPathComponent, url: dest)
    }

    /// Moves the whole project folder to the Trash (recoverable from Finder).
    func deleteProject(_ p: ProjectInfo) {
        try? fm.trashItem(at: p.url, resultingItemURL: nil)
    }

    func refs(of p: ProjectInfo) -> [JSON] { read(p.url.appendingPathComponent("project.json"))?["refs"] as? [JSON] ?? [] }

    // MARK: notebooks and essays

    func items(_ kind: ItemKind, in p: ProjectInfo) -> [DocItem] {
        let dir = p.url.appendingPathComponent(kind.folder)
        let files = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])) ?? []
        return files.filter { $0.pathExtension == "json" && $0.lastPathComponent != "papers.json" }.compactMap { u in
            guard let o = read(u), let id = o["id"] as? String else { return nil }
            let t = kind == .notebooks ? ((o["meta"] as? JSON)?["title"] as? String) : (o["title"] as? String)
            let mod = (try? u.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let title = (t ?? "").isEmpty ? kind.untitled : t!
            return DocItem(id: id, title: title, url: u, modified: mod)
        }.sorted { $0.modified > $1.modified }
    }

    func item(_ kind: ItemKind, _ id: String?, in p: ProjectInfo) -> DocItem? { items(kind, in: p).first { $0.id == id } }

    func createNotebook(in p: ProjectInfo, title: String) -> DocItem {
        let dir = p.url.appendingPathComponent(ItemKind.notebooks.folder)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let u = freeURL(in: dir, name: Self.safeName(title, fallback: "Notebook"), ext: "json")
        let id = Self.newID()
        write(["id": id, "meta": ["title": title], "pts": [Any](), "doc": NSNull()], to: u)
        return DocItem(id: id, title: title, url: u, modified: Date())
    }

    func createEssay(in p: ProjectInfo, title: String) -> DocItem {
        let dir = p.url.appendingPathComponent(ItemKind.essays.folder)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let u = freeURL(in: dir, name: Self.safeName(title, fallback: "Untitled essay"), ext: "json")
        let id = Self.newID(), now = Date().timeIntervalSince1970 * 1000
        write(["id": id, "title": title, "doc": "<p><br></p>", "created": now, "updated": now], to: u)
        return DocItem(id: id, title: title, url: u, modified: Date())
    }

    /// Keeps a notebook's or essay's file name in step with its title.
    @discardableResult
    private func fileName(_ url: URL, for title: String, fallback: String) -> URL {
        let dest = freeURL(in: url.deletingLastPathComponent(), name: Self.safeName(title, fallback: fallback), ext: "json", keeping: url)
        if dest.standardizedFileURL.path != url.standardizedFileURL.path, (try? fm.moveItem(at: url, to: dest)) != nil { return dest }
        return url
    }

    func rename(_ kind: ItemKind, _ item: DocItem, to title: String) {
        guard var o = read(item.url) else { return }
        if kind == .notebooks { var m = o["meta"] as? JSON ?? [:]; m["title"] = title; o["meta"] = m }
        else { o["title"] = title; o["updated"] = Date().timeIntervalSince1970 * 1000 }
        write(o, to: item.url)
        fileName(item.url, for: title, fallback: kind == .essays ? kind.untitled : kind.single)
    }

    func delete(_ item: DocItem) { try? fm.trashItem(at: item.url, resultingItemURL: nil) }

    /// Moves a notebook or essay to another project, taking the Works Cited entries it cites along.
    func move(_ kind: ItemKind, _ item: DocItem, from src: ProjectInfo, to dst: ProjectInfo) {
        guard read(item.url) != nil else { return }
        let dir = dst.url.appendingPathComponent(kind.folder)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = freeURL(in: dir, name: item.url.deletingPathExtension().lastPathComponent, ext: "json")
        if kind != .syllabi, let sid = read(item.url)?["syllabus"] as? String, let syl = self.item(.syllabi, sid, in: src), self.item(.syllabi, sid, in: dst) == nil {
            let sdir = dst.url.appendingPathComponent(ItemKind.syllabi.folder)
            try? fm.createDirectory(at: sdir, withIntermediateDirectories: true)
            try? fm.copyItem(at: syl.url, to: freeURL(in: sdir, name: syl.url.deletingPathExtension().lastPathComponent, ext: "json"))
        }
        // a folder belongs to the project it was in
        if var o = read(item.url), o["folder"] != nil { o["folder"] = nil; write(o, to: item.url) }
        try? fm.moveItem(at: item.url, to: dest)
    }

    nonisolated static func citedIDs(in html: String) -> Set<String> {
        var out = Set<String>()
        guard let re = try? NSRegularExpression(pattern: "data-cite=\"([^\"]*)\"") else { return out }
        for m in re.matches(in: html, range: NSRange(html.startIndex..., in: html)) {
            if let r = Range(m.range(at: 1), in: html) { html[r].split(separator: ",").forEach { out.insert(String($0)) } }
        }
        return out
    }

    func copyRefs(_ ids: Set<String>, from src: ProjectInfo, to dst: ProjectInfo) {
        guard !ids.isEmpty else { return }
        let pj = dst.url.appendingPathComponent("project.json")
        var obj = read(pj) ?? [:]
        var have = obj["refs"] as? [JSON] ?? []
        let haveIDs = Set(have.compactMap { $0["id"] as? String })
        for r in refs(of: src) {
            let id = r["id"] as? String ?? ""
            if ids.contains(id) && !haveIDs.contains(id) { have.append(r) }
        }
        obj["refs"] = have
        write(obj, to: pj)
    }

    // MARK: the notebook page's session (one project + one notebook)

    /// What the page boots with: the notebook, the project's Works Cited, and all its essays.
    func sessionJSON(_ p: ProjectInfo, notebook: DocItem?) -> String {
        let nb = notebook.flatMap { read($0.url) } ?? [:]
        let pj = read(p.url.appendingPathComponent("project.json")) ?? [:]
        // each notebook and essay has its own Works Cited; documents from before that start from the
        // project's old shared list (the notebook gets all of it, an essay the sources it cites)
        let shared = pj["refs"] as? [JSON] ?? []
        let essays = sessionEssays(p, shared: shared, sort: pj["refSort"] ?? "auto")
        let syl = (nb["syllabus"] as? String).flatMap { item(.syllabi, $0, in: p) }
        let sylObj = syl.flatMap { read($0.url) }
        let syllabi: [JSON] = items(.syllabi, in: p).map { ["id": $0.id, "title": $0.title] }
        let docs = syllabusFollowers(p, notebook: notebook)
        let s: JSON = ["meta": nb["meta"] ?? ["title": notebook?.title ?? "Notebook"], "pts": sylObj?["pts"] ?? nb["pts"] ?? [Any](), "doc": nb["doc"] ?? NSNull(),
                       "refs": nb["refs"] ?? shared, "refSort": nb["refSort"] ?? pj["refSort"] ?? "auto", "essays": essays,
                       "syllabus": syl.map { ["id": $0.id, "title": $0.title] as JSON } ?? NSNull(), "syllabi": syllabi, "docs": docs]
        guard let d = try? JSONSerialization.data(withJSONObject: s), let str = String(data: d, encoding: .utf8) else { return "null" }
        return str
    }

    /// The project's essays; one from before each had its own Works Cited gets the sources it cites from the shared list.
    private func sessionEssays(_ p: ProjectInfo, shared: [JSON], sort: Any) -> [JSON] {
        items(.essays, in: p).compactMap { read($0.url) }.map { e in
            if e["refs"] != nil { return e }
            var c = e
            let cited = Self.citedIDs(in: e["doc"] as? String ?? "")
            c["refs"] = shared.filter { cited.contains($0["id"] as? String ?? "") }
            c["refSort"] = sort
            return c
        }
    }

    /// every notebook and deck with the syllabus it follows, for Settings ▸ Syllabus (essays come with their own)
    private func syllabusFollowers(_ p: ProjectInfo, notebook: DocItem?) -> [JSON] {
        [ItemKind.notebooks, .decks].flatMap { k in items(k, in: p).map { it -> JSON in
            ["kind": k.rawValue, "id": it.id, "title": it.title, "syllabus": read(it.url)?["syllabus"] as? String ?? NSNull(),
             "current": k == .notebooks && it.id == notebook?.id] } }
    }

    /// Splits what the page saved back into the notebook file, project.json and the essay files.
    @discardableResult
    func saveSession(_ json: String, _ p: ProjectInfo, notebook: DocItem?) -> Bool {
        guard let d = json.data(using: .utf8), let obj = (try? JSONSerialization.jsonObject(with: d)) as? JSON else { return false }
        var ok = true
        if let nbItem = notebook, let cur = item(.notebooks, nbItem.id, in: p) { ok = saveNotebook(obj, to: cur, in: p) && ok }
        if let essays = obj["essays"] as? [JSON] { ok = saveEssays(essays, in: p) && ok }
        return ok
    }

    /// The notebook's file; its points (with their ratings) live in the linked syllabus.
    private func saveNotebook(_ obj: JSON, to cur: DocItem, in p: ProjectInfo) -> Bool {
        var ok = true
        backupIfDue(cur, in: p)
        var nb = read(cur.url) ?? ["id": cur.id]
        for k in ["meta", "doc", "refs", "refSort"] { nb[k] = obj[k] ?? NSNull() }
        let pts = obj["pts"] as? [Any] ?? []
        if let sid = syllabusID(for: obj, notebook: &nb, points: pts, in: p), let syl = item(.syllabi, sid, in: p), var so = read(syl.url) {
            so["pts"] = pts; ok = write(so, to: syl.url) && ok
        }
        nb["pts"] = nil
        ok = write(nb, to: cur.url) && ok
        fileName(cur.url, for: (obj["meta"] as? JSON)?["title"] as? String ?? "", fallback: "Notebook")
        return ok
    }

    /// The syllabus the notebook follows; points made in a notebook with none start one.
    private func syllabusID(for obj: JSON, notebook nb: inout JSON, points pts: [Any], in p: ProjectInfo) -> String? {
        var sid = nb["syllabus"] as? String
        if sid == nil && !pts.isEmpty {
            let t = ((obj["meta"] as? JSON)?["title"] as? String).map { $0.isEmpty ? "Syllabus" : $0 } ?? "Syllabus"
            sid = createSyllabus(in: p, title: t).id; nb["syllabus"] = sid
        }
        return sid
    }

    /// Each essay to its file (named after its title); essays deleted in the page go to the Trash.
    private func saveEssays(_ essays: [JSON], in p: ProjectInfo) -> Bool {
        var ok = true
        var existing: [String: URL] = [:]
        for e in items(.essays, in: p) { existing[e.id] = e.url }
        let dir = p.url.appendingPathComponent(ItemKind.essays.folder)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        var seen = Set<String>()
        for e in essays {
            guard let id = e["id"] as? String else { continue }
            seen.insert(id)
            let title = e["title"] as? String ?? ""
            let u = existing[id] ?? freeURL(in: dir, name: Self.safeName(title, fallback: "Untitled essay"), ext: "json")
            ok = write(e, to: u) && ok
            fileName(u, for: title, fallback: "Untitled essay")
        }
        for (id, u) in existing where !seen.contains(id) { try? fm.trashItem(at: u, resultingItemURL: nil) }
        return ok
    }

    /// a notebook is copied to Backups at most this often (seconds) while it's being saved…
    static let backupInterval: TimeInterval = 3600
    /// …and this many of its newest copies are kept
    static let backupsKept = 48

    private func backupIfDue(_ nb: DocItem, in p: ProjectInfo) {
        guard Date().timeIntervalSince(lastBackup[nb.id] ?? .distantPast) > Self.backupInterval, fm.fileExists(atPath: nb.url.path) else { return }
        let dir = p.url.appendingPathComponent("Backups")
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd_HHmm"
        let name = Self.safeName(nb.url.deletingPathExtension().lastPathComponent, fallback: "notebook")
        try? fm.copyItem(at: nb.url, to: dir.appendingPathComponent("\(name) \(f.string(from: Date())).json"))
        lastBackup[nb.id] = Date()
        // the newest 48 hourly copies of this notebook stay; other notebooks' copies and one-off backups are left alone
        let mine = "^" + NSRegularExpression.escapedPattern(for: name) + #" \d{4}-\d{2}-\d{2}_\d{4}\.json$"#
        let copies = ((try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.lastPathComponent.range(of: mine, options: .regularExpression) != nil }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
        for old in copies.dropFirst(Self.backupsKept) { try? fm.removeItem(at: old) }
    }

    // MARK: one Works Cited per document

    /// Projects used to share one Works Cited (in project.json). Every notebook now gets a copy of it,
    /// and every essay the sources it cites. project.json keeps the old list untouched.
    private func migrateToOwnLists() {
        for p in projects() {
            let pj = read(p.url.appendingPathComponent("project.json")) ?? [:]
            let shared = pj["refs"] as? [JSON] ?? []
            let sort = pj["refSort"] ?? "auto"
            for nb in items(.notebooks, in: p) {
                guard var o = read(nb.url), o["refs"] == nil else { continue }
                o["refs"] = shared; o["refSort"] = sort
                write(o, to: nb.url)
            }
            for e in items(.essays, in: p) {
                guard var o = read(e.url), o["refs"] == nil else { continue }
                let cited = Self.citedIDs(in: o["doc"] as? String ?? "")
                o["refs"] = shared.filter { cited.contains($0["id"] as? String ?? "") }; o["refSort"] = sort
                write(o, to: e.url)
            }
        }
    }

    // MARK: moving the single-notebook library into its first project

    /// Before projects, ~/Documents/Apatite held notebook.json, library.json, PDFs/ and Backups/.
    /// That becomes the "Machine Learning" project; the original files are kept in "Old layout backup".
    private func migrateSingleNotebook() {
        let oldNB = root.appendingPathComponent("notebook.json")
        guard fm.fileExists(atPath: oldNB.path), projects().isEmpty, let nb = read(oldNB) else { return }
        let dir = freeURL(in: root, name: "Machine Learning", ext: "")
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        makeFolders(dir)
        write(["id": Self.newID(), "name": dir.lastPathComponent, "refs": nb["refs"] ?? [Any](), "refSort": nb["refSort"] ?? "auto",
               "created": Date().timeIntervalSince1970], to: dir.appendingPathComponent("project.json"))
        let title = (nb["meta"] as? JSON)?["title"] as? String ?? "Notebook"
        write(["id": Self.newID(), "meta": nb["meta"] ?? ["title": title], "pts": nb["pts"] ?? [Any](), "doc": nb["doc"] ?? NSNull()],
              to: dir.appendingPathComponent("Notebooks").appendingPathComponent(Self.safeName(title, fallback: "Notebook")).appendingPathExtension("json"))
        for e in nb["essays"] as? [JSON] ?? [] {
            let u = freeURL(in: dir.appendingPathComponent("Essays"), name: Self.safeName(e["title"] as? String ?? "", fallback: "Untitled essay"), ext: "json")
            write(e, to: u)
        }
        copyOldPapers(to: dir.appendingPathComponent("Papers"))
        keepOldLayout()
    }

    /// PDFs are copied; the originals stay in the backup folder until you delete it
    private func copyOldPapers(to papers: URL) {
        for f in (try? fm.contentsOfDirectory(at: root.appendingPathComponent("PDFs"), includingPropertiesForKeys: nil)) ?? [] where f.pathExtension.lowercased() == "pdf" {
            try? fm.copyItem(at: f, to: papers.appendingPathComponent(f.lastPathComponent))
        }
        if let lib = try? Data(contentsOf: root.appendingPathComponent("library.json")) { try? lib.write(to: papers.appendingPathComponent("papers.json")) }
    }

    /// keep everything that was there, untouched, in one folder
    private func keepOldLayout() {
        let keep = freeURL(in: root, name: "Old layout backup", ext: "")
        try? fm.createDirectory(at: keep, withIntermediateDirectories: true)
        for n in ["notebook.json", "library.json", "PDFs", "Backups"] {
            let u = root.appendingPathComponent(n)
            if fm.fileExists(atPath: u.path) { try? fm.moveItem(at: u, to: keep.appendingPathComponent(n)) }
        }
    }
}
