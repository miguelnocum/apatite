import AppKit
import Foundation

/// Styles, numbering, footnotes, links and images of one .docx.
final class DocxContext {
    typealias Runs = (html: String, plain: String, images: [String])
    /// pictures larger than this aren't brought in
    static let maxImageBytes = 8_000_000

    let word: URL
    var styles: [String: String] = [:]          // styleId -> lowercased name
    var numFormats: [String: String] = [:]      // numId|ilvl -> "ul"/"ol"
    var footnotes: [String: String] = [:]       // id -> text
    var rels: [String: String] = [:]            // rId -> target

    init(word: URL) {
        self.word = word
        loadStyles()
        loadNumbering()
        loadRelationships()
        loadFootnotes()
    }

    /// the elements of one of the document's parts with this local name
    private func elements(in part: String, named name: String) -> [XMLElement] {
        guard let xml = try? XMLDocument(contentsOf: word.appendingPathComponent(part)) else { return [] }
        return ((try? xml.nodes(forXPath: "//*[local-name()='\(name)']")) ?? []).compactMap { $0 as? XMLElement }
    }

    private func firstValue(_ el: XMLElement, _ child: String) -> String? {
        el.elements(forLocalName: child, uri: el.uri).first.map { attr($0, "val") }
    }

    private func loadStyles() {
        for style in elements(in: "styles.xml", named: "style") {
            let id = attr(style, "styleId")
            styles[id] = (firstValue(style, "name") ?? id).lowercased()
        }
    }

    /// each list's levels are bullets or numbers; a list (num) points at its abstract definition
    private func loadNumbering() {
        var abstract: [String: [String: String]] = [:]
        for definition in elements(in: "numbering.xml", named: "abstractNum") {
            var levels: [String: String] = [:]
            for level in definition.elements(forLocalName: "lvl", uri: definition.uri) {
                let format = level.elements(forLocalName: "numFmt", uri: definition.uri).first.map { attr($0, "val") } ?? "bullet"
                levels[attr(level, "ilvl")] = format == "bullet" ? "ul" : "ol"
            }
            abstract[attr(definition, "abstractNumId")] = levels
        }
        for list in elements(in: "numbering.xml", named: "num") {
            let definition = firstValue(list, "abstractNumId") ?? ""
            for (level, kind) in abstract[definition] ?? [:] { numFormats[attr(list, "numId") + "|" + level] = kind }
        }
    }

    private func loadRelationships() {
        for relationship in elements(in: "_rels/document.xml.rels", named: "Relationship") {
            rels[relationship.attribute(forName: "Id")?.stringValue ?? ""] = relationship.attribute(forName: "Target")?.stringValue ?? ""
        }
    }

    private func loadFootnotes() {
        for note in elements(in: "footnotes.xml", named: "footnote") {
            let type = attr(note, "type")
            if type == "separator" || type == "continuationSeparator" { continue }
            let text = ((try? note.nodes(forXPath: ".//*[local-name()='t']")) ?? []).compactMap { $0.stringValue }.joined()
            footnotes[attr(note, "id")] = text.trimmingCharacters(in: .whitespaces)
        }
    }

    /// w:val and friends, whatever the prefix.
    func attr(_ e: XMLElement, _ local: String) -> String {
        (e.attributes ?? []).first { $0.localName == local }?.stringValue ?? ""
    }

    private func runSize(_ r: XMLElement) -> Int {
        guard let properties = r.elements(forLocalName: "rPr", uri: r.uri).first,
              let size = properties.elements(forLocalName: "sz", uri: r.uri).first else { return 0 }
        return Int(attr(size, "val")) ?? 0
    }

    /// a paragraph's runs that have text, with how much
    private func textRuns(_ p: XMLElement) -> [(XMLElement, Int)] {
        ((try? p.nodes(forXPath: ".//*[local-name()='r']")) ?? []).compactMap { $0 as? XMLElement }.map { r in
            (r, ((try? r.nodes(forXPath: "./*[local-name()='t']")) ?? []).compactMap { $0.stringValue }.joined().trimmingCharacters(in: .whitespaces).count)
        }.filter { $0.1 > 0 }
    }

    /// The commonest text size (half-points), weighted by how much text uses it.
    func bodySize(_ nodes: [XMLNode]) -> Int {
        var count: [Int: Int] = [:]
        for case let p as XMLElement in nodes where p.localName == "p" {
            for (r, n) in textRuns(p) { count[runSize(r), default: 0] += n }
        }
        return count.max { $0.value < $1.value }?.key ?? 0
    }

    /// A paragraph's largest text size and whether every run is bold.
    func format(_ p: XMLElement) -> (size: Double, allBold: Bool) {
        let runs = textRuns(p)
        let size = runs.map { runSize($0.0) }.max() ?? 0
        let bold = !runs.isEmpty && runs.allSatisfy { on($0.0.elements(forLocalName: "rPr", uri: p.uri).first, "b") }
        return (Double(size), bold)
    }

    func styleName(of p: XMLElement) -> String {
        guard let properties = p.elements(forLocalName: "pPr", uri: p.uri).first,
              let style = properties.elements(forLocalName: "pStyle", uri: p.uri).first else { return "normal" }
        let id = attr(style, "val")
        return styles[id] ?? id.lowercased()
    }

