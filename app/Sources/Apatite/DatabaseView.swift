import SwiftUI
import PDFKit
import UniformTypeIdentifiers

/// One notebook, essay or paper, wherever it lives.
struct DBRow: Identifiable, Hashable {
    let kind: ItemKind
    let itemID: String
    let title: String
    let date: Date?
    let project: ProjectInfo
    var folder: String? = nil
    var id: String { "\(kind.rawValue)|\(project.id)|\(itemID)" }
    /// What a drag carries.
    var payload: String { id }
}

/// Plain text out of the notebook page's HTML.
func plainText(_ html: String) -> String {
    var t = html.replacingOccurrences(of: "<(br|/p|/h[1-6]|/li|/div)[^>]*>", with: "\n", options: .regularExpression)
    t = t.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
    for (a, b) in [("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'")] { t = t.replacingOccurrences(of: a, with: b) }
    return t.replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
}

func wordCount(_ s: String) -> Int { s.split { $0.isWhitespace || $0.isNewline }.count }

@MainActor
struct DatabaseView: View {
    @EnvironmentObject var s: AppState
    /// The containers opened, left to right: "g:<folder path>", "p:<project id>", "f:<project id>:<folder id>".
    @State private var path: [String] = []
    @State private var rowID: String?
    @State private var query = ""
    @State private var renaming: Target?
    @State private var newName = ""
    @State private var deleting: Target?
    @State private var dropTarget: String?

    /// Something to rename or delete: a container key or an item row.
    struct Target: Identifiable { let id = UUID(); let key: String; let title: String; let row: DBRow? }

    private var ws: Workspace { s.workspace }

    /// One line in a column.
    struct Entry: Identifiable {
        let id: String          // container key, or the row's id
        let title: String
        let icon: String
        let detail: String?
        let container: Bool
        var row: DBRow? = nil
    }

    var body: some View {
        let _ = s.revision
        dialogs(VStack(spacing: 0) {
            header
            Divider()
            if !query.trimmingCharacters(in: .whitespaces).isEmpty { searchResults } else { columns }
        }
        .background(s.themeBG)
        .onAppear { if path.isEmpty { path = initialPath() } })
    }

