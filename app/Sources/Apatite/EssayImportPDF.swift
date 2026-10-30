import AppKit
import Foundation
import PDFKit

/// PDFs store lines, not paragraphs: rebuild paragraphs, and find headings from the PDF's outline
/// (bookmarks, which Word and LaTeX usually write) or, failing that, from type size and numbering.
extension EssayImport {
    static func pdf(_ url: URL) throws -> Result {
        guard let doc = PDFDocument(url: url), doc.pageCount > 0 else { throw ImportError(message: "This PDF couldn't be opened.") }
        let writer = PDFEssayWriter(PDFLines(doc))
        writer.write()
        return writer.result(fallbackTitle: url.deletingPathExtension().lastPathComponent)
    }
}

/// One line of a PDF's text, with the size and weight of its first letter.
struct PDFLine {
    var text: String
    var size: CGFloat
    var bold: Bool
    var page: Int
    var pageBreak = false
}

/// What a PDF's pages say: its lines, the body text size, its outline, and the lines repeated on every page.
struct PDFLines {
    /// the body text size when there's no text to measure
    static let defaultBodySize: CGFloat = 11
    /// lines at least this long count towards a typical line length
    static let measuredLineLength = 30

    let doc: PDFDocument
    var lines: [PDFLine] = []
    var bodySize: CGFloat = PDFLines.defaultBodySize
    var outline: [(title: String, level: Int, page: Int)] = []
    var repeated: Set<String> = []
    var typicalLength = 80
    var title = ""

