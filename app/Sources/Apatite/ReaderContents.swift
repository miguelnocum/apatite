import SwiftUI
import PDFKit

extension AppState {
    /// Builds the contents for the open paper (once per paper), off the main thread.
    func loadTOC() {
        guard let item = current, document != nil, tocFor != item.id else { return }
        tocFor = item.id; toc = []; tocSource = "loading"
        let url = lib.url(for: item)
        let printedIndex = printedPageIndex(item)
        let id = item.id
        Task.detached(priority: .userInitiated) {
            let (found, from) = Self.readContents(url, printedIndex: printedIndex)
            await MainActor.run {
                guard self.tocFor == id else { return }
                let entries = found, source = from
                self.toc = entries; self.tocSource = source
            }
        }
    }

    /// printed page number -> PDF page, when the paper's page numbers are set
    private func printedPageIndex(_ item: LibItem) -> [String: Int] {
        var printedIndex: [String: Int] = [:]
        if item.useLabels || item.offset != 0 || item.pagesSet {
            for i in 0..<(document?.pageCount ?? 0) { printedIndex[printed(i)] = i }
        }
        return printedIndex
    }

    /// the outline, else the printed contents, and which it was; from a separate copy of the document, so the
    /// reader's own isn't touched from another thread
    nonisolated private static func readContents(_ url: URL, printedIndex: [String: Int]) -> ([TOCEntry], String) {
        guard let doc = PDFDocument(url: url) else { return ([], "none") }
        let outline = ReaderTOC.outline(doc)
        if !outline.isEmpty { return (outline, "outline") }
        let printed = ReaderTOC.printedContents(doc, printedIndex: printedIndex)
        return (printed, printed.isEmpty ? "none" : "printed")
    }

    /// The section the reader is in: the last entry starting on or before this page.
    var currentTOCEntry: Int? {
        let i = currentIndex
        return toc.last { $0.page >= 0 && $0.page <= i }?.id
    }

    func goTo(_ e: TOCEntry) {
        guard e.page >= 0, let v = pdfView, let p = document?.page(at: e.page) else { return }
        if let pt = e.point { v.go(to: PDFDestination(page: p, at: CGPoint(x: pt.x, y: pt.y + 6))) } else { v.go(to: p) }
        layoutTick += 1
        updatePageText()
    }
}

struct ContentsPanel: View {
    @EnvironmentObject var s: AppState
    @State private var open: Set<Int> = []
    @State private var q = ""
    @State private var followed: Int? = nil

    var body: some View {
        let cur = s.currentTOCEntry
        VStack(alignment: .leading, spacing: 0) {
            header
            if !s.toc.isEmpty {
                TextField("Find a chapter or section", text: $q)
                    .textFieldStyle(.roundedBorder).controlSize(.small)
                    .padding(.horizontal, 12).padding(.bottom, 8)
            }
            Divider()
            entries(cur)
        }
        .background(s.themePanel)
        .onAppear { s.loadTOC() }
        .onChange(of: s.currentId) { _, _ in open = []; q = ""; followed = nil; s.loadTOC() }
    }

    /// "Contents", expand or collapse all, and close
    private var header: some View {
        HStack {
            Text("Contents").font(.headline)
            Spacer()
            if s.toc.contains(where: { $0.hasKids }) && q.isEmpty {
                Button { open = open.isEmpty ? Set(s.toc.filter(\.hasKids).map(\.id)) : [] } label: {
                    Image(systemName: open.isEmpty ? "chevron.down.2" : "chevron.up.2")
                }.buttonStyle(.borderless).help(open.isEmpty ? "Expand all" : "Collapse all")
            }
            Button { s.showContents = false } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).help("Hide contents (⌥⌘T)")
        }.padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 6)
    }

    /// loading, nothing found, or the list (following the section being read)
    @ViewBuilder private func entries(_ cur: Int?) -> some View {
        if s.tocSource == "loading" {
            ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(20)
        } else if s.toc.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("No contents found").font(.callout.weight(.semibold))
                Text("This PDF has no built-in outline and no contents page with page numbers in its first pages.")
                    .font(.callout).foregroundStyle(.secondary)
            }.padding(14)
            Spacer()
        } else {
            contentsList(cur)
            if s.tocSource == "printed" {
                Text("Read from the book\u{2019}s printed contents page.")
                    .font(.caption2).foregroundStyle(.tertiary).padding(.horizontal, 12).padding(.vertical, 6)
            }
        }
    }

    private func contentsList(_ cur: Int?) -> some View {
        ScrollViewReader { proxy in
            List {
                ForEach(rows(cur)) { e in row(e, current: e.id == cur).id(e.id) }
            }
            .listStyle(.plain)
            .onAppear { follow(cur, proxy) }
            .onChange(of: cur) { _, c in follow(c, proxy) }
        }
    }

    /// What's on show: matches when searching, otherwise every entry whose parents are open.
    private func rows(_ cur: Int?) -> [TOCEntry] {
        let needle = q.trimmingCharacters(in: .whitespaces).lowercased()
        if !needle.isEmpty { return s.toc.filter { $0.title.lowercased().contains(needle) } }
        return s.toc.filter { e in
            var p = e.parent
            while let i = p { if !open.contains(i) { return false }; p = s.toc[i].parent }
            return true
        }
    }

    /// Opens the way down to the section being read and keeps it in view.
    private func follow(_ cur: Int?, _ proxy: ScrollViewProxy) {
        guard let c = cur, c != followed, c < s.toc.count else { return }
        followed = c
        var p = s.toc[c].parent
        while let i = p { open.insert(i); p = s.toc[i].parent }
        DispatchQueue.main.async { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(c, anchor: .center) } }
    }

    private func row(_ e: TOCEntry, current: Bool) -> some View {
        let searching = !q.trimmingCharacters(in: .whitespaces).isEmpty
        return HStack(spacing: 4) {
            if e.hasKids && !searching {
                expander(e)
            } else {
                Color.clear.frame(width: 14, height: 1)
            }
            entryButton(e)
        }
        .padding(.leading, searching ? 0 : CGFloat(e.depth) * 14)
        .padding(.vertical, 2).padding(.horizontal, 4)
        .background(RoundedRectangle(cornerRadius: 5).fill(current ? Color.accentColor.opacity(0.16) : .clear))
        .listRowInsets(EdgeInsets(top: 0, leading: 6, bottom: 0, trailing: 8))
        .listRowSeparator(.hidden)
    }

    /// the arrow that opens or closes an entry's subsections
    private func expander(_ e: TOCEntry) -> some View {
        Button { if open.contains(e.id) { open.remove(e.id) } else { open.insert(e.id) } } label: {
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
                .rotationEffect(.degrees(open.contains(e.id) ? 90 : 0))
                .frame(width: 14, height: 18).contentShape(Rectangle())
        }.buttonStyle(.plain).foregroundStyle(.secondary)
    }

    /// the entry's title and printed page; goes there
    private func entryButton(_ e: TOCEntry) -> some View {
        Button { s.goTo(e) } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(e.title)
                    .font(.system(size: e.depth == 0 ? 12.5 : 12, weight: e.depth == 0 ? .semibold : .regular))
                    .foregroundStyle(e.page < 0 ? Color.secondary : Color.primary)
                    .lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                if e.page >= 0 { Text(s.printed(e.page)).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary) }
            }.contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(e.page < 0)
    }
}