    func listType(of p: XMLElement) -> String? {
        guard let properties = p.elements(forLocalName: "pPr", uri: p.uri).first,
              let numbering = properties.elements(forLocalName: "numPr", uri: p.uri).first else { return nil }
        let numId = numbering.elements(forLocalName: "numId", uri: p.uri).first.map { attr($0, "val") } ?? ""
        if numId == "0" || numId.isEmpty { return nil }
        let level = numbering.elements(forLocalName: "ilvl", uri: p.uri).first.map { attr($0, "val") } ?? "0"
        return numFormats[numId + "|" + level] ?? "ul"
    }

    /// a run property switched on (w:b, w:b w:val="1"…; underline is on unless it's "none")
    func on(_ properties: XMLElement?, _ name: String) -> Bool {
        guard let e = properties?.elements(forLocalName: name, uri: properties?.uri).first else { return false }
        let value = attr(e, "val").lowercased()
        return value.isEmpty || value == "1" || value == "true" || value == "on" || (name == "u" && value != "none" && value != "0" && value != "false")
    }

    /// The runs of one paragraph as inline HTML, plus plain text and any images.
    func runs(_ p: XMLElement) -> Runs {
        let reader = DocxRunReader(context: self)
        reader.walk(p, href: nil)
        return (reader.html, reader.plain, reader.images)
    }

    /// a picture as a data URI (anything but PNG, JPEG and GIF converted to PNG through AppKit)
    func dataURI(_ target: String) -> String? {
        let url = word.appendingPathComponent(target)
        guard let data = try? Data(contentsOf: url), data.count < Self.maxImageBytes else { return nil }
        let ext = url.pathExtension.lowercased()
        let mime = ext == "png" ? "image/png" : (ext == "jpg" || ext == "jpeg") ? "image/jpeg" : ext == "gif" ? "image/gif" : nil
        if let mime { return "data:\(mime);base64," + data.base64EncodedString() }
        guard let image = NSImage(data: data), let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else { return nil }
        return "data:image/png;base64," + png.base64EncodedString()
    }
}

/// Reads one paragraph's runs (inside links, smart tags, insertions…) into HTML.
final class DocxRunReader {
    let context: DocxContext
    var html = "", plain = "", images: [String] = []

    init(context: DocxContext) { self.context = context }

    func walk(_ e: XMLElement, href: String?) {
        for case let child as XMLElement in e.children ?? [] {
            switch child.localName {
            case "r": run(child, href: href)
            case "hyperlink":
                let rid = (child.attributes ?? []).first { $0.localName == "id" }?.stringValue ?? ""
                walk(child, href: context.rels[rid])
            case "pPr", "rPr", "proofErr", "bookmarkStart", "bookmarkEnd": continue
            default: walk(child, href: href) // smartTag, sdt, ins, fldSimple…
            }
        }
    }

    private func run(_ r: XMLElement, href: String?) {
        var text = ""
        for case let piece as XMLElement in r.children ?? [] { text += self.piece(piece) }
        if text.isEmpty { return }
        html += formatted(text, r.elements(forLocalName: "rPr", uri: r.uri).first, uri: r.uri, href: href)
    }

    /// one piece of a run: text, a tab, a break, a footnote marker; pictures are collected
    private func piece(_ e: XMLElement) -> String {
        switch e.localName {
        case "t":
            plain += e.stringValue ?? ""
            return EssayImport.esc(e.stringValue ?? "")
        case "tab":
            plain += " "
            return " "
        case "br", "cr": return "<br>"
        case "noBreakHyphen": return "-"
        case "footnoteReference":
            return context.footnotes[context.attr(e, "id")].map { "<span data-fn=\"\(EssayImport.esc($0))\"></span>" } ?? ""
        case "drawing", "pict":
            collectImages(e)
            return ""
        default: return ""
        }
    }

    private func collectImages(_ e: XMLElement) {
        for case let blip as XMLElement in (try? e.nodes(forXPath: ".//*[local-name()='blip' or local-name()='imagedata']")) ?? [] {
            let rid = (blip.attributes ?? []).first { $0.localName == "embed" || $0.localName == "id" }?.stringValue ?? ""
            if let target = context.rels[rid], let uri = context.dataURI(target) { images.append(uri) }
        }
    }

    /// superscript or subscript, then strike, underline, italic, bold, and a web link around it all
    private func formatted(_ text: String, _ properties: XMLElement?, uri: String?, href: String?) -> String {
        var t = text
        let align = properties?.elements(forLocalName: "vertAlign", uri: uri).first.map { context.attr($0, "val") } ?? ""
        if align == "superscript" { t = "<sup>\(t)</sup>" } else if align == "subscript" { t = "<sub>\(t)</sub>" }
        for (property, tag) in [("strike", "s"), ("u", "u"), ("i", "em"), ("b", "strong")] where context.on(properties, property) {
            t = "<\(tag)>\(t)</\(tag)>"
        }
        if let href, href.hasPrefix("http") { t = "<a href=\"\(EssayImport.esc(href))\">\(t)</a>" }
        return t
    }
}
