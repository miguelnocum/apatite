import PDFKit

/// One line of a PDF's table of contents, in reading order.
struct TOCEntry: Identifiable, Hashable {
    let id: Int
    let title: String
    var page: Int               // PDF page index (-1 when unknown)
    var point: CGPoint? = nil   // where on the page the section starts, when the outline says
    let depth: Int
    let parent: Int?
    var hasKids = false
}

enum ReaderTOC {
    /// a destination point further out than this is no real point
    static let farPoint: CGFloat = 1e6

    /// The PDF's own outline (bookmarks), flattened in reading order.
    static func outline(_ doc: PDFDocument) -> [TOCEntry] {
        guard let root = doc.outlineRoot else { return [] }
        var out: [TOCEntry] = []
        walk(root, depth: 0, parent: nil, in: doc, into: &out)
        // a lone "Contents" bookmark over junk says nothing; neither does a single entry
        if out.allSatisfy({ !$0.hasKids && $0.title.range(of: #"contents$"#, options: [.regularExpression, .caseInsensitive]) != nil }) || out.count < 2 { return [] }
        // a heading without its own destination opens where its first subsection does
        for i in out.indices.reversed() where out[i].page < 0 {
            if i + 1 < out.count, out[i + 1].parent == i { out[i].page = out[i + 1].page }
        }
        return out
    }

    private static func walk(_ item: PDFOutline, depth: Int, parent: Int?, in doc: PDFDocument, into out: inout [TOCEntry]) {
        for i in 0..<item.numberOfChildren {
            guard let child = item.child(at: i) else { continue }
            let title = (child.label ?? "").components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
            // publishers' outlines often list scanned pages ("image 3", "726") rather than sections
            guard !title.isEmpty, !junk(title) else {
                walk(child, depth: depth, parent: parent, in: doc, into: &out)
                continue
            }
            let (page, point) = destination(of: child, in: doc)
            let id = out.count
            out.append(TOCEntry(id: id, title: title, page: page, point: point, depth: depth, parent: parent))
            walk(child, depth: depth + 1, parent: id, in: doc, into: &out)
            if out.count > id + 1 { out[id].hasKids = true }
        }
    }

    /// where an outline entry goes: its page (-1 when it has none) and point on it, when it says
    private static func destination(of item: PDFOutline, in doc: PDFDocument) -> (Int, CGPoint?) {
        guard let dest = item.destination ?? (item.action as? PDFActionGoTo)?.destination, let p = dest.page else { return (-1, nil) }
        let k = doc.index(for: p)
        let point = dest.point.y < farPoint && dest.point.y > -farPoint && dest.point != .zero ? dest.point : nil
        return (k != NSNotFound ? k : -1, point)
    }

    static func junk(_ t: String) -> Bool {
        t.range(of: #"^(image|page|figure|img|scan|p\.?)?\s*[\divxlc]+$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    // MARK: printed contents

    /// contents pages are looked for in this many first pages
    static let pagesScanned = 40
    /// a contents line is shorter than this
    static let longestLine = 160
    /// most of a contents page's page numbers count upwards
    static let risingShare = 0.8
    /// a contents page has this many lines (or this many, when it's named or follows one)
    static let fullPageLines = 6, namedPageLines = 3
    /// the first entries' titles are looked for this far after their printed page (or a little before)
    static let offsetsTried = -2...80
    /// a title is found by its first letters, this many (and at least the second number)
    static let titleKeyLetters = 18, shortestTitleKey = 5
    /// this many of the first entries vote on the offset, which needs at least two votes
    static let votingEntries = 8, votesNeeded = 2
    /// a title is looked for in the start of a page's text
    static let pageStart = 600

    private static let contentsLine = try! NSRegularExpression(pattern: #"^(.*?\p{L}.*?)[\s.·…_\-–]{1,}(\d{1,4})\s*$"#)
    private static let numberedTitle = try! NSRegularExpression(pattern: #"^(\d+(?:\.\d+)*)\.?\s"#)
    private static let frontOrBackMatter = try! NSRegularExpression(pattern: #"^(preface|foreword|introduction|acknowledg|contents|list of|abbreviations|notes|bibliography|references|works cited|index|appendix|appendices|epilogue|afterword|glossary|part\b|section\b|chapter\b)"#, options: .caseInsensitive)

    /// No outline: read the book's printed contents pages ("2.3 Gradient descent ...... 41") and find each
    /// entry's PDF page. `printedIndex` maps a printed page number to a PDF page when the reader's page
    /// numbers are set; otherwise the offset is worked out by finding the first entries' titles in the text.
    static func printedContents(_ doc: PDFDocument, printedIndex: [String: Int]) -> [TOCEntry] {
        guard let (rows, lastContentsPage) = contentsRows(doc), rows.count >= 3 else { return [] }
        var offset: Int? = nil
        if printedIndex.isEmpty || rows.prefix(5).allSatisfy({ printedIndex[String($0.n)] == nil }) {
            // the titles have to be found in the book, or the guess isn't trusted
            guard let found = pageOffset(rows, after: lastContentsPage, in: doc) else { return [] }
            offset = found
        }
        let index = { (n: Int) -> Int in
            if let o = offset { let i = n - 1 + o; return i >= 0 && i < doc.pageCount ? i : -1 }
            return printedIndex[String(n)] ?? -1
        }
        return entries(rows, page: index)
    }

    /// the lines of the contents pages (title and printed page) and the last contents page; nil without any
    private static func contentsRows(_ doc: PDFDocument) -> (rows: [(title: String, n: Int)], last: Int)? {
        var rows: [(title: String, n: Int)] = [], contentsPages: [Int] = [], started = false
        for i in 0..<min(doc.pageCount, pagesScanned) {
            guard let text = doc.page(at: i)?.string else { continue }
            let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            let found = lines.compactMap(contentsEntry)
            if isContentsPage(lines, found, following: started) {
                started = true; contentsPages.append(i); rows += found
            } else if started { break }
        }
        guard let last = contentsPages.last else { return nil }
        return (rows, last)
    }

    /// "2.3 Gradient descent ...... 41": its title and printed page
    private static func contentsEntry(_ line: String) -> (String, Int)? {
        let range = NSRange(line.startIndex..., in: line)
        guard line.count < longestLine, let m = contentsLine.firstMatch(in: line, range: range),
              let t = Range(m.range(at: 1), in: line), let p = Range(m.range(at: 2), in: line), let n = Int(line[p]) else { return nil }
        var title = String(line[t]).trimmingCharacters(in: CharacterSet(charactersIn: " .·…_-–\t"))
        title = title.replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
        return title.count >= 3 && n > 0 ? (title, n) : nil
    }

    /// a contents page counts upwards (a reference list, which also ends lines with numbers, doesn't) and has enough
    /// entries for one
    private static func isContentsPage(_ lines: [String], _ found: [(String, Int)], following started: Bool) -> Bool {
        let named = lines.prefix(6).contains { $0.range(of: #"^(table of )?contents$"#, options: [.regularExpression, .caseInsensitive]) != nil }
        let numbers = found.map(\.1), ups = zip(numbers, numbers.dropFirst()).filter { $0 <= $1 }.count
        let rising = numbers.count > 1 && Double(ups) >= Double(numbers.count - 1) * risingShare
        return rising && (found.count >= fullPageLines || (named && found.count >= namedPageLines) || (started && found.count >= namedPageLines))
    }

    /// printed page number -> PDF page: the offset at which the most of the first titles are found
    private static func pageOffset(_ rows: [(title: String, n: Int)], after lastContentsPage: Int, in doc: PDFDocument) -> Int? {
        var votes: [Int: Int] = [:]
        for row in rows.prefix(votingEntries) {
            let key = String(row.title.lowercased().filter { $0.isLetter }.prefix(titleKeyLetters))
            guard key.count >= shortestTitleKey else { continue }
            for off in offsetsTried {
                let i = row.n - 1 + off
                guard i > lastContentsPage, i < doc.pageCount, let s = doc.page(at: i)?.string else { continue }
                if s.prefix(pageStart).lowercased().filter({ $0.isLetter }).contains(key) { votes[off, default: 0] += 1; break }
            }
        }
        guard let best = votes.max(by: { $0.value < $1.value }), best.value >= votesNeeded else { return nil }
        return best.key
    }

    /// depth from the numbering: "3" / "Chapter 3" = 0, "3.2" = 1, "3.2.1" = 2
    private static func numberedDepth(_ title: String) -> Int? {
        guard let m = numberedTitle.firstMatch(in: title, range: NSRange(title.startIndex..., in: title)), let g = Range(m.range(at: 1), in: title) else { return nil }
        return min(2, title[g].split(separator: ".").count - 1)
    }

    /// the rows as entries, nested by their numbering (unnumbered lines after a numbered chapter are its sections)
    private static func entries(_ rows: [(title: String, n: Int)], page: (Int) -> Int) -> [TOCEntry] {
        let chaptersNumbered = rows.contains { numberedDepth($0.title) == 0 }
        var out: [TOCEntry] = [], lastAt: [Int: Int] = [:], inChapter = false
        for row in rows {
            var depth = 0
            if let d = numberedDepth(row.title) { depth = d; if d == 0 { inChapter = true } }
            else if frontOrBackMatter.firstMatch(in: row.title, range: NSRange(row.title.startIndex..., in: row.title)) != nil { inChapter = false }
            else if chaptersNumbered && inChapter { depth = 1 }
            let parent = depth > 0 ? lastAt[depth - 1] : nil
            let d = parent == nil ? 0 : depth
            let id = out.count
            out.append(TOCEntry(id: id, title: row.title, page: page(row.n), depth: d, parent: parent))
            if let p = parent { out[p].hasKids = true }
            lastAt[d] = id
            lastAt = lastAt.filter { $0.key <= d }
        }
        return out
    }
}
