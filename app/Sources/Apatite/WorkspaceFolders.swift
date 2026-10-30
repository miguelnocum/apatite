import Foundation

/// A folder inside a project (kept in project.json): it can hold notebooks, essays, papers and syllabi together.
struct ProjectFolder: Identifiable, Hashable {
    let id: String
    var name: String
    var parent: String?
}

extension Workspace {
    // MARK: folders around projects (real Finder folders)

    /// A plain folder counts as a group of projects when it holds nothing but folders.
    func isGroup(_ dir: URL) -> Bool {
        guard (try? dir.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
              !fm.fileExists(atPath: dir.appendingPathComponent("project.json").path) else { return false }
        let kids = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])) ?? []
        return kids.allSatisfy { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
    }

    func children(of dir: URL) -> (groups: [URL], projects: [ProjectInfo]) {
        let dirs = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])) ?? []
        var groups: [URL] = [], projects: [ProjectInfo] = []
        for d in dirs {
            if let p = read(d.appendingPathComponent("project.json")), let id = p["id"] as? String {
                projects.append(ProjectInfo(id: id, name: p["name"] as? String ?? d.lastPathComponent, url: d))
            } else if isGroup(d) { groups.append(d) }
        }
        let byName: (String, String) -> Bool = { $0.localizedStandardCompare($1) == .orderedAscending }
        return (groups.sorted { byName($0.lastPathComponent, $1.lastPathComponent) }, projects.sorted { byName($0.name, $1.name) })
    }

    func createGroup(named raw: String, in parent: URL) -> URL {
        let u = freeURL(in: parent, name: Self.safeName(raw, fallback: "New folder"), ext: "")
        try? fm.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    func renameGroup(_ dir: URL, to raw: String) -> URL {
        let dest = freeURL(in: dir.deletingLastPathComponent(), name: Self.safeName(raw, fallback: dir.lastPathComponent), ext: "", keeping: dir)
        if dest.standardizedFileURL.path != dir.standardizedFileURL.path { try? fm.moveItem(at: dir, to: dest) }
        return dest
    }

    /// Moves a project or a folder of projects into another folder (or the library's top level).
    @discardableResult
    func moveDir(_ dir: URL, into parent: URL) -> URL? {
        let a = dir.standardizedFileURL.path, b = parent.standardizedFileURL.path
        guard a != b, !b.hasPrefix(a + "/"), dir.deletingLastPathComponent().standardizedFileURL.path != b else { return nil }
        let dest = freeURL(in: parent, name: dir.lastPathComponent, ext: "")
        do { try fm.moveItem(at: dir, to: dest); return dest } catch { return nil }
    }

    func trash(_ url: URL) { try? fm.trashItem(at: url, resultingItemURL: nil) }

    // MARK: folders inside a project (listed in project.json)

    func folders(in p: ProjectInfo) -> [ProjectFolder] {
        let pj = read(p.url.appendingPathComponent("project.json")) ?? [:]
        return (pj["folders"] as? [JSON] ?? []).compactMap { f in
            guard let id = f["id"] as? String else { return nil }
            return ProjectFolder(id: id, name: f["name"] as? String ?? "Folder", parent: f["parent"] as? String)
        }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private func saveFolders(_ list: [ProjectFolder], in p: ProjectInfo) {
        let u = p.url.appendingPathComponent("project.json")
        var pj = read(u) ?? [:]
        pj["folders"] = list.map { f -> JSON in var o: JSON = ["id": f.id, "name": f.name]; if let pa = f.parent { o["parent"] = pa }; return o }
        write(pj, to: u)
    }

    func createFolder(named name: String, parent: String?, in p: ProjectInfo) -> ProjectFolder {
        let f = ProjectFolder(id: Self.newID(), name: name.isEmpty ? "New folder" : name, parent: parent)
        saveFolders(folders(in: p) + [f], in: p)
        return f
    }

    func renameFolder(_ id: String, to name: String, in p: ProjectInfo) {
        saveFolders(folders(in: p).map { var f = $0; if f.id == id { f.name = name }; return f }, in: p)
    }

    /// Deleting a folder keeps what was in it: its contents move up to its parent.
    func deleteFolder(_ id: String, in p: ProjectInfo) {
        let all = folders(in: p)
        guard let f = all.first(where: { $0.id == id }) else { return }
        saveFolders(all.filter { $0.id != id }.map { var x = $0; if x.parent == id { x.parent = f.parent }; return x }, in: p)
        for k in [ItemKind.notebooks, .essays, .syllabi, .decks] {
            for it in items(k, in: p) where folderOf(k, it.id, in: p) == id { setFolder(k, it.id, f.parent, in: p) }
        }
        let lib = Library(project: p.url)
        lib.saveItems(lib.loadItems().map { var x = $0; if x.folder == id { x.folder = f.parent }; return x })
    }

    /// Moves a folder under another (never into itself or its own sub-folders).
    func moveFolder(_ id: String, to parent: String?, in p: ProjectInfo) {
        let all = folders(in: p)
        var cur = parent
        while let c = cur { if c == id { return }; cur = all.first { $0.id == c }?.parent }
        saveFolders(all.map { var f = $0; if f.id == id { f.parent = parent }; return f }, in: p)
    }

    func folderOf(_ k: ItemKind, _ id: String, in p: ProjectInfo) -> String? {
        if k == .papers { return Library(project: p.url).loadItems().first { $0.id == id }?.folder }
        return item(k, id, in: p).flatMap { read($0.url)?["folder"] as? String }
    }

    func setFolder(_ k: ItemKind, _ id: String, _ folder: String?, in p: ProjectInfo) {
        if k == .papers {
            let lib = Library(project: p.url)
            lib.saveItems(lib.loadItems().map { var x = $0; if x.id == id { x.folder = folder }; return x })
            return
        }
        guard let it = item(k, id, in: p), var o = read(it.url) else { return }
        o["folder"] = folder
        write(o, to: it.url)
    }

    // MARK: syllabi

    func createSyllabus(in p: ProjectInfo, title: String, pts: [Any] = [], folder: String? = nil) -> DocItem {
        let dir = p.url.appendingPathComponent(ItemKind.syllabi.folder)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let u = freeURL(in: dir, name: Self.safeName(title, fallback: "Syllabus"), ext: "json")
        let id = Self.newID()
        var o: JSON = ["id": id, "title": title, "pts": pts]
        if let folder { o["folder"] = folder }
        write(o, to: u)
        return DocItem(id: id, title: title, url: u, modified: Date())
    }

    /// The syllabus a notebook or essay links to (nil: none).
    func syllabusOf(_ k: ItemKind, _ id: String, in p: ProjectInfo) -> String? {
        item(k, id, in: p).flatMap { read($0.url)?["syllabus"] as? String }
    }

    func linkSyllabus(_ k: ItemKind, _ id: String, to sid: String?, in p: ProjectInfo) {
        guard let it = item(k, id, in: p), var o = read(it.url) else { return }
        o["syllabus"] = sid
        write(o, to: it.url)
    }

    /// Notebooks and essays linked to a syllabus.
    func users(of sid: String, in p: ProjectInfo) -> [(ItemKind, DocItem)] {
        [ItemKind.notebooks, .essays, .decks].flatMap { k in items(k, in: p).filter { read($0.url)?["syllabus"] as? String == sid }.map { (k, $0) } }
    }

    /// Notebooks used to carry their syllabus inside them. Each becomes a syllabus of its own, linked back;
    /// notebooks with the very same points share one, their ratings combined and their notes' tags pointed at it.
    func migrateSyllabi(_ p: ProjectInfo) {
        let nbs = notebooksWithOwnPoints(p)
        guard !nbs.isEmpty else { return }
        let backups = p.url.appendingPathComponent("Backups")
        try? fm.createDirectory(at: backups, withIntermediateDirectories: true)
        var made: [(sig: String, sid: String, url: URL)] = []
        for (it, o) in nbs { migrateNotebook(it, o, backups: backups, made: &made, in: p) }
    }

    /// one notebook: backed up, then linked to a new syllabus with its points (or one already made with the same)
    private func migrateNotebook(_ it: DocItem, _ notebook: JSON, backups: URL, made: inout [(sig: String, sid: String, url: URL)], in p: ProjectInfo) {
        var o = notebook
        try? fm.copyItem(at: it.url, to: freeURL(in: backups, name: it.url.deletingPathExtension().lastPathComponent + " (before syllabi)", ext: "json"))
        let pts = o["pts"] as? [JSON] ?? []
        let sig = Self.pointsSignature(pts)
        var doc = o["doc"] as? String ?? ""
        if let i = made.firstIndex(where: { $0.sig == sig }), let so = read(made[i].url) {
            doc = shareSyllabus(so, at: made[i].url, with: pts, doc: doc)
            o["syllabus"] = made[i].sid
        } else {
            let syl = syllabusFromNotebook(o, pts: pts, in: p)
            made.append((sig, syl.id, syl.url))
            o["syllabus"] = syl.id
        }
        o["doc"] = doc.isEmpty ? o["doc"] : doc
        o["pts"] = nil
        write(o, to: it.url)
    }

    /// a new syllabus named after the notebook, with its points
    private func syllabusFromNotebook(_ o: JSON, pts: [JSON], in p: ProjectInfo) -> DocItem {
        let t = ((o["meta"] as? JSON)?["title"] as? String).map { $0.isEmpty ? "Syllabus" : $0 } ?? "Syllabus"
        return createSyllabus(in: p, title: t, pts: pts, folder: o["folder"] as? String)
    }

    /// notebooks that still carry their own points
    private func notebooksWithOwnPoints(_ p: ProjectInfo) -> [(DocItem, JSON)] {
        items(.notebooks, in: p).compactMap { it -> (DocItem, JSON)? in
            guard let o = read(it.url), o["syllabus"] == nil, let pts = o["pts"] as? [JSON], !pts.isEmpty else { return nil }
            return (it, o)
        }
    }

    /// the same list of points, in the same order, has the same signature
    private static func pointsSignature(_ pts: [JSON]) -> String {
        pts.map { x in [x["sec"] as? String ?? "", x["code"] as? String ?? "", x["text"] as? String ?? ""].joined(separator: "\u{1}") }
            .joined(separator: "\u{2}")
    }

    /// same points as one already moved (the same list, in the same order): share it, keep the higher rating, and
    /// retag this notebook's notes (returned)
    private func shareSyllabus(_ syllabus: JSON, at url: URL, with pts: [JSON], doc: String) -> String {
        var so = syllabus
        var doc = doc
        var shared = so["pts"] as? [JSON] ?? []
        for (j, x) in pts.enumerated() where j < shared.count {
            guard let old = x["id"] as? String, let new = shared[j]["id"] as? String else { continue }
            shared[j]["status"] = max(shared[j]["status"] as? Int ?? 0, x["status"] as? Int ?? 0)
            if old != new { doc = doc.replacingOccurrences(of: "data-sp=\"\(old)\"", with: "data-sp=\"\(new)\"").replacingOccurrences(of: "data-pt=\"\(old)\"", with: "data-pt=\"\(new)\"") }
        }
        so["pts"] = shared; write(so, to: url)
        return doc
    }
}
