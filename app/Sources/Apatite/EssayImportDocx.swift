import Foundation

/// Word (.docx): a zip of XML parts; Word's own structure (styles, numbering, footnotes) maps onto the editor.
extension EssayImport {
    static func docx(_ url: URL) throws -> Result {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("apatite-import-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        try unzip(url, into: folder)
        let word = folder.appendingPathComponent("word")
        guard let doc = try? XMLDocument(contentsOf: word.appendingPathComponent("document.xml")) else {
            throw ImportError(message: "This doesn't look like a Word document.")
        }
        let body = (try? doc.nodes(forXPath: "//*[local-name()='body']/*")) ?? []
        let writer = DocxWriter(context: DocxContext(word: word), body: body)
        for case let el as XMLElement in body {
            if el.localName == "p" { writer.paragraph(el) } else if el.localName == "tbl" { writer.table(el) }
        }
        return writer.result(fallbackTitle: url.deletingPathExtension().lastPathComponent)
    }

    private static func unzip(_ url: URL, into folder: URL) throws {
        let unzip = Process()
        unzip.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        unzip.arguments = ["-qq", "-o", url.path, "-d", folder.path]
        unzip.standardOutput = FileHandle.nullDevice
        unzip.standardError = FileHandle.nullDevice
        try unzip.run()
        unzip.waitUntilExit()
    }
}

/// Builds an essay's HTML from a Word document's paragraphs and tables, in order.
final class DocxWriter {
    /// a paragraph this much bigger than the body text is a heading (when the file has no heading styles)…
    static let headingSize = 1.15
    /// …this much bigger, a chapter heading…
    static let chapterSize = 1.3
    /// …and this much bigger, at the very start, the title
    static let titleSize = 1.4
    /// a guessed heading has at most this many words
    static let headingWords = 14
    static let emptyCaption = "<figcaption><br></figcaption>"

    let context: DocxContext
    let bodySize: Double
    let usesHeadingStyles: Bool
    var blocks: [String] = []
    var title = ""
    var list: (tag: String, items: [String])?

    init(context: DocxContext, body: [XMLNode]) {
        self.context = context
        bodySize = Double(context.bodySize(body))
        usesHeadingStyles = body.contains { node in
            (node as? XMLElement).map { context.styleName(of: $0).hasPrefix("heading") || context.styleName(of: $0) == "title" } ?? false
        }
    }

    func flushList() {
        guard let list else { return }
        blocks.append("<\(list.tag)>" + list.items.map { "<li>\($0)</li>" }.joined() + "</\(list.tag)>")
        self.list = nil
    }

    func paragraph(_ el: XMLElement) {
        let style = context.styleName(of: el)
        let inner = context.runs(el)
        let text = inner.html.trimmingCharacters(in: .whitespacesAndNewlines)
        if listItem(el, inner: inner, text: text) { return }
        flushList()
        if contentsOrTitle(style: style, inner: inner, text: text) { return }
        for image in inner.images {
            blocks.append("<figure><img src=\"\(image)\" data-nb=\"1\" alt=\"\">\(Self.emptyCaption)</figure>")
        }
        if text.isEmpty { return }
        if style == "caption" {
            caption(text)
            return
        }
        if !usesHeadingStyles, style == "normal" || style.isEmpty, guessedHeading(el, plain: inner.plain) { return }
        blocks.append(styledBlock(style: style, text: text))
    }

    /// Word lists, or bullets typed as characters ("•<tab>…", "1.<tab>…")
    private func listItem(_ el: XMLElement, inner: DocxContext.Runs, text: String) -> Bool {
        var kind = context.listType(of: el), item = text
        if kind == nil, let marker = text.range(of: "^\\s*([•◦▪·‣–-])\\s+", options: .regularExpression) {
            kind = "ul"
            item = String(text[marker.upperBound...])
        } else if kind == nil, inner.plain.range(of: "^\\s*\\d{1,2}[.)]\\t", options: .regularExpression) != nil,
                  let marker = text.range(of: "^\\s*\\d{1,2}[.)]\\s+", options: .regularExpression) {
            kind = "ol"
            item = String(text[marker.upperBound...])
        }
        guard let kind else { return false }
        if list?.tag != kind {
            flushList()
            list = (kind, [])
        }
        if !item.isEmpty { list!.items.append(item) }
        return true
    }

