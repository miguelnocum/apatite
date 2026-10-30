import SwiftUI
import PDFKit

// MARK: tools

/// What a drag or click on the PDF does.
enum ReaderTool: Equatable {
    case select, highlight(String), comment, eraser
}

/// One segment of the wheel.
struct WheelItem: Identifiable {
    let id: String
    let label: String
    let color: Color?
    let icon: String?
    let tool: ReaderTool
}

/// The wheel, where the right button went down (in the PDF view's top-left coordinates).
struct WheelState: Equatable {
    var center: CGPoint
    var hover: Int?
    var sticky = false
}

extension AppState {
    var wheelItems: [WheelItem] {
        hlKey.filter { !$0.hidden }.map { WheelItem(id: "k" + $0.id, label: $0.label, color: $0.color, icon: nil, tool: .highlight($0.id)) }
            + [WheelItem(id: "comment", label: "Comment", color: nil, icon: "text.bubble", tool: .comment),
               WheelItem(id: "eraser", label: "Eraser", color: nil, icon: "eraser", tool: .eraser),
               WheelItem(id: "select", label: "Select", color: nil, icon: "cursorarrow", tool: .select)]
    }

    static let wheelRadius: CGFloat = 104, wheelHole: CGFloat = 34

    /// Which segment a point is over (nil in the middle or outside).
    func wheelIndex(at p: CGPoint) -> Int? {
        guard let w = wheel else { return nil }
        let dx = p.x - w.center.x, dy = p.y - w.center.y, d = hypot(dx, dy)
        guard d > Self.wheelHole, d < Self.wheelRadius + 60 else { return nil }
        var a = atan2(dx, -dy) * 180 / .pi; if a < 0 { a += 360 }
        let n = wheelItems.count, seg = 360 / Double(n)
        return Int((a + seg / 2).truncatingRemainder(dividingBy: 360) / seg) % n
    }

    func openWheel(at p: CGPoint) { wheel = WheelState(center: p) }
    func hoverWheel(at p: CGPoint) { if wheel != nil { wheel?.hover = wheelIndex(at: p) } }

    /// Letting go: on a segment chooses it; letting go where it opened leaves it open for a click.
    func releaseWheel(at p: CGPoint) {
        guard let w = wheel else { return }
        if let i = wheelIndex(at: p) { choose(wheelItems[i]) }
        else if hypot(p.x - w.center.x, p.y - w.center.y) < Self.wheelHole { wheel?.sticky = true; wheel?.hover = nil }
        else { wheel = nil }
    }

    func choose(_ item: WheelItem) {
        wheel = nil
        tool = item.tool
        if case .highlight(let id) = item.tool, hasSelection { _ = highlight(id) }
        if item.tool == .comment, hasSelection { commentOnSelection() }
    }

    var toolLabel: String? {
        switch tool {
        case .select: return nil
        case .highlight(let id): return "Highlighter · " + (keyColor(id)?.label ?? "")
        case .comment: return "Comment: select text or click the page"
        case .eraser: return "Eraser: click a highlight or comment"
        }
    }

    // MARK: comments

    var comments: [PDFComment] { (current?.comments ?? []).sorted { ($0.page, -($0.cgRects.first?.maxY ?? 0)) < ($1.page, -($1.cgRects.first?.maxY ?? 0)) } }