    /// renaming and deleting ask first
    private func dialogs<Content: View>(_ content: Content) -> some View {
        content
            .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }), presenting: renaming) { r in
                TextField("Name", text: $newName)
                Button("Rename") { rename(r) }
                Button("Cancel", role: .cancel) {}
            }
            .confirmationDialog(deleting.map { deleteTitle($0) } ?? "", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { d in
                Button(d.key.hasPrefix("f:") ? "Delete folder" : "Move to Trash", role: .destructive) { delete(d) }
                Button("Cancel", role: .cancel) {}
            } message: { d in
                Text(deleteMessage(d))
            }
    }

    /// "Database" and the search field
    private var header: some View {
        HStack(spacing: 12) {
            Text("Database").font(.system(size: 22, weight: .bold, design: .rounded))
            Spacer()
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search all projects", text: $query).textFieldStyle(.plain).frame(width: 240)
                if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.secondary) }
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 8).fill(s.themePanel))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(nsColor: .separatorColor)))
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
    }

    /// what the search finds, across every project, beside a preview
    private var searchResults: some View {
        let results = search(ws.projects())
        return HStack(spacing: 0) {
            List(selection: $rowID) {
                Section("\(results.count) found") {
                    ForEach(results) { r in searchRow(r).tag(r.id) }
                }
            }
            .contextMenu(forSelectionType: String.self) { _ in } primaryAction: { ids in
                if let id = ids.first, let r = results.first(where: { $0.id == id }) { open(r) }
            }
            .frame(width: 420)
            Divider()
            PreviewPane(row: results.first { $0.id == rowID }, open: open)
        }
    }

    private func searchRow(_ r: DBRow) -> some View {
        HStack(spacing: 8) {
            Image(systemName: r.kind.icon).foregroundStyle(.secondary).frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(r.title).lineLimit(1)
                Text("\(r.project.name) · \(r.kind.single)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    /// the library's columns, one per container opened, beside a preview of the item selected
    private var columns: some View {
        let keys = [""] + path   // "" is the library's top level
        let cols = keys.map { entries(of: $0) }
        let selectedRow = rowID.flatMap { id in cols.last?.first { $0.id == id }?.row }
        return HStack(spacing: 0) {
            columnStrip(keys, cols)
            PreviewPane(row: selectedRow, open: open)
                .frame(minWidth: 300)
        }
    }

    /// the columns side by side, scrolled to keep the newest in view
    private func columnStrip(_ keys: [String], _ cols: [[Entry]]) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: true) {
                HStack(spacing: 0) {
                    ForEach(Array(keys.enumerated()), id: \.offset) { i, key in
                        column(key, cols[i], selected: i < path.count ? path[i] : rowID, depth: i)
                            .frame(width: i == 0 ? 240 : 260).id(i)
                        Divider()
                    }
                }
            }
            .onChange(of: path) { _, p in withAnimation { proxy.scrollTo(p.count, anchor: .trailing) } }
        }
        .frame(maxWidth: CGFloat(240 + 261 * path.count + 1))
    }

    private func deleteMessage(_ d: Target) -> String {
        d.key.hasPrefix("f:") ? "What's inside stays in the project: it moves up a level."
            : d.key.hasPrefix("g:") ? "The folder and every project in it go to the Trash. You can put them back from there."
            : d.key.hasPrefix("p:") ? "The whole project folder, with its notebooks, essays, papers and syllabi, goes to the Trash. You can put it back from there."
            : "It goes to the Trash. You can put it back from there."
    }

    private func deleteTitle(_ d: Target) -> String { d.key.hasPrefix("f:") ? "Delete the folder “\(d.title)”?" : "Move “\(d.title)” to the Trash?" }

    /// Opens the Database where you are: the current project, inside the folders that hold it.
    private func initialPath() -> [String] {
        var out: [String] = []
        var dir = s.project.url.deletingLastPathComponent()
        while dir.standardizedFileURL.path.count > ws.root.standardizedFileURL.path.count && dir.standardizedFileURL.path.hasPrefix(ws.root.standardizedFileURL.path) {
            out.insert("g:" + dir.path, at: 0); dir = dir.deletingLastPathComponent()
        }
        return out + ["p:" + s.project.id]
    }

    // MARK: what a container holds

    private func project(of key: String) -> ProjectInfo? {
        let parts = key.split(separator: ":", maxSplits: 2).map(String.init)
        guard parts.count >= 2, parts[0] == "p" || parts[0] == "f" else { return nil }
        return ws.project(parts[1])
    }

    private func entries(of key: String) -> [Entry] {
        if key.isEmpty || key.hasPrefix("g:") {
            let dir = key.isEmpty ? ws.root : URL(fileURLWithPath: String(key.dropFirst(2)), isDirectory: true)
            let c = ws.children(of: dir)
            return c.groups.map { Entry(id: "g:" + $0.path, title: $0.lastPathComponent, icon: "folder", detail: nil, container: true) }
                 + c.projects.map { Entry(id: "p:" + $0.id, title: $0.name, icon: $0.id == s.project.id ? "shippingbox.fill" : "shippingbox", detail: nil, container: true) }
        }
        guard let p = project(of: key) else { return [] }
        let fid: String? = folderID(of: key)
        let folders = ws.folders(in: p).filter { $0.parent == fid }
        let order: [ItemKind] = [.syllabi, .notebooks, .essays, .decks, .papers]
        let rows = order.flatMap { k in rowsFor(k, p).filter { $0.folder == fid } }
        return folders.map { Entry(id: "f:\(p.id):\($0.id)", title: $0.name, icon: "folder", detail: nil, container: true) }
             + rows.map { Entry(id: $0.id, title: $0.title, icon: $0.kind.icon, detail: $0.kind.single, container: false, row: $0) }
    }

    /// the folder a "f:<project id>:<folder id>" key names
    private func folderID(of key: String) -> String? {
        key.hasPrefix("f:") ? String(key.split(separator: ":", maxSplits: 2)[2]) : nil
    }

    private func title(of key: String) -> String {
        if key.isEmpty { return "Library" }
        if key.hasPrefix("g:") { return URL(fileURLWithPath: String(key.dropFirst(2))).lastPathComponent }
        if key.hasPrefix("p:") { return project(of: key)?.name ?? "Project" }
        if let p = project(of: key) { let fid = folderID(of: key) ?? ""; return ws.folders(in: p).first { $0.id == fid }?.name ?? "Folder" }
        return ""
    }

    // MARK: a column

    private func column(_ key: String, _ list: [Entry], selected: String?, depth: Int) -> some View {
        VStack(spacing: 0) {
            List(selection: Binding(get: { selected }, set: { pick($0, depth: depth, in: list) })) {
                Section(title(of: key)) {
                    if list.isEmpty {
                        Text(key.isEmpty || key.hasPrefix("g:") ? "Empty folder" : "Nothing here yet").foregroundStyle(.secondary)
                    }
                    ForEach(list) { e in entryRow(e).tag(e.id) }
                }
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let e = list.first(where: { $0.id == ids.first }) { menu(for: e, in: key) }
            } primaryAction: { ids in
                if let e = list.first(where: { $0.id == ids.first }), let r = e.row { open(r) }
            }
            .dropDestination(for: String.self) { payloads, _ in drop(payloads, into: key) }
            footer(key)
        }
    }

    /// a line of a column: dragged to move it; a container takes drops
    private func entryRow(_ e: Entry) -> some View {
        HStack(spacing: 8) {
            Image(systemName: e.icon).foregroundStyle(e.container ? Color.accentColor : .secondary).frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(e.title).lineLimit(2)
                if let r = e.row, let d = r.date { Text("\(r.kind.single) · \(d.formatted(.relative(presentation: .named)))").font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 4)
            if e.container { Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary) }
        }
        .padding(.vertical, 2)
        .background(RoundedRectangle(cornerRadius: 5).stroke(Color.accentColor, lineWidth: dropTarget == e.id ? 2 : 0))
        .draggable(e.id)
        .modifier(DropInto(enabled: e.container, key: e.id, target: $dropTarget) { payloads in drop(payloads, into: e.id) })
    }

    private func pick(_ id: String?, depth: Int, in list: [Entry]) {
        guard let id else { return }
        if let e = list.first(where: { $0.id == id }), e.container {
            path = Array(path.prefix(depth)) + [id]; rowID = nil
        } else {
            path = Array(path.prefix(depth)); rowID = id
        }
    }

    @ViewBuilder private func menu(for e: Entry, in key: String) -> some View {
        if let r = e.row { itemMenu(r) } else { containerMenu(e, in: key) }
    }

    @ViewBuilder private func itemMenu(_ r: DBRow) -> some View {
        Button("Open") { open(r) }
        Button("Rename…") { newName = r.title; renaming = Target(key: r.id, title: r.title, row: r) }
        if r.kind == .notebooks || r.kind == .essays { syllabusMenu(r) }
        Menu("Move to") { moveTargets(r) }
        Divider()
        Button("Move to Trash…", role: .destructive) { deleting = Target(key: r.id, title: r.title, row: r) }
    }

    /// which syllabus a notebook or essay follows, ticked
    private func syllabusMenu(_ r: DBRow) -> some View {
        let syl = ws.syllabusOf(r.kind, r.itemID, in: r.project)
        return Menu("Syllabus") {
            Button { link(r, nil) } label: { if syl == nil { Label("None", systemImage: "checkmark") } else { Text("None") } }
            Divider()
            ForEach(ws.items(.syllabi, in: r.project), id: \.id) { sy in
                Button { link(r, sy.id) } label: { if syl == sy.id { Label(sy.title, systemImage: "checkmark") } else { Text(sy.title) } }
            }
        }
    }

    @ViewBuilder private func containerMenu(_ e: Entry, in key: String) -> some View {
        Button("Open") { pick(e.id, depth: (key.isEmpty ? 0 : (path.firstIndex(of: key) ?? 0) + 1), in: [e]) }
        Button("Rename…") { newName = e.title; renaming = Target(key: e.id, title: e.title, row: nil) }
        Divider()
        Button(e.id.hasPrefix("f:") ? "Delete folder…" : "Move to Trash…", role: .destructive) { deleting = Target(key: e.id, title: e.title, row: nil) }
    }

    /// Folders of the item's own project, then other projects.
    @ViewBuilder private func moveTargets(_ r: DBRow) -> some View {
        Button("\(r.project.name) (top level)") { drop([r.id], into: "p:" + r.project.id) }
        ForEach(ws.folders(in: r.project)) { f in Button("\(r.project.name) › \(folderPath(f, in: r.project))") { drop([r.id], into: "f:\(r.project.id):\(f.id)") } }
        Divider()
        ForEach(ws.projects().filter { $0.id != r.project.id }) { p in Button(p.name) { drop([r.id], into: "p:" + p.id) } }
    }

    private func folderPath(_ f: ProjectFolder, in p: ProjectInfo) -> String {
        let all = ws.folders(in: p); var names = [f.name]; var cur = f.parent
        while let c = cur, let pf = all.first(where: { $0.id == c }) { names.insert(pf.name, at: 0); cur = pf.parent }
        return names.joined(separator: " › ")
    }

    @ViewBuilder private func footer(_ key: String) -> some View {
        VStack(spacing: 0) {
            Divider()
            HStack {
                Menu {
                    if key.isEmpty || key.hasPrefix("g:") {
                        Button { newGroup(in: key) } label: { Label("New folder", systemImage: "folder.badge.plus") }
                        Button { addProject(in: key) } label: { Label("New project", systemImage: "shippingbox") }
                    } else if let p = project(of: key) {
                        newInProject(p, folder: folderID(of: key))
                    }
                } label: { Label("New", systemImage: "plus") }
                .menuStyle(.borderlessButton).fixedSize()
                Spacer()
            }.padding(.horizontal, 12).padding(.vertical, 8)
        }
    }

    /// what can be made (or brought in) in a project or one of its folders
    @ViewBuilder private func newInProject(_ p: ProjectInfo, folder fid: String?) -> some View {
        Button { add(.notebooks, in: p, folder: fid) } label: { Label("New notebook", systemImage: ItemKind.notebooks.icon) }
        Button { add(.essays, in: p, folder: fid) } label: { Label("New essay", systemImage: ItemKind.essays.icon) }
        Button { add(.syllabi, in: p, folder: fid) } label: { Label("New syllabus", systemImage: ItemKind.syllabi.icon) }
        Button { add(.decks, in: p, folder: fid) } label: { Label("New deck", systemImage: ItemKind.decks.icon) }
        Button { add(.papers, in: p, folder: fid) } label: { Label("Import PDFs…", systemImage: ItemKind.papers.icon) }
        Divider()
        Button { s.importEssays(into: p) } label: { Label("Import Word or PDF essay…", systemImage: "square.and.arrow.down") }
        Button { s.importFolder(into: p) } label: { Label("Import a folder of papers…", systemImage: "tray.and.arrow.down") }
        Divider()
        Button { newFolder(in: p, parent: fid) } label: { Label("New folder", systemImage: "folder.badge.plus") }
    }

    // MARK: data

    private func rowsFor(_ k: ItemKind, _ p: ProjectInfo) -> [DBRow] { rowsWithText(k, p).map(\.row) }

    /// Each row, and the text a search looks through: notes, essays, syllabus points, cards and highlights.
    private func rowsWithText(_ k: ItemKind, _ p: ProjectInfo, text: Bool = false) -> [(row: DBRow, text: String)] {
        func join(_ list: Any?, _ a: String, _ b: String) -> String {
            ((list as? [JSON]) ?? []).map { ($0[a] as? String ?? "") + " " + ($0[b] as? String ?? "") }.joined(separator: " ")
        }
        switch k {
        case .notebooks, .essays, .syllabi, .decks:
            return ws.items(k, in: p).map { it in
                let o = ws.read(it.url)
                let body = !text ? "" : k == .syllabi ? join(o?["pts"], "code", "text") : k == .decks ? join(o?["cards"], "term", "def") : plainText(o?["doc"] as? String ?? "")
                return (DBRow(kind: k, itemID: it.id, title: it.title, date: it.modified, project: p, folder: o?["folder"] as? String), body)
            }
        case .papers:
            let lib = Library(project: p.url)
            return lib.loadItems().map { it in
                let mod = try? lib.url(for: it).resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
                return (DBRow(kind: .papers, itemID: it.id, title: it.title, date: mod, project: p, folder: it.folder), text ? it.highlights.map(\.text).joined(separator: " ") : "")
            }
        }
    }

    private func search(_ projects: [ProjectInfo]) -> [DBRow] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return projects.flatMap { p in
            ItemKind.allCases.flatMap { k in
                rowsWithText(k, p, text: true).filter { $0.row.title.lowercased().contains(q) || $0.text.lowercased().contains(q) }.map(\.row)
            }
        }
    }

    // MARK: actions

    private func open(_ r: DBRow) {
        switch r.kind {
        case .notebooks: s.openNotebook(r.project, r.itemID)
        case .essays: s.openEssay(r.project, r.itemID)
        case .papers: s.openPaper(r.project, r.itemID)
        case .syllabi: s.openSyllabus(r.project, r.itemID)
        case .decks: s.openDeck(r.project, r.itemID)
        }
    }

    private func dir(of key: String) -> URL { key.hasPrefix("g:") ? URL(fileURLWithPath: String(key.dropFirst(2)), isDirectory: true) : ws.root }

    private func newGroup(in key: String) {
        var made: URL?
        s.change([]) { made = ws.createGroup(named: "New folder", in: dir(of: key)) } then: {
            guard let u = made else { return }
            newName = u.lastPathComponent; renaming = Target(key: "g:" + u.path, title: u.lastPathComponent, row: nil)
        }
    }

    private func addProject(in key: String) {
        var made: ProjectInfo?
        s.change([]) { made = ws.createProject(named: "Untitled project", in: dir(of: key)) } then: {
            guard let p = made else { return }
            let depth = key.isEmpty ? 0 : (path.firstIndex(of: key) ?? -1) + 1
            path = Array(path.prefix(depth)) + ["p:" + p.id]
            newName = p.name; renaming = Target(key: "p:" + p.id, title: p.name, row: nil)
        }
    }

    private func newFolder(in p: ProjectInfo, parent: String?) {
        var made: ProjectFolder?
        s.change([]) { made = ws.createFolder(named: "New folder", parent: parent, in: p) } then: {
            guard let f = made else { return }
            newName = f.name; renaming = Target(key: "f:\(p.id):\(f.id)", title: f.name, row: nil)
        }
    }

    private func add(_ k: ItemKind, in p: ProjectInfo, folder: String?) {
        switch k {
        case .decks:
            var made: DocItem?
            s.change([p]) { made = ws.createDeck(in: p, title: "Untitled deck", folder: folder) } then: { if let d = made { s.openDeck(p, d.id) } }
        case .notebooks, .essays, .syllabi: addDocument(k, in: p, folder: folder)
        case .papers: addPapers(in: p, folder: folder)
        }
    }

    /// a new notebook, essay or syllabus, selected and ready to name
    private func addDocument(_ k: ItemKind, in p: ProjectInfo, folder: String?) {
        var made: DocItem?
        s.change([p]) {
            made = k == .notebooks ? ws.createNotebook(in: p, title: "Untitled notebook") : k == .essays ? ws.createEssay(in: p, title: "") : ws.createSyllabus(in: p, title: "Untitled syllabus", folder: folder)
            if let m = made, folder != nil, k != .syllabi { ws.setFolder(k, m.id, folder, in: p) }
        } then: {
            guard let m = made else { return }
            let r = rowsFor(k, p).first { $0.itemID == m.id }
            rowID = r?.id; newName = k == .essays ? "" : m.title
            if let r { renaming = Target(key: r.id, title: r.title, row: r) }
        }
    }

    /// PDFs chosen in a panel, copied into the project (and folder)
    private func addPapers(in p: ProjectInfo, folder: String?) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.pdf]
        panel.allowsMultipleSelection = true
        panel.message = "Choose PDFs to copy into \(p.name)"
        guard panel.runModal() == .OK else { return }
        let urls = panel.urls
        s.change([p]) {
            let lib = Library(project: p.url)
            var items = lib.loadItems()
            for u in urls {
                guard var it = try? lib.importPDF(from: u) else { continue }
                it.folder = folder
                items.append(it)
            }
            lib.saveItems(items)
        }
    }

    private func link(_ r: DBRow, _ sid: String?) { s.change([r.project]) { ws.linkSyllabus(r.kind, r.itemID, to: sid, in: r.project) } }

    private func rename(_ t: Target) {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        if let row = t.row {
            if !name.isEmpty || row.kind == .essays { renameRow(row, to: name) }
        } else if !name.isEmpty {
            renameContainer(t, to: name)
        }
    }

    private func renameRow(_ row: DBRow, to name: String) {
        s.change([row.project]) {
            switch row.kind {
            case .notebooks, .essays, .syllabi, .decks:
                if let it = ws.item(row.kind, row.itemID, in: row.project) { ws.rename(row.kind, it, to: name) }
            case .papers:
                let lib = Library(project: row.project.url)
                lib.saveItems(lib.loadItems().map { var x = $0; if x.id == row.itemID { x.title = name }; return x })
            }
        }
    }

    private func renameContainer(_ t: Target, to name: String) {
        if t.key.hasPrefix("g:") {
            let old = String(t.key.dropFirst(2))
            var dest: URL?
            // the columns showing the folder (or folders inside it) follow it to its new name
            s.change(ws.projects().filter { $0.url.path.hasPrefix(old + "/") }) { dest = ws.renameGroup(URL(fileURLWithPath: old, isDirectory: true), to: name) } then: {
                if let d = dest { path = path.map { $0 == t.key ? "g:" + d.path : ($0.hasPrefix(t.key + "/") ? "g:" + d.path + $0.dropFirst(t.key.count) : $0) } }
            }
        } else if t.key.hasPrefix("p:"), let p = project(of: t.key) {
            s.change([p]) { _ = ws.renameProject(p, to: name) }
        } else if let p = project(of: t.key) {
            let fid = folderID(of: t.key) ?? ""
            s.change([]) { ws.renameFolder(fid, to: name, in: p) }
        }
    }

    private func delete(_ t: Target) {
        if let row = t.row { deleteRow(row) } else { deleteContainer(t) }
        rowID = nil
    }

    private func deleteRow(_ row: DBRow) {
        s.change([row.project]) {
            switch row.kind {
            case .notebooks, .essays, .syllabi, .decks:
                if let it = ws.item(row.kind, row.itemID, in: row.project) { ws.delete(it) }
            case .papers:
                let lib = Library(project: row.project.url)
                let items = lib.loadItems()
                if let it = items.first(where: { $0.id == row.itemID }) { lib.remove(it); lib.saveItems(items.filter { $0.id != it.id }) }
            }
        }
    }

    /// a folder of projects, a project or a folder in one; the columns close back to where it was
    private func deleteContainer(_ t: Target) {
        if t.key.hasPrefix("g:") {
            let u = URL(fileURLWithPath: String(t.key.dropFirst(2)), isDirectory: true)
            s.change(ws.projects().filter { $0.url.path.hasPrefix(u.path + "/") }) { ws.trash(u) }
        } else if t.key.hasPrefix("p:"), let p = project(of: t.key) {
            s.change([p]) { ws.deleteProject(p) }
        } else if let p = project(of: t.key) {
            let fid = folderID(of: t.key) ?? ""
            s.change([p]) { ws.deleteFolder(fid, in: p) }
        }
        if let i = path.firstIndex(of: t.key) { path = Array(path.prefix(i)) }
    }

    /// Dropping things onto a container: items into a project or one of its folders, folders under folders,
    /// projects and folders of projects into folders of projects.
    @discardableResult
    private func drop(_ payloads: [String], into key: String) -> Bool {
        var did = false
        for pl in payloads where pl != key {
            if pl.hasPrefix("p:") || pl.hasPrefix("g:") { did = dropDirectory(pl, into: key) || did }
            else if pl.hasPrefix("f:") { did = dropFolder(pl, into: key) || did }
            else { did = dropItem(pl, into: key) || did }
        }
        return did
    }

    /// a project, or a folder of projects, into a folder of projects (a folder can't go inside itself)
    private func dropDirectory(_ pl: String, into key: String) -> Bool {
        guard key.isEmpty || key.hasPrefix("g:") else { return false }
        let src = pl.hasPrefix("p:") ? project(of: pl)?.url : URL(fileURLWithPath: String(pl.dropFirst(2)), isDirectory: true)
        guard let src else { return false }
        let touched = ws.projects().filter { $0.url.path == src.path || $0.url.path.hasPrefix(src.path + "/") }
        // the move happens after the page is saved; the drop is taken now
        let a = src.standardizedFileURL.path, b = dir(of: key).standardizedFileURL.path
        guard a != b, !b.hasPrefix(a + "/") else { return false }
        s.change(touched) { ws.moveDir(src, into: dir(of: key)) }
        path = path.filter { !($0 == pl || $0.hasPrefix(pl + "/")) }
        return true
    }

    /// a folder in a project, under another folder of the same project (or its top level)
    private func dropFolder(_ pl: String, into key: String) -> Bool {
        guard let p = project(of: pl), project(of: key)?.id == p.id else { return false }
        let fid = folderID(of: pl) ?? ""
        let to: String? = folderID(of: key)
        s.change([]) { ws.moveFolder(fid, to: to, in: p) }
        return true
    }

    /// an item ("kind|project|id") into a project or one of its folders, moving it between projects if need be
    private func dropItem(_ pl: String, into key: String) -> Bool {
        let parts = pl.split(separator: "|").map(String.init)
        guard parts.count == 3, let k = ItemKind(rawValue: parts[0]), let src = ws.project(parts[1]), let dst = project(of: key) else { return false }
        let id = parts[2]
        let folder: String? = folderID(of: key)
        s.change(src.id == dst.id ? [src] : [src, dst]) {
            if src.id != dst.id { moveItem(k, id, from: src, to: dst) }
            ws.setFolder(k, id, folder, in: dst)
        }
        rowID = nil
        return true
    }

    private func moveItem(_ k: ItemKind, _ id: String, from src: ProjectInfo, to dst: ProjectInfo) {
        switch k {
        case .notebooks, .essays, .syllabi, .decks:
            if let it = ws.item(k, id, in: src) { ws.move(k, it, from: src, to: dst) }
        case .papers:
            let from = Library(project: src.url)
            if let it = from.loadItems().first(where: { $0.id == id }) { _ = from.move(it, to: Library(project: dst.url)) }
        }
    }
}

