import AppKit
import Foundation

/// Turns a Word document or a PDF into an essay: a title and HTML in the editor's own subset
/// (p, h4, h5, strong/em/u/s, sup/sub, a, ul/ol/li, table, blockquote, figure/figcaption, footnote spans).
/// Word is in EssayImportDocx.swift, PDF in EssayImportPDF.swift.
enum EssayImport {
    struct Result { var title: String; var html: String }

    static func convert(_ url: URL) throws -> Result {
        switch url.pathExtension.lowercased() {
        case "docx": return try docx(url)
        case "pdf": return try pdf(url)
        default: return try richText(url)
        }
    }

    static func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    struct ImportError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    // MARK: .doc, .rtf, .odt, .pages-exported files: whatever AppKit can read

    static func richText(_ url: URL) throws -> Result {
        let text = try NSAttributedString(url: url, options: [:], documentAttributes: nil)
        let data = try text.data(from: NSRange(location: 0, length: text.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.html])
        let html = String(data: data, encoding: .utf8) ?? ""
        // the page's sanitizer turns styled spans into strong/em and drops the rest
        let bodyHTML = html.range(of: "<body[^>]*>", options: .regularExpression).map { String(html[$0.upperBound...]) } ?? html
        return Result(title: url.deletingPathExtension().lastPathComponent, html: bodyHTML)
    }
}