    func commentOnSelection() {
        guard let view = pdfView, let doc = document, let sel = view.currentSelection,
              !(sel.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        var page = -1, rects: [[Double]] = []
        for line in sel.selectionsByLine() {
            for p in line.pages {
                let b = line.bounds(for: p); if b.width < 1 { continue }
                let i = doc.index(for: p); if page < 0 { page = i }
                if i == page { rects.append([b.minX, b.minY, b.width, b.height]) }
            }
        }
        guard page >= 0 else { return }
        addComment(page: page, rects: rects, quote: cleanText(sel.string ?? ""))
        view.clearSelection(); hasSelection = false
    }

    func commentAt(page: Int, point: CGPoint) {
        addComment(page: page, rects: [[point.x - 6, point.y - 6, 12, 12]], quote: "")
    }

    private func addComment(page: Int, rects: [[Double]], quote: String) {
        guard var item = current else { return }
        let c = PDFComment(id: UUID().uuidString, page: page, rects: rects, quote: quote, text: "", created: Date().timeIntervalSince1970)
        item.comments = (item.comments ?? []) + [c]
        update(item)
        editingComment = c.id
    }

    func setComment(_ id: String, text: String) {
        guard var item = current, let i = item.comments?.firstIndex(where: { $0.id == id }) else { return }
        item.comments![i].text = text
        update(item)
    }

    func deleteComment(_ id: String) {
        guard var item = current else { return }
        item.comments?.removeAll { $0.id == id }
        update(item)
        if editingComment == id { editingComment = nil }
    }

    /// Eraser: a highlight, or a comment's text or pin.
    func erase(at pagePoint: CGPoint, page: Int) -> Bool {
        if let c = current?.comments?.first(where: { $0.page == page && $0.cgRects.contains { $0.insetBy(dx: -3, dy: -3).contains(pagePoint) } }) {
            deleteComment(c.id); return true
        }
        guard let doc = document, let p = doc.page(at: page), let a = p.annotation(at: pagePoint),
              let name = a.value(forAnnotationKey: .name) as? String, name.hasPrefix("snb:") else { return false }
        removeHighlight(String(name.dropFirst(4)))
        return true
    }

    /// The comment, with its quote and citation, into the notes or essay at the cursor.
    func commentToNotes(_ c: PDFComment) {
        guard let item = current else { return }
        var pg = printed(c.page)
        if let last = item.highlights.first(where: { $0.text == c.quote }), last.pageEnd != last.page { pg += "\u{2013}" + printed(last.pageEnd) }
        let payload: [String: String] = ["text": c.text, "quote": c.quote, "refId": item.refId ?? "", "pg": pg, "refRaw": currentRef?.raw ?? item.refRaw ?? ""]
        notesVisible = true
        page.insertNote(payload)
    }

    func go(page: Int, rect: CGRect?) {
        guard let v = pdfView, let p = document?.page(at: page) else { return }
        if let r = rect { v.go(to: r.insetBy(dx: 0, dy: -80), on: p) } else { v.go(to: p) }
        layoutTick += 1
    }

    /// Where a page rectangle is in the PDF view, top-left origin (nil when off screen or not laid out).
    func viewRect(_ r: CGRect, page: Int) -> CGRect? {
        guard let v = pdfView, let p = document?.page(at: page) else { return nil }
        let vr = v.convert(r, from: p)
        return CGRect(x: vr.minX, y: v.bounds.height - vr.maxY, width: vr.width, height: vr.height)
    }
}

// MARK: the wheel

struct WheelOverlay: View {
    @EnvironmentObject var s: AppState
    /// px a hovered segment grows by
    static let hoverGrowth: CGFloat = 8

    var body: some View {
        if let w = s.wheel {
            let items = s.wheelItems
            ZStack {
                clickCatcher(w, items)
                ring(w, items)
                // the hovered item's meaning, under the wheel
                if let h = w.hover { hoverLabel(items[h].label, under: w) }
            }
        }
    }

    /// left open: a click on a segment chooses it, anywhere else closes the wheel
    private func clickCatcher(_ w: WheelState, _ items: [WheelItem]) -> some View {
        Color.black.opacity(0.001).contentShape(Rectangle())
            .onTapGesture(coordinateSpace: .local) { p in
                if let i = s.wheelIndex(at: p) { s.choose(items[i]) } else { s.wheel = nil }
            }
            .onContinuousHover { ph in if case .active(let p) = ph, w.sticky { s.hoverWheel(at: p) } }
    }

