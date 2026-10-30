import Foundation

/// Libraries written by older versions of the app are brought up to date when the workspace opens. Each step only
/// acts on files that are still in the old shape, so a library that is already current is left exactly as it is.
extension Workspace {
    /// every step, oldest layout first
    func migrateLibrary() {
        migrateSingleNotebook()
        migrateToOwnLists()
        for p in projects() { migrateSyllabi(p) }
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