    /// Word's contents (toc 1, toc 2…) become a live table of contents; the Title style is the essay's title
    private func contentsOrTitle(style: String, inner: DocxContext.Runs, text: String) -> Bool {
        if style.hasPrefix("toc") || style == "contents heading" {
            if !blocks.contains("<nav data-toc></nav>") { blocks.append("<nav data-toc></nav>") }
        } else if style == "title" {
            if title.isEmpty { title = inner.plain.trimmingCharacters(in: .whitespacesAndNewlines) } else if !text.isEmpty { blocks.append("<h4>\(text)</h4>") }
        } else if style == "subtitle" {
            if !text.isEmpty { blocks.append("<p><em>\(text)</em></p>") }
        } else { return false }
        return true
    }

    /// a caption belongs to the figure just before it (or straight after, if Word put it first)
    private func caption(_ text: String) {
        let words = text.replacingOccurrences(of: "^(Figure|Fig\\.|Table)\\s*\\d+[.:]?\\s*", with: "", options: [.regularExpression, .caseInsensitive])
        if let last = blocks.last, last.hasPrefix("<figure>"), last.contains(Self.emptyCaption) {
            blocks[blocks.count - 1] = last.replacingOccurrences(of: Self.emptyCaption, with: "<figcaption>\(words)</figcaption>")
        } else {
            blocks.append("<p><em>\(text)</em></p>")
        }
    }

    /// no heading styles in the file: big or all-bold short lines are headings
    private func guessedHeading(_ el: XMLElement, plain: String) -> Bool {
        let format = context.format(el)
        let words = plain.trimmingCharacters(in: .whitespaces)
        let short = words.split(separator: " ").count <= Self.headingWords && words.range(of: "[.,;:]$", options: .regularExpression) == nil
        let stands = format.size >= bodySize * Self.headingSize || (format.allBold && !words.isEmpty)
        guard short, bodySize > 0, stands else { return false }
        let html = EssayImport.esc(words)
        if title.isEmpty && blocks.isEmpty && format.size >= bodySize * Self.titleSize {
            title = words
        } else {
            blocks.append(format.size >= bodySize * Self.chapterSize ? "<h4>\(html)</h4>" : "<h5>\(html)</h5>")
        }
        return true
    }

    private func styledBlock(style: String, text: String) -> String {
        if style == "heading 1" || style == "heading1" { return "<h4>\(text)</h4>" }
        if style == "heading 2" || style == "heading2" { return "<h5>\(text)</h5>" }
        if style.hasPrefix("heading") { return "<h6>\(text)</h6>" }
        if style.contains("quote") { return "<blockquote>\(text)</blockquote>" }
        return "<p>\(text)</p>"
    }

    /// each cell's paragraphs on lines of their own
    func table(_ el: XMLElement) {
        flushList()
        let rows = el.elements(forLocalName: "tr", uri: el.uri).map { row -> String in
            let cells = row.elements(forLocalName: "tc", uri: el.uri).map { cell -> String in
                let lines = cell.elements(forLocalName: "p", uri: el.uri).map { context.runs($0).html }.filter { !$0.isEmpty }
                return "<td>" + lines.joined(separator: "<br>") + "</td>"
            }
            return "<tr>" + cells.joined() + "</tr>"
        }
        if !rows.isEmpty { blocks.append("<table><tbody>" + rows.joined() + "</tbody></table>") }
    }

    /// empty captions that never got text are dropped back to a plain image
    func result(fallbackTitle: String) -> EssayImport.Result {
        flushList()
        let html = blocks.joined().replacingOccurrences(of: Self.emptyCaption, with: "")
        return EssayImport.Result(title: title.isEmpty ? fallbackTitle : title, html: html.isEmpty ? "<p><br></p>" : html)
    }
}