    private func ring(_ w: WheelState, _ items: [WheelItem]) -> some View {
        let seg = 360.0 / Double(items.count)
        return ZStack {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, it in segment(i, it, seg: seg, on: w.hover == i) }
            Circle().fill(.regularMaterial).frame(width: AppState.wheelHole * 2 - 6, height: AppState.wheelHole * 2 - 6)
        }
        .frame(width: (AppState.wheelRadius + 10) * 2, height: (AppState.wheelRadius + 10) * 2)
        .allowsHitTesting(false)
        .position(w.center)
        .shadow(color: .black.opacity(0.25), radius: 14, y: 4)
    }

    /// one item's segment (larger when hovered), with its icon (or a tick on the highlighter in use)
    @ViewBuilder private func segment(_ i: Int, _ it: WheelItem, seg: Double, on: Bool) -> some View {
        let start = Angle(degrees: -90 - seg / 2 + seg * Double(i)), end = Angle(degrees: -90 + seg / 2 + seg * Double(i))
        Segment(start: start, end: end, inner: AppState.wheelHole, outer: AppState.wheelRadius + (on ? Self.hoverGrowth : 0))
            .fill(it.color ?? Color(nsColor: .windowBackgroundColor))
            .overlay(Segment(start: start, end: end, inner: AppState.wheelHole, outer: AppState.wheelRadius + (on ? Self.hoverGrowth : 0))
                .stroke(on ? Color.accentColor : Color.primary.opacity(0.18), lineWidth: on ? 2.5 : 1))
        let mid = (start.degrees + end.degrees) / 2 * .pi / 180, r = (AppState.wheelHole + AppState.wheelRadius) / 2
        Group {
            if let icon = it.icon { Image(systemName: icon).font(.system(size: 17, weight: .semibold)) }
            else if case .highlight(let id) = it.tool, s.tool == .highlight(id) { Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundStyle(.black.opacity(0.6)) }
        }
        .offset(x: cos(mid) * r, y: sin(mid) * r)
    }

    private func hoverLabel(_ label: String, under w: WheelState) -> some View {
        Text(label)
            .font(.system(size: 12.5, weight: .semibold))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Capsule().fill(.regularMaterial))
            .position(x: w.center.x, y: w.center.y + AppState.wheelRadius + 26)
            .allowsHitTesting(false)
    }
}

struct Segment: Shape {
    var start: Angle, end: Angle, inner: CGFloat, outer: CGFloat
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        var p = Path()
        p.addArc(center: c, radius: outer, startAngle: start, endAngle: end, clockwise: false)
        p.addArc(center: c, radius: inner, startAngle: end, endAngle: start, clockwise: true)
        p.closeSubpath()
        return p
    }
}

// MARK: comments on the page and in the margin

/// Where each visible comment's anchor is, and where its card sits in the margin.
struct CommentSpot: Identifiable {
    let c: PDFComment
    let anchor: [CGRect]
    var cardY: CGFloat
    var id: String { c.id }
}

extension AppState {
    func commentSpots(height: CGFloat) -> [CommentSpot] {
        var out: [CommentSpot] = []
        for c in comments {
            let rs = c.cgRects.compactMap { viewRect($0, page: c.page) }
            guard let f = rs.first, f.maxY > -40, f.minY < height + 40 else { continue }
            out.append(CommentSpot(c: c, anchor: rs, cardY: max(6, f.minY - 6)))
        }
        // cards don't overlap: push each below the one before
        var next: CGFloat = 6
        for i in out.indices {
            out[i].cardY = max(out[i].cardY, next)
            let lines = CGFloat(max(1, (out[i].c.text.count + 30) / 32)) + (out[i].c.quote.isEmpty ? 0 : 1)
            next = out[i].cardY + (editingComment == out[i].c.id ? 150 : 34 + lines * 17) + 8
        }
        return out
    }
}

