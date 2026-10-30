import Foundation
import PDFKit

// Prints the contents ReaderTOC finds in each PDF (the outline, else the printed contents), to compare two versions.
func show(_ entries: [TOCEntry]) -> String {
    entries.map { "\($0.id) d\($0.depth) p\($0.page) parent \($0.parent.map(String.init) ?? "-") kids \($0.hasKids) at \($0.point.map { "\($0.x),\($0.y)" } ?? "-") \($0.title)" }
        .joined(separator: "\n")
}
for path in CommandLine.arguments.dropFirst() {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { continue }
    print("== \((path as NSString).lastPathComponent)\noutline:\n\(show(ReaderTOC.outline(doc)))")
    print("printed:\n\(show(ReaderTOC.printedContents(doc, printedIndex: [:])))")
    let labels = Dictionary(uniqueKeysWithValues: (0..<doc.pageCount).map { (String($0 - 1), $0) })
    print("printed with page labels:\n\(show(ReaderTOC.printedContents(doc, printedIndex: labels)))")
}