/// Lets a container line take drops (and Finder folders of papers onto a project).
struct DropInto: ViewModifier {
    let enabled: Bool
    let key: String
    @Binding var target: String?
    let perform: ([String]) -> Bool
    func body(content: Content) -> some View {
        if enabled {
            content.dropDestination(for: String.self) { items, _ in perform(items) } isTargeted: { on in
                target = on ? key : (target == key ? nil : target)
            }
        } else { content }
    }
}

/// The right-hand column: what the selected item is, with a button to open it.
@MainActor
struct PreviewPane: View {
    @EnvironmentObject var s: AppState
    let row: DBRow?
    let open: (DBRow) -> Void

    /// cards scheduled this many days apart are mastered
    static let masteredInterval = 21.0
    /// a deck shows this many cards, a syllabus this many points, an essay this many characters
    static let cardsShown = 8, pointsShown = 12, essayShown = 700

    var body: some View {
        ScrollView {
            if let r = row {
                summary(r).padding(22)
            } else {
                Text("Select something to see it here.\nDouble-click to open it.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(.top, 120)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// a picture (a paper's first page, else its kind's icon), its title and where it is, its details, Open
    private func summary(_ r: DBRow) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if r.kind == .papers, let img = thumbnail(r) {
                Image(nsImage: img).resizable().scaledToFit().frame(maxHeight: 280)
                    .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
                    .frame(maxWidth: .infinity)
            } else {
                Image(systemName: r.kind.icon).font(.system(size: 40, weight: .light)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
            }
            Text(r.title).font(.title2.weight(.semibold)).textSelection(.enabled)
            Text("\(r.kind.single) in \(r.project.name)")
                .foregroundStyle(.secondary)
            Divider()
            details(r)
            Button { open(r) } label: { Label("Open", systemImage: "arrow.up.forward.app") }
                .buttonStyle(.borderedProminent).controlSize(.large)
        }
    }

    @ViewBuilder private func details(_ r: DBRow) -> some View {
        switch r.kind {
        case .notebooks: notebookDetails(r)
        case .decks: deckDetails(r)
        case .syllabi: syllabusDetails(r)
        case .essays: essayDetails(r)
        case .papers: paperDetails(r)
        }
    }

    private func file(_ r: DBRow) -> JSON {
        s.workspace.item(r.kind, r.itemID, in: r.project).flatMap { s.workspace.read($0.url) } ?? [:]
    }

    @ViewBuilder private func notebookDetails(_ r: DBRow) -> some View {
        let ws = s.workspace
        let o = file(r)
        let syl = (o["syllabus"] as? String).flatMap { ws.item(.syllabi, $0, in: r.project) }
        let pts = syl.flatMap { ws.read($0.url)?["pts"] as? [[String: Any]] } ?? []
        let words = wordCount(plainText(o["doc"] as? String ?? ""))
        syllabusPicker(r, current: syl?.id)
        fact("Notes", "\(words.formatted()) words")
        if let d = r.date { fact("Edited", d.formatted(date: .abbreviated, time: .shortened)) }
        confidence(pts)
    }

    @ViewBuilder private func deckDetails(_ r: DBRow) -> some View {
        let o = file(r)
        let cards = ((o["cards"] as? [JSON]) ?? []).filter { !(($0["term"] as? String ?? "").isEmpty && ($0["def"] as? String ?? "").isEmpty) }
        let now = Date().timeIntervalSince1970
        let due = cards.filter { ($0["due"] as? Double).map { $0 <= now } ?? true }.count
        let mastered = cards.filter { ($0["interval"] as? Double ?? 0) >= Self.masteredInterval }.count
        syllabusPicker(r, current: o["syllabus"] as? String)
        fact("Cards", "\(cards.count)")
        fact("Due", "\(due)")
        fact("Mastered", "\(mastered)")
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(cards.prefix(Self.cardsShown).enumerated()), id: \.offset) { _, c in
                Text("\(c["term"] as? String ?? "") — \(c["def"] as? String ?? "")").font(.callout).lineLimit(1).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private func syllabusDetails(_ r: DBRow) -> some View {
        let pts = file(r)["pts"] as? [[String: Any]] ?? []
        let secs = Set(pts.compactMap { $0["sec"] as? String }).count
        let used = s.workspace.users(of: r.itemID, in: r.project)
        fact("Points", "\(pts.count) in \(secs) section\(secs == 1 ? "" : "s")")
        fact("Used by", used.isEmpty ? "Nothing yet" : used.map { $0.1.title }.joined(separator: ", "))
        confidence(pts)
        if !pts.isEmpty { pointList(pts) }
    }

    private func pointList(_ pts: [[String: Any]]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(pts.prefix(Self.pointsShown).enumerated()), id: \.offset) { _, p in
                Text("\(p["code"] as? String ?? "")  \(p["text"] as? String ?? "")").font(.callout).lineLimit(1).foregroundStyle(.secondary)
                    .padding(.leading, (p["lvl"] as? Int) == 3 ? 14 : 0)
            }
            if pts.count > Self.pointsShown { Text("and \(pts.count - Self.pointsShown) more").font(.caption).foregroundStyle(.tertiary) }
        }
    }

    @ViewBuilder private func essayDetails(_ r: DBRow) -> some View {
        let o = file(r)
        let text = plainText(o["doc"] as? String ?? "")
        syllabusPicker(r, current: o["syllabus"] as? String)
        fact("Length", "\(wordCount(text).formatted()) words")
        if let d = r.date { fact("Edited", d.formatted(date: .abbreviated, time: .shortened)) }
        if !text.isEmpty {
            Text(String(text.prefix(Self.essayShown)) + (text.count > Self.essayShown ? "…" : ""))
                .font(.system(size: 13, design: .serif)).foregroundStyle(.secondary).lineSpacing(3)
        }
    }

    @ViewBuilder private func paperDetails(_ r: DBRow) -> some View {
        let lib = Library(project: r.project.url)
        if let it = lib.loadItems().first(where: { $0.id == r.itemID }) {
            let doc = PDFDocument(url: lib.url(for: it))
            fact("Pages", "\(doc?.pageCount ?? 0)")
            fact("Highlights", "\(it.highlights.count)")
            fact("Source", it.refRaw.map { String($0.prefix(90)) } ?? (it.refId == nil ? "Not linked yet" : "Linked"))
            fact("File", it.file)
        }
    }

    /// Which syllabus a notebook or essay follows (or none).
    private func syllabusPicker(_ r: DBRow, current: String?) -> some View {
        let ws = s.workspace
        let list = ws.items(.syllabi, in: r.project)
        return HStack(alignment: .firstTextBaseline) {
            Text("Syllabus").foregroundStyle(.secondary).frame(width: 84, alignment: .leading)
            Picker("", selection: Binding(get: { current ?? "" }, set: { v in s.change([r.project]) { ws.linkSyllabus(r.kind, r.itemID, to: v.isEmpty ? nil : v, in: r.project) } })) {
                Text("None").tag("")
                ForEach(list, id: \.id) { Text($0.title).tag($0.id) }
            }.labelsHidden().fixedSize()
        }.font(.callout)
    }

    @ViewBuilder private func confidence(_ pts: [[String: Any]]) -> some View {
        let counts = (0...4).map { n in pts.filter { ($0["status"] as? Int ?? 0) == n }.count }
        if !pts.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Confidence").font(.caption).foregroundStyle(.secondary)
                GeometryReader { g in
                    HStack(spacing: 0) {
                        ForEach([4, 3, 2, 1, 0], id: \.self) { n in
                            Rectangle().fill(confColor(n)).frame(width: g.size.width * CGFloat(counts[n]) / CGFloat(max(pts.count, 1)))
                        }
                    }.clipShape(RoundedRectangle(cornerRadius: 3))
                }.frame(height: 8)
            }
        }
    }

    private func fact(_ k: String, _ v: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(k).foregroundStyle(.secondary).frame(width: 84, alignment: .leading)
            Text(v).textSelection(.enabled)
        }.font(.callout)
    }

    private func confColor(_ n: Int) -> Color { confidenceColor(n) }

    private func thumbnail(_ r: DBRow) -> NSImage? {
        let lib = Library(project: r.project.url)
        guard let it = lib.loadItems().first(where: { $0.id == r.itemID }), let page = PDFDocument(url: lib.url(for: it))?.page(at: 0) else { return nil }
        return page.thumbnail(of: CGSize(width: 400, height: 560), for: .cropBox)
    }
}