/// Underlines for comments on text, pins for comments on a point, and the lines to their cards.
struct CommentAnchors: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        GeometryReader { g in
            let _ = s.layoutTick
            let spots = s.commentSpots(height: g.size.height)
            ZStack(alignment: .topLeading) {
                ForEach(spots) { sp in anchor(sp, width: g.size.width) }
            }
        }
        .allowsHitTesting(false)
    }

    /// a pin (a comment on a point) or underlines (on text), and a line to the comment's card
    @ViewBuilder private func anchor(_ sp: CommentSpot, width: CGFloat) -> some View {
        let on = s.editingComment == sp.c.id
        if sp.c.isPoint, let r = sp.anchor.first {
            Image(systemName: "text.bubble.fill").font(.system(size: 15))
                .foregroundStyle(Color.accentColor)
                .position(x: r.midX, y: r.midY)
        } else {
            ForEach(Array(sp.anchor.enumerated()), id: \.offset) { _, r in
                Rectangle().fill(Color.accentColor.opacity(on ? 0.9 : 0.6)).frame(width: r.width, height: 2)
                    .position(x: r.midX, y: r.maxY + 1)
            }
        }
        if let r = sp.anchor.last {
            Path { p in
                p.move(to: CGPoint(x: r.maxX + 2, y: sp.c.isPoint ? r.midY : r.maxY + 1))
                p.addLine(to: CGPoint(x: width, y: sp.cardY + 14))
            }
            .stroke(Color.accentColor.opacity(on ? 0.8 : 0.35), style: StrokeStyle(lineWidth: on ? 1.5 : 1, dash: on ? [] : [3, 3]))
        }
    }
}

struct CommentMargin: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        GeometryReader { g in
            let _ = s.layoutTick
            let spots = s.commentSpots(height: g.size.height)
            ZStack(alignment: .topLeading) {
                Color(nsColor: s.themeUnderPage)
                ForEach(spots) { sp in
                    CommentCard(c: sp.c).frame(width: g.size.width - 16).offset(x: 8, y: sp.cardY)
                }
                if spots.isEmpty {
                    Text(s.comments.isEmpty ? "Comments appear here.\nRight-click and choose Comment." : "Scroll to see comments on other pages.")
                        .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        .frame(width: g.size.width).padding(.top, 40)
                }
            }
            .clipped()
        }
    }
}

struct CommentCard: View {
    @EnvironmentObject var s: AppState
    let c: PDFComment
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        let editing = s.editingComment == c.id
        VStack(alignment: .leading, spacing: 6) {
            content(editing)
        }
        .padding(9)
        .background(RoundedRectangle(cornerRadius: 8).fill(s.themePanel))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(editing ? Color.accentColor : Color.primary.opacity(0.12), lineWidth: editing ? 1.5 : 1))
        .shadow(color: .black.opacity(0.08), radius: 3, y: 1)
        .contentShape(Rectangle())
        .onTapGesture { if !editing { s.editingComment = c.id } }
        .onAppear { text = c.text; if editing { focused = true } }
        .onChange(of: editing) { _, e in if e { text = c.text; focused = true } }
    }

    /// the quote commented on, then the comment (to write in, while editing)
    @ViewBuilder private func content(_ editing: Bool) -> some View {
        if !c.quote.isEmpty {
            Text("\u{201C}" + c.quote + "\u{201D}").font(.system(size: 11, design: .serif)).foregroundStyle(.secondary).lineLimit(1)
        }
        if editing {
            editor
        } else {
            Text(c.text.isEmpty ? "Empty comment" : c.text).font(.system(size: 12.5)).foregroundStyle(c.text.isEmpty ? .secondary : .primary)
                .fixedSize(horizontal: false, vertical: true).lineLimit(6)
        }
    }

    /// the comment's text to write in; to Notes, delete, Done (an empty new comment goes)
    @ViewBuilder private var editor: some View {
        TextEditor(text: $text).font(.system(size: 12.5)).frame(height: 72).focused($focused)
            .scrollContentBackground(.hidden).background(RoundedRectangle(cornerRadius: 5).fill(Color(nsColor: .textBackgroundColor)))
            .onChange(of: text) { _, v in s.setComment(c.id, text: v) }
        HStack(spacing: 10) {
            Button { s.commentToNotes(c) } label: { Label("Notes", systemImage: "arrow.right.doc.on.clipboard") }
                .help("Put this comment, with its quote and citation, at your cursor in Notes or the essay")
            Button(role: .destructive) { s.deleteComment(c.id) } label: { Image(systemName: "trash") }.help("Delete comment")
            Spacer()
            Button("Done") { if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && c.text.isEmpty { s.deleteComment(c.id) } else { s.editingComment = nil } }
                .keyboardShortcut(.defaultAction)
        }
        .buttonStyle(.borderless).font(.system(size: 11.5))
    }
}

