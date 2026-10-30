import SwiftUI
import AppKit

/// One colour in the highlight key: what it looks like and what it means.
/// `id` is what highlights store (the notes editor's data-h, a PDF highlight's color), so a colour
/// can be renamed or repainted without touching the highlights themselves.
struct KeyColor: Codable, Identifiable, Hashable {
    var id: String
    var meaning: String
    var hex: String
    /// Left out of the key, but kept so highlights already made in it still show.
    var hidden: Bool = false

    var ns: NSColor { NSColor(hex: hex) ?? .yellow }
    var color: Color { Color(nsColor: ns) }
    var label: String { meaning.isEmpty ? "No meaning yet" : meaning }
}

extension NSColor {
    convenience init?(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespaces)
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
    var hex: String {
        guard let c = usingColorSpace(.sRGB) else { return "#FFE58A" }
        return String(format: "#%02X%02X%02X", Int((c.redComponent * 255).rounded()), Int((c.greenComponent * 255).rounded()), Int((c.blueComponent * 255).rounded()))
    }
}

enum HighlightKey {
    /// Ids 1–6 are the colours highlights already used in notes, so nothing changes colour.
    static let defaults: [KeyColor] = [
        KeyColor(id: "1", meaning: "General", hex: "#FFE58A"),
        KeyColor(id: "5", meaning: "Key ideas", hex: "#9CCBFF"),
        KeyColor(id: "4", meaning: "Read more / secondary references", hex: "#CDB6FF"),
        KeyColor(id: "2", meaning: "Case studies & examples", hex: "#FFC58F"),
        KeyColor(id: "3", meaning: "Controversial ideas", hex: "#FF9C9C"),
        KeyColor(id: "6", meaning: "", hex: "#A8E8C0", hidden: true),
    ]

    /// Suggestions for "Add colour", skipping any already in the key.
    static let extras = ["#A8E8C0", "#FFB3DE", "#9EE6E0", "#DDF59A", "#E2C9A6", "#D5D9DE", "#B8C4FF", "#FFD6A5"]

    /// The PDF reader used to store colour names.
    static func id(forStored c: String) -> String {
        switch c { case "yellow": "1"; case "blue": "5"; case "purple": "4"; case "pink": "3"; case "green": "6"; case "orange": "2"; case "red": "3"; default: c }
    }

    static func url(_ root: URL) -> URL { root.appendingPathComponent("highlight-key.json") }

    static func load(_ root: URL) -> [KeyColor] {
        guard let d = try? Data(contentsOf: url(root)), let k = try? JSONDecoder().decode([KeyColor].self, from: d), !k.isEmpty else { return defaults }
        return k
    }

    static func save(_ key: [KeyColor], _ root: URL) {
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let d = try? enc.encode(key) { try? d.write(to: url(root), options: .atomic) }
    }
}

/// The key, editable: meanings, colours, more colours.
struct KeyEditor: View {
    @EnvironmentObject var s: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var key: [KeyColor] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Highlight key").font(.title2.weight(.semibold))
            Text("What each highlighter colour is for. It shows when you choose a colour, and when you point at a highlight, in notes, essays and PDFs.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 8) {
                ForEach($key) { $c in
                    if !c.hidden { colourRow($c) }
                }
            }
            buttons
        }
        .padding(22)
        .frame(width: 520)
        .onAppear { key = s.hlKey }
    }

    /// Add colour, Put back, Cancel and Done
    private var buttons: some View {
        HStack {
            Button { add() } label: { Label("Add colour", systemImage: "plus") }
            let removed = key.filter(\.hidden)
            if !removed.isEmpty { putBack(removed) }
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            Button("Done") { s.setHighlightKey(key); dismiss() }.keyboardShortcut(.defaultAction)
        }
    }

    /// a colour (to change), what it means, and removing it
    private func colourRow(_ c: Binding<KeyColor>) -> some View {
        HStack(spacing: 10) {
            ColorPicker("", selection: Binding(get: { c.wrappedValue.color }, set: { c.wrappedValue.hex = NSColor($0).hex }), supportsOpacity: false)
                .labelsHidden().frame(width: 44)
            TextField("What this colour means", text: c.meaning).textFieldStyle(.roundedBorder)
            Button { c.wrappedValue.hidden = true } label: { Image(systemName: "minus.circle") }
                .buttonStyle(.borderless).foregroundStyle(.secondary)
                .help("Remove from the key (highlights already made keep their colour)")
        }
    }

    /// colours removed from the key, to bring back
    private func putBack(_ removed: [KeyColor]) -> some View {
        Menu("Put back") {
            ForEach(removed) { c in
                Button { if let i = key.firstIndex(where: { $0.id == c.id }) { key[i].hidden = false } } label: {
                    Label(c.meaning.isEmpty ? c.hex : c.meaning, systemImage: "circle.fill")
                }
            }
        }.fixedSize()
    }

    private func add() {
        let used = Set(key.map { $0.hex.uppercased() })
        let hex = HighlightKey.extras.first { !used.contains($0) } ?? "#D5D9DE"
        key.append(KeyColor(id: "k" + UUID().uuidString.prefix(8).lowercased(), meaning: "", hex: hex))
    }
}

/// The key at a glance, from the PDF reader.
struct KeyPopover: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Highlight key").font(.headline)
            ForEach(s.hlKey.filter { !$0.hidden }) { c in
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 3).fill(c.color).frame(width: 22, height: 14)
                    Text(c.label).foregroundStyle(c.meaning.isEmpty ? .secondary : .primary)
                }
            }
            Divider()
            Button("Edit Key…") { s.openSettings("key") }
        }
        .padding(14)
        .frame(minWidth: 240, alignment: .leading)
    }
}
