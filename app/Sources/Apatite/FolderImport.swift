import SwiftUI
import PDFKit
import CryptoKit

/// Importing a whole folder of PDFs (and its subfolders) into the Database.
enum FolderImport {
    /// The PDFs found, grouped by the top-level subfolder they're in ("" = the folder itself).
    struct Scan {
        let root: URL
        var groups: [(name: String, files: [URL])]
        var total: Int { groups.reduce(0) { $0 + $1.files.count } }
        var loose: Int { groups.first { $0.name.isEmpty }?.files.count ?? 0 }
        var subfolders: [String] { groups.map(\.name).filter { !$0.isEmpty } }
    }

    struct Result {
        var imported = 0, duplicates = 0, failed: [String] = []
        var projects: [String] = []
    }

    /// Every PDF under `root`, deeper subfolders counted with the top-level subfolder they sit in.
    static func scan(_ root: URL) -> Scan {
        var byGroup: [String: [URL]] = [:]
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.isRegularFileKey, .isPackageKey]
        if let e = fm.enumerator(at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants]) {
            for case let u as URL in e where u.pathExtension.lowercased() == "pdf" {
                guard (try? u.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
                let rel = u.path.dropFirst(root.path.count).split(separator: "/").map(String.init)
                byGroup[rel.count > 1 ? rel[0] : "", default: []].append(u)
            }
        }
        let groups = byGroup.map { (name: $0.key, files: $0.value.sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }) }
            .sorted { ($0.name.isEmpty ? "" : "1" + $0.name).localizedStandardCompare($1.name.isEmpty ? "" : "1" + $1.name) == .orderedAscending }
        return Scan(root: root, groups: groups)
    }

    static func hash(_ u: URL) -> String? {
        guard let d = try? Data(contentsOf: u, options: .mappedIfSafe) else { return nil }
        return SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined()
    }

    /// The PDF's own title when it's a real one, else the file name.
    static func title(of doc: PDFDocument?, file: URL) -> String {
        let name = file.deletingPathExtension().lastPathComponent
        guard let t = (doc?.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              t.count >= 8, t.split(separator: " ").count >= 2,
              t.range(of: "^(microsoft word|untitled|document\\d*|\\S+\\.(docx?|pdf|tex|indd))", options: [.regularExpression, .caseInsensitive]) == nil
        else { return name }
        return t
    }

    /// Which project each group goes to: `destination` is a project id or nil for a new project named after the folder;
    /// with `split`, each subfolder gets its own project (joining one with the same name).
    @MainActor static func plan(_ scan: Scan, destination: String?, split: Bool, ws: Workspace) -> (plan: [(files: [URL], project: URL, name: String)], touched: [ProjectInfo]) {
        func project(_ id: String?, newName: String) -> ProjectInfo {
            if let id, let p = ws.project(id) { return p }
            if let same = ws.projects().first(where: { $0.name.localizedCaseInsensitiveCompare(newName) == .orderedSame }) { return same }
            return ws.createProject(named: newName)
        }
        var plan: [(files: [URL], project: URL, name: String)] = [], touched: [ProjectInfo] = []
        let main = project(destination, newName: scan.root.lastPathComponent)
        for g in scan.groups {
            let p = (split && !g.name.isEmpty) ? project(nil, newName: g.name) : main
            if let i = plan.firstIndex(where: { $0.project == p.url }) { plan[i].files += g.files } else { plan.append((g.files, p.url, p.name)); touched.append(p) }
        }
        return (plan, touched)
    }

    /// Copies each group into its project, skipping files whose contents are already there. Runs off the main thread.
    nonisolated static func run(_ plan: [(files: [URL], project: URL, name: String)], progress: @escaping (Int) -> Void) -> Result {
        var r = Result(), done = 0
        for (files, projectURL, name) in plan {
            let added = copyGroup(files, into: Library(project: projectURL), result: &r) { done += 1; progress(done) }
            if added > 0, !r.projects.contains(name) { r.projects.append(name) }
        }
        return r
    }

    /// one group's files into a project's library; returns how many were added
    nonisolated private static func copyGroup(_ files: [URL], into lib: Library, result r: inout Result, step: () -> Void) -> Int {
        var items = lib.loadItems()
        let start = Set(items.map(\.id))
        var seen = Set(items.compactMap { hash(lib.url(for: $0)) })
        var added = 0
        for f in files {
            defer { step() }
            guard let h = hash(f) else { r.failed.append(f.lastPathComponent); continue }
            if seen.contains(h) { r.duplicates += 1; continue }
            do {
                var it = try lib.importPDF(from: f)
                it.title = title(of: PDFDocument(url: lib.url(for: it)), file: f)
                items.append(it); seen.insert(h); added += 1; r.imported += 1
            } catch { r.failed.append(f.lastPathComponent) }
        }
        // what the app saved while this ran (a highlight, say) is kept: only the new papers are added
        let new = Set(items.map(\.id)).subtracting(start)
        lib.saveItems(lib.loadItems() + items.filter { new.contains($0.id) })
        return added
    }
}