    init(_ doc: PDFDocument) {
        self.doc = doc
        var sizeCount: [CGFloat: Int] = [:]
        for page in 0..<doc.pageCount { readPage(page, counting: &sizeCount) }
        bodySize = sizeCount.max { $0.value < $1.value }?.key ?? Self.defaultBodySize
        if let root = doc.outlineRoot { readOutline(root, depth: 0) }
        findRunningHeaders()
        let lengths = lines.map { $0.text.count }.filter { $0 >= Self.measuredLineLength }.sorted()
        typicalLength = lengths.isEmpty ? 80 : lengths[lengths.count * 3 / 4]
        title = (doc.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        if title.lowercased().hasSuffix(".docx") || title.lowercased().hasPrefix("microsoft word") { title = "" }
    }

    /// each line of a page, then a page break
    private mutating func readPage(_ page: Int, counting sizeCount: inout [CGFloat: Int]) {
        guard let text = doc.page(at: page)?.attributedString else { return }
        var location = 0
        for raw in text.string.components(separatedBy: "\n") {
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            let (size, bold) = Self.font(of: raw, at: location, in: text)
            if !trimmed.isEmpty { sizeCount[size, default: 0] += trimmed.count }
            lines.append(PDFLine(text: trimmed, size: size, bold: bold, page: page))
            location += (raw as NSString).length + 1
        }
        lines.append(PDFLine(text: "", size: 0, bold: false, page: page, pageBreak: true))
    }

    /// the size (to the half point) and boldness of a line's first letter
    private static func font(of raw: String, at location: Int, in text: NSAttributedString) -> (CGFloat, Bool) {
        let length = (raw as NSString).length
        guard length > 0, location < (text.string as NSString).length else { return (0, false) }
        let first = (raw as NSString).rangeOfCharacter(from: CharacterSet.whitespaces.inverted)
        let at = location + (first.location == NSNotFound ? 0 : first.location)
        guard at < text.length, let font = text.attribute(.font, at: at, effectiveRange: nil) as? NSFont else { return (0, false) }
        let bold = font.fontDescriptor.symbolicTraits.contains(.bold) || font.fontName.lowercased().contains("bold")
        return ((font.pointSize * 2).rounded() / 2, bold)
    }

    /// the outline: (title, level, page), in order
    private mutating func readOutline(_ item: PDFOutline, depth: Int) {
        for i in 0..<item.numberOfChildren {
            guard let child = item.child(at: i) else { continue }
            let title = (child.label ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !title.isEmpty { outline.append((title, depth, (child.destination?.page).map { doc.index(for: $0) } ?? -1)) }
            readOutline(child, depth: depth + 1)
        }
    }

    /// running headers/footers: the same line (ignoring numbers) on many pages
    private mutating func findRunningHeaders() {
        var seen: [String: Set<Int>] = [:]
        for line in lines where !line.text.isEmpty { seen[Self.withoutNumbers(line.text), default: []].insert(line.page) }
        let pages = doc.pageCount
        repeated = Set(seen.filter { pages >= 3 && $0.value.count >= max(3, pages / 2) }.keys)
    }

    static func withoutNumbers(_ text: String) -> String {
        text.replacingOccurrences(of: "\\d+", with: "#", options: .regularExpression)
    }
}

/// Turns a PDF's lines into paragraphs and headings, one line at a time.
final class PDFEssayWriter {
    /// type this much bigger than the body is a chapter heading…
    static let bigSize: CGFloat = 1.25
    /// …this much bigger, a heading…
    static let largerSize: CGFloat = 1.08
    /// …and bigger than this, not more of the contents
    static let contentsSize: CGFloat = 1.15
    /// a heading has at most this many words (a wrapped one, fewer than the second)
    static let headingWords = 14
    static let wrappedHeadingWords = 24
    /// an outline title may wrap over this many more lines
    static let outlineWrap = 3
    static let sentenceEnd = "[.!?:\u{201D}\"]$"

    let pdf: PDFLines
    let lines: [PDFLine]
    let titleKey: String
    var title: String
    var blocks: [String] = []
    var para = ""
    var tocDone = false, inTOC = false, tocCarry = false, inList = false
    var prev: PDFLine?
    var i = 0
    var pendingOutline: [(title: String, level: Int, page: Int)] // matched in order

    init(_ pdf: PDFLines) {
        self.pdf = pdf
        lines = pdf.lines
        title = pdf.title
        titleKey = Self.key(pdf.title)
        pendingOutline = pdf.outline
    }

    static func key(_ text: String) -> String {
        text.lowercased().replacingOccurrences(of: "[^\\p{L}\\p{N}]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }

    /// "2.1 Climate change 8", "Appendix 1: … 83": a contents line
    static func looksLikeTOCLine(_ text: String) -> Bool {
        text.range(of: "\\S.*\\s\\d{1,3}$", options: .regularExpression) != nil && text.count < 140
    }

    /// numbered headings say their own level: "2" chapter, "2.1" section, "2.1.1" subsection
    static func numberedLevel(_ text: String) -> Int? {
        guard let number = text.range(of: "^\\d+(\\.\\d+)*\\.?\\s", options: .regularExpression) else { return nil }
        return text[number].filter { $0 == "." }.count - (text[number].trimmingCharacters(in: .whitespaces).hasSuffix(".") ? 1 : 0)
    }

    func flush() {
        let text = para.trimmingCharacters(in: .whitespaces)
        if !text.isEmpty { blocks.append("<p>\(EssayImport.esc(text))</p>") }
        para = ""
    }

    func heading(_ text: String, _ level: Int) {
        flush()
        let tag = level <= 0 ? "h4" : level == 1 ? "h5" : "h6"
        blocks.append("<\(tag)>\(EssayImport.esc(text))</\(tag)>")
    }

    func write() {
        while i < lines.count {
            let line = lines[i]
            i += 1
            if skipped(line) || contents(line) || outlineHeading(line) || typeHeading(line) { continue }
            addToParagraph(line)
            prev = line
        }
        flush()
    }

    /// blank lines, running headers and page numbers end paragraphs (a page break only once the sentence has ended)
    private func skipped(_ line: PDFLine) -> Bool {
        let text = line.text
        let pageNumber = text.range(of: "^(page\\s*)?\\d+(\\s*(of|/)\\s*\\d+)?$", options: [.regularExpression, .caseInsensitive]) != nil
        guard text.isEmpty || pdf.repeated.contains(PDFLines.withoutNumbers(text)) || pageNumber else { return false }
        if text.isEmpty, line.pageBreak {
            if inTOC { tocCarry = true }
            inTOC = false
            inList = false
        }
        if text.isEmpty, let p = prev, !line.pageBreak || p.text.range(of: Self.sentenceEnd, options: .regularExpression) != nil { flush() }
        return true
    }

    /// the document's own contents page is dropped (replaced by a live table of contents), even over a page break;
    /// so are a list of tables' page numbers, and lines of the title on the first page
    private func contents(_ line: PDFLine) -> Bool {
        let text = line.text
        if !tocDone, text.range(of: "^(table of )?contents$", options: [.regularExpression, .caseInsensitive]) != nil {
            flush()
            blocks.append("<nav data-toc></nav>")
            tocDone = true
            inTOC = true
        } else if inTOC || carriedContents(line) {
        } else if inList, Self.looksLikeTOCLine(text) {
            flush()
            blocks.append("<p>\(EssayImport.esc(text.replacingOccurrences(of: "\\s+\\d{1,3}$", with: "", options: .regularExpression)))</p>")
        } else if !(line.page == 0 && !titleKey.isEmpty && line.size > pdf.bodySize && titleKey.contains(Self.key(text))) {
            return false
        }
        prev = line
        return true
    }

    /// the contents carried over a page break: still dropped while the lines look like contents (bigger type is a
    /// new heading)
    private func carriedContents(_ line: PDFLine) -> Bool {
        guard tocCarry else { return false }
        let text = line.text
        let next = i < lines.count && Self.looksLikeTOCLine(text + " " + lines[i].text)
        if line.size < pdf.bodySize * Self.contentsSize, Self.looksLikeTOCLine(text) || next { return true }
        tocCarry = false
        return false
    }

    /// outline headings, possibly wrapped over two or three lines
    private func outlineHeading(_ line: PDFLine) -> Bool {
        guard let entry = pendingOutline.first, line.page >= entry.page - 1 else { return false }
        let target = Self.key(entry.title)
        var joined = line.text, used = 0
        while Self.key(joined) != target, target.hasPrefix(Self.key(joined)), used < Self.outlineWrap, i + used < lines.count, !lines[i + used].text.isEmpty {
            joined += " " + lines[i + used].text
            used += 1
        }
        guard Self.key(joined) == target else { return false }
        heading(entry.title, entry.level)
        pendingOutline.removeFirst()
        i += used
        prev = lines[i - 1]
        return true
    }

    /// headings by type: with an outline, larger bold lines; without one, larger (or bold, starting a paragraph) lines,
    /// joined with the lines after in the same type
    private func typeHeading(_ line: PDFLine) -> Bool {
        let text = line.text
        let big = line.size >= pdf.bodySize * Self.bigSize, larger = line.size >= pdf.bodySize * Self.largerSize
        let headingLike = text.split(separator: " ").count <= Self.headingWords && text.range(of: "[.,;]$", options: .regularExpression) == nil
        if !pdf.outline.isEmpty, headingLike, larger, line.bold {
            heading(text, big ? 0 : 1)
            if text.range(of: "^list of (tables|figures|illustrations|abbreviations)", options: [.regularExpression, .caseInsensitive]) != nil { inList = true }
            prev = line
            return true
        }
        guard pdf.outline.isEmpty, headingLike && (larger || (line.bold && para.isEmpty)) else { return false }
        let joined = wrappedHeading(line)
        if title.isEmpty && line.page == 0 && blocks.isEmpty && big { title = joined } else { heading(joined, Self.numberedLevel(joined) ?? (big ? 0 : 1)) }
        prev = lines[i - 1]
        return true
    }

    /// a heading that wraps: following lines in the same type join it
    private func wrappedHeading(_ line: PDFLine) -> String {
        var joined = line.text
        while i < lines.count, !lines[i].text.isEmpty, lines[i].size == line.size, lines[i].bold == line.bold,
              joined.split(separator: " ").count < Self.wrappedHeadingWords,
              lines[i].text.range(of: "^\\d+(\\.\\d+)*\\s", options: .regularExpression) == nil {
            joined += " " + lines[i].text
            i += 1
        }
        return joined
    }

    /// a line of text: a new paragraph after an ended sentence, a short line or a change of type; a word broken by
    /// a hyphen is joined back
    private func addToParagraph(_ line: PDFLine) {
        if let p = prev, !para.isEmpty, startsNewParagraph(after: p, line) { flush() }
        if para.hasSuffix("-"), let first = line.text.first, first.isLowercase {
            para.removeLast()
            para += line.text
        } else {
            para += (para.isEmpty ? "" : " ") + line.text
        }
    }

    private func startsNewParagraph(after p: PDFLine, _ line: PDFLine) -> Bool {
        let typical = Double(pdf.typicalLength)
        let ended = p.text.range(of: Self.sentenceEnd, options: .regularExpression) != nil
        // a short line followed by a capital: separate lines (title pages, addresses), not one paragraph
        let shortThenNew = p.text.count < Int(typical * 0.6) && (line.text.first.map { $0.isUppercase || $0.isNumber } ?? false)
        // a new size starts a new paragraph; bold alone only after a short line ("Key words:" runs on)
        let typeChange = p.size != line.size || (p.bold != line.bold && p.text.count < Int(typical * 0.8))
        return (ended && p.text.count < Int(typical * 0.8)) || shortThenNew || (typeChange && !p.text.hasSuffix("-"))
    }

    func result(fallbackTitle: String) -> EssayImport.Result {
        EssayImport.Result(title: title.isEmpty ? fallbackTitle : title, html: blocks.isEmpty ? "<p><br></p>" : blocks.joined())
    }
}