// MARK: the annotations list

struct AnnotationsPanel: View {
    @EnvironmentObject var s: AppState

    var body: some View {
        let hls = (s.current?.highlights ?? []).sorted { $0.page < $1.page }
        VStack(alignment: .leading, spacing: 0) {
            header
            filters(hls)
            Divider()
            List {
                if s.annFilter == "all" || s.annFilter == "comments" { ForEach(s.comments) { c in commentRow(c) } }
                if s.annFilter != "comments" {
                    ForEach(hls.filter { s.annFilter == "all" || "k" + HighlightKey.id(forStored: $0.color) == s.annFilter }) { h in highlightRow(h) }
                }
                if hls.isEmpty && s.comments.isEmpty {
                    Text("Highlights and comments in this PDF will be listed here.").font(.callout).foregroundStyle(.secondary)
                }
            }
            .listStyle(.plain)
        }
        .background(s.themePanel)
    }

    private var header: some View {
        HStack {
            Text("Annotations").font(.headline)
            Spacer()
            Button { s.showAnnotations = false } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
        }.padding(.horizontal, 12).padding(.vertical, 10)
    }

    /// All, each colour used, and comments
    private func filters(_ hls: [Highlight]) -> some View {
        let usedKeys = s.hlKey.filter { k in hls.contains { HighlightKey.id(forStored: $0.color) == k.id } }
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip("all", "All", nil)
                ForEach(usedKeys) { k in chip("k" + k.id, k.label, k.color) }
                if !s.comments.isEmpty { chip("comments", "Comments", nil, icon: "text.bubble") }
            }.padding(.horizontal, 12)
        }.padding(.bottom, 8)
    }

    /// a comment: goes to it and opens it
    private func commentRow(_ c: PDFComment) -> some View {
        Button { s.go(page: c.page, rect: c.cgRects.first); s.editingComment = c.id } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "text.bubble").foregroundStyle(Color.accentColor).frame(width: 16)
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.text.isEmpty ? "Empty comment" : c.text).lineLimit(3)
                    if !c.quote.isEmpty { Text("\u{201C}\(c.quote)\u{201D}").font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                    Text("p. \(s.printed(c.page))").font(.caption2).foregroundStyle(.tertiary)
                }
            }
        }.buttonStyle(.plain)
    }

    /// a highlight: goes to it and picks it
    private func highlightRow(_ h: Highlight) -> some View {
        Button { s.go(page: h.page, rect: h.boxes?.first.flatMap { $0.count == 5 ? CGRect(x: $0[1], y: $0[2], width: $0[3], height: $0[4]) : nil }); s.selectedHL = h.id } label: {
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 3).fill(s.keyColor(h.color)?.color ?? .yellow).frame(width: 14, height: 14).padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(h.text).lineLimit(3)
                    Text("p. \(s.printed(h.page))" + (s.keyColor(h.color).map { " · " + $0.label } ?? "")).font(.caption2).foregroundStyle(.tertiary)
                }
            }
        }.buttonStyle(.plain)
    }

    private func chip(_ id: String, _ label: String, _ color: Color?, icon: String? = nil) -> some View {
        Button { s.annFilter = id } label: {
            HStack(spacing: 5) {
                if let color { Circle().fill(color).frame(width: 9, height: 9) }
                if let icon { Image(systemName: icon).font(.system(size: 10)) }
                Text(label).lineLimit(1)
            }
            .font(.system(size: 11.5, weight: .medium))
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Capsule().fill(s.annFilter == id ? Color.accentColor.opacity(0.2) : Color.primary.opacity(0.06)))
        }.buttonStyle(.plain)
    }
}