extension AppState {
    /// File → Import Folder of Papers…, or Import folder… in the Database (which preselects that project).
    func importFolder(into target: ProjectInfo? = nil, folder: URL? = nil) {
        var url = folder
        if url == nil {
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
            panel.message = "Choose a folder of papers. PDFs in its subfolders are included."
            panel.prompt = "Choose Folder"
            guard panel.runModal() == .OK else { return }
            url = panel.url
        }
        guard let u = url else { return }
        folderImport = FolderImportRequest(scan: FolderImport.scan(u), target: target?.id)
    }
}

struct FolderImportRequest: Identifiable {
    let id = UUID()
    let scan: FolderImport.Scan
    let target: String?
}

/// Choose where the folder's papers go, then watch them come in.
struct FolderImportSheet: View {
    @EnvironmentObject var s: AppState
    @Environment(\.dismiss) private var dismiss
    let req: FolderImportRequest
    static let newProject = "__new__"
    @State private var destination = FolderImportSheet.newProject
    @State private var splitSubfolders = false
    @State private var running = false
    @State private var done = 0
    @State private var result: FolderImport.Result?

    var body: some View {
        let scan = req.scan, folderName = scan.root.lastPathComponent
        VStack(alignment: .leading, spacing: 14) {
            Label(folderName, systemImage: "folder").font(.title2.weight(.semibold))
            if scan.total == 0 {
                Text("There are no PDFs in this folder or its subfolders.").foregroundStyle(.secondary)
                HStack { Spacer(); Button("OK") { dismiss() }.keyboardShortcut(.defaultAction) }
            } else if let r = result {
                finished(r)
            } else if running {
                ProgressView(value: Double(done), total: Double(scan.total)) { Text("Importing \(done) of \(scan.total)…") }
            } else {
                choices(scan, folderName: folderName)
            }
        }
        .padding(22)
        .frame(width: 480)
        .onAppear { if let t = req.target { destination = t } }
        .interactiveDismissDisabled(running)
    }

    /// how many came in (and where), how many were already there, and any that couldn't be read
    @ViewBuilder private func finished(_ r: FolderImport.Result) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Imported \(r.imported) paper\(r.imported == 1 ? "" : "s")" + (r.projects.isEmpty ? "" : " into " + r.projects.joined(separator: ", ")))
                .font(.headline)
            if r.duplicates > 0 { Text("\(r.duplicates) already there, skipped").foregroundStyle(.secondary) }
            if !r.failed.isEmpty { Text("Couldn't read: " + r.failed.prefix(6).joined(separator: ", ") + (r.failed.count > 6 ? "…" : "")).foregroundStyle(.red) }
        }
        HStack {
            Spacer()
            Button("Done") { dismiss() }
            Button("Show in Database") { s.navigation.screen = .database; dismiss() }.keyboardShortcut(.defaultAction)
        }
    }

    /// which project they go in (a new one by default), and whether subfolders become projects of their own
    @ViewBuilder private func choices(_ scan: FolderImport.Scan, folderName: String) -> some View {
        Text(summary(scan)).foregroundStyle(.secondary)
        Picker(scan.subfolders.isEmpty || !splitSubfolders ? "Put them in" : "Papers not in a subfolder go in", selection: $destination) {
            Text("New project \u{201C}\(folderName)\u{201D}").tag(Self.newProject)
            Divider()
            ForEach(s.workspace.projects()) { p in Text(p.name).tag(p.id) }
        }
        if !scan.subfolders.isEmpty { splitToggle(scan) }
        Text("Files are copied; the originals stay where they are. Papers already in a project are skipped.")
            .font(.caption).foregroundStyle(.secondary)
        HStack {
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Import \(scan.total) PDF\(scan.total == 1 ? "" : "s")") { start(scan) }.keyboardShortcut(.defaultAction)
        }
    }

    private func splitToggle(_ scan: FolderImport.Scan) -> some View {
        Toggle(isOn: $splitSubfolders) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Make each subfolder its own project")
                Text(scan.subfolders.prefix(4).joined(separator: ", ") + (scan.subfolders.count > 4 ? "…" : "") + ". A subfolder with the same name as a project joins it.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func summary(_ scan: FolderImport.Scan) -> String {
        let subs = scan.groups.filter { !$0.name.isEmpty }
        var t = "\(scan.total) PDF\(scan.total == 1 ? "" : "s")"
        if !subs.isEmpty {
            let inSubs = subs.reduce(0) { $0 + $1.files.count }
            t += ": \(scan.loose) in the folder, \(inSubs) in \(subs.count) subfolder\(subs.count == 1 ? "" : "s")"
        }
        return t
    }

    private func start(_ scan: FolderImport.Scan) {
        // decide every group's project up front (on the main thread), then copy in the background
        let (plan, touched) = FolderImport.plan(scan, destination: destination == Self.newProject ? nil : destination, split: splitSubfolders, ws: s.workspace)
        running = true
        DispatchQueue.global(qos: .userInitiated).async {
            let r = FolderImport.run(plan) { n in DispatchQueue.main.async { done = n } }
            DispatchQueue.main.async {
                running = false; result = r
                s.session.change(touched) {} // lists and the open project pick up the new papers
            }
        }
    }
}
