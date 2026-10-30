import Foundation
import PDFKit

/// One PDF in the library.
struct LibItem: Codable, Identifiable, Hashable {
    var id: String
    var file: String
    var title: String
    var refId: String?
    /// The linked source's full reference, so citing from this PDF can add it to any document's list.
    var refRaw: String?
    /// Use the page labels stored in the PDF instead of an offset.
    var useLabels: Bool = false
    /// Printed page = PDF page number + offset.
    var offset: Int = 0
    /// The user has confirmed how pages are numbered.
    var pagesSet: Bool = false
    /// The folder (inside the project) it sits in, if any.
    var folder: String? = nil
    var highlights: [Highlight] = []
    /// Margin comments; optional so libraries saved before comments existed still load.
    var comments: [PDFComment]?
}

/// A comment on a PDF: on some text (one rect per line) or at a point, in page coordinates.
struct PDFComment: Codable, Hashable, Identifiable {
    var id: String
    var page: Int
    var rects: [[Double]]          // [x, y, width, height]
    var quote: String
    var text: String
    var created: Double

    var cgRects: [CGRect] { rects.compactMap { $0.count == 4 ? CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) : nil } }
    var isPoint: Bool { quote.isEmpty }
}

struct Highlight: Codable, Hashable, Identifiable {
    var id: String
    var page: Int
    var pageEnd: Int
    var text: String
    var color: String
    /// Where it sits: [page, x, y, width, height] per line, in page coordinates. Kept here rather than
    /// written into the PDF, so highlighting never has to rewrite a (possibly huge) file.
    var boxes: [[Double]]? = nil
}

/// A Works Cited entry, as stored by the notebook.
struct RefInfo: Codable, Hashable, Identifiable {
    var id: String
    var raw: String
    var authors: [String]?
    var year: String?

    var label: String {
        let a = authors ?? []
        let names: String
        if a.count >= 3 { names = a[0] + " et al." }
        else if a.count == 2 { names = a[0] + " & " + a[1] }
        else { names = a.first ?? "Anon." }
        return "\(names), \(year ?? "n.d.")"
    }
}

/// One project's papers: the PDFs in <project>/Papers and their details in papers.json.
final class Library {
    let root: URL
    let pdfDir: URL

    init(project: URL) {
        root = project
        pdfDir = project.appendingPathComponent("Papers", isDirectory: true)
        try? FileManager.default.createDirectory(at: pdfDir, withIntermediateDirectories: true)
    }

    var libraryURL: URL { pdfDir.appendingPathComponent("papers.json") }

    func loadItems() -> [LibItem] {
        guard let d = try? Data(contentsOf: libraryURL) else { return [] }
        return (try? JSONDecoder().decode([LibItem].self, from: d)) ?? []
    }

    func saveItems(_ items: [LibItem]) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let d = try? enc.encode(items) { try? d.write(to: libraryURL, options: .atomic) }
    }

    func url(for item: LibItem) -> URL { pdfDir.appendingPathComponent(item.file) }

    /// Copies a PDF in under its own name (or "name 2.pdf" if that is taken). A PDF that stores its printed
    /// page numbers uses them straight away.
    func importPDF(from src: URL) throws -> LibItem {
        let file = freeFile(src.deletingPathExtension().lastPathComponent, in: pdfDir)
        try FileManager.default.copyItem(at: src, to: pdfDir.appendingPathComponent(file))
        var item = LibItem(id: UUID().uuidString, file: file, title: src.deletingPathExtension().lastPathComponent)
        if PDFDocument(url: pdfDir.appendingPathComponent(file))?.hasRealLabels == true { item.useLabels = true; item.pagesSet = true }
        return item
    }

    /// "name.pdf", or "name 2.pdf"… when that is taken.
    private func freeFile(_ name: String, in dir: URL) -> String {
        let base = Workspace.safeName(name, fallback: "Paper")
        var file = base + ".pdf", n = 2
        while FileManager.default.fileExists(atPath: dir.appendingPathComponent(file).path) { file = "\(base) \(n).pdf"; n += 1 }
        return file
    }

    func remove(_ item: LibItem) {
        try? FileManager.default.trashItem(at: url(for: item), resultingItemURL: nil)
    }

    /// Moves a paper's PDF and its details to another project's library.
    func move(_ item: LibItem, to other: Library) -> LibItem {
        var moved = item
        let file = freeFile((item.file as NSString).deletingPathExtension, in: other.pdfDir)
        try? FileManager.default.moveItem(at: url(for: item), to: other.pdfDir.appendingPathComponent(file))
        moved.file = file
        saveItems(loadItems().filter { $0.id != item.id })
        other.saveItems(other.loadItems() + [moved])
        return moved
    }
}

extension PDFDocument {
    /// Printed page numbers stored in the PDF (not just 1, 2, 3…).
    var hasRealLabels: Bool {
        for i in 0..<min(pageCount, 40) { if let l = page(at: i)?.label, !l.isEmpty, l != String(i + 1) { return true } }
        return false
    }
}
