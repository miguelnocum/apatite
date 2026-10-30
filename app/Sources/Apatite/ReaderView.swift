import SwiftUI
import PDFKit

struct ReaderPane: View {
    @EnvironmentObject var s: AppState

    var body: some View {
        VStack(spacing: 0) {
            ReaderBar()
            Divider()
            if let doc = s.reader.document {
                reading(doc)
            } else {
                EmptyReader()
            }
        }
        .sheet(isPresented: Binding(get: { s.citations.showLink }, set: { s.citations.showLink = $0 })) { LinkSheet().environmentObject(s) }
        .sheet(isPresented: Binding(get: { s.reader.showPages }, set: { s.reader.showPages = $0 })) { PagesSheet().environmentObject(s) }
    }

    /// the page, between the contents or annotations on the left and comments on the right
    private func reading(_ doc: PDFDocument) -> some View {
        HStack(spacing: 0) {
            if s.reader.showContents { ContentsPanel().frame(width: 260); Divider() }
            if s.reader.showAnnotations { AnnotationsPanel().frame(width: 250); Divider() }
            ZStack(alignment: .topLeading) {
                PDFKitView(document: doc).id(s.reader.currentId)
                CommentAnchors()
                WheelOverlay()
            }
            if !s.reader.comments.isEmpty || s.reader.tool == .comment { Divider(); CommentMargin().frame(width: 230) }
        }
    }
}

struct EmptyReader: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(.secondary)
            Text("No PDF open").font(.title3.weight(.semibold))
            Text("Import an article or book chapter. Select a sentence to highlight it,\nthen Cite quote to put it in your notes with its page number.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Import PDF…") { s.reader.importPDFs() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: s.themeUnderPage))
    }
}

struct ReaderBar: View {
    @EnvironmentObject var s: AppState
    @State private var keyOpen = false

    var body: some View {
        VStack(spacing: 6) {
            topRow
            if let label = s.reader.toolLabel { toolRow(label) }
            if s.reader.current != nil { highlightRow }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    /// the PDF to read (or import), its source and its printed page
    private var topRow: some View {
        HStack(spacing: 8) {
            pdfMenu

            Spacer(minLength: 4)

            if s.reader.current != nil { sourceAndPage }
        }
    }

    /// switch PDF, import one, show the library, remove this one
    private var pdfMenu: some View {
        Menu {
            ForEach(s.reader.items) { item in
                Button(item.title) { s.reader.open(item.id) }
            }
            if !s.reader.items.isEmpty { Divider() }
            Button("Import PDF…") { s.reader.importPDFs() }
            if s.reader.current != nil {
                Button("Show Library Folder") { s.reader.revealLibrary() }
                Divider()
                Button("Remove from Library…", role: .destructive) { s.reader.removeCurrent() }
            }
        } label: {
            Label(s.reader.current?.title ?? "Open a PDF", systemImage: "doc.richtext")
                .lineLimit(1)
        }
        .menuStyle(.borderlessButton)
        .frame(maxWidth: 320, alignment: .leading)
        .help("Switch PDF")
    }

    /// which Works Cited entry this PDF is, and the printed page shown
    @ViewBuilder private var sourceAndPage: some View {
        Button {
            s.citations.showLink = true
        } label: {
            Label(s.citations.currentRef.map { "(\($0.label))" } ?? "Link to source…",
                  systemImage: s.citations.currentRef == nil ? "link.badge.plus" : "link")
                .lineLimit(1)
        }
        .help("Which Works Cited entry this PDF is")

        Button {
            s.reader.showPages = true
        } label: {
            Label(s.reader.pageText, systemImage: s.reader.current?.pagesSet == true ? "number" : "exclamationmark.triangle")
        }
        .help(s.reader.current?.pagesSet == true ? "Printed page used in citations. Click to change." : "Page numbers not set yet. Click to set them.")
    }

    /// the reading tool in use, and how to stop it
    private func toolRow(_ label: String) -> some View {
        HStack(spacing: 8) {
            if case .highlight(let id) = s.reader.tool { Circle().fill(s.keyColor(id)?.color ?? .yellow).frame(width: 12, height: 12) }
            else { Image(systemName: s.reader.tool == .comment ? "text.bubble" : "eraser").font(.system(size: 12)) }
            Text(label).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            Text("Esc to stop").font(.system(size: 11)).foregroundStyle(.secondary)
            Spacer()
            Button { s.reader.tool = .select } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.borderless).foregroundStyle(.secondary)
                .help("Back to selecting")
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(Capsule().fill(Color.accentColor.opacity(0.14)))
    }

    /// highlight colours, the panel buttons, and Cite quote
    private var highlightRow: some View {
        HStack(spacing: 6) {
            highlightColours
            panelButtons
            Spacer()
            Button {
                s.citations.citeQuote()
            } label: {
                Label("Cite quote", systemImage: "quote.opening")
            }
            .buttonStyle(.borderedProminent)
            .disabled(!s.reader.hasSelection && s.reader.selectedHL == nil)
            .help("Insert the selected text with its citation and page number at your cursor in Notes (⇧⌘C)")
        }
    }

    /// a button per colour of the key: highlights the selection, or recolours the highlight picked
    @ViewBuilder private var highlightColours: some View {
        Text("Highlight")
            .font(.caption)
            .foregroundStyle(.secondary)
        ForEach(s.hlKey.filter { !$0.hidden }) { c in
            Button {
                if s.reader.hasSelection { s.reader.highlight(c.id) } else { s.reader.recolorSelectedHighlight(c.id) }
            } label: {
                Circle().fill(c.color)
                    .overlay(Circle().stroke(Color.primary.opacity(0.25), lineWidth: 0.5))
                    .frame(width: 18, height: 18)
            }
            .buttonStyle(.plain)
            .disabled(!s.reader.hasSelection && s.reader.selectedHL == nil)
            .opacity(!s.reader.hasSelection && s.reader.selectedHL == nil ? 0.4 : 1)
            .help(s.reader.hasSelection ? "Highlight: \(c.label)" : "Change to: \(c.label)")
        }
    }

    /// pop out, contents, annotations, the key, and removing the highlight picked
    @ViewBuilder private var panelButtons: some View {
        Button { s.navigation.readerDetached ? s.navigation.dockReader() : s.navigation.popOutReader() } label: {
            Image(systemName: s.navigation.readerDetached ? "arrow.down.right.and.arrow.up.left" : "arrow.up.forward.app")
        }
        .buttonStyle(.borderless)
        .help(s.navigation.readerDetached ? "Put the reader back in the main window" : "Open the reader in its own window (for another monitor)")
        Button { s.reader.showContents.toggle() } label: { Image(systemName: "list.bullet.indent") }
            .buttonStyle(.borderless)
            .help("Contents: chapters and sections (⌥⌘T)")
        Button { s.reader.showAnnotations.toggle() } label: { Image(systemName: "list.bullet.rectangle") }
            .buttonStyle(.borderless)
            .help("Every highlight and comment in this PDF")
        Button { keyOpen.toggle() } label: { Image(systemName: "key") }
            .buttonStyle(.borderless)
            .help("What each colour means")
            .popover(isPresented: $keyOpen, arrowEdge: .bottom) { KeyPopover().environmentObject(s) }
        if s.reader.selectedHL != nil && !s.reader.hasSelection { removeHighlightButton }
    }

    private var removeHighlightButton: some View {
        Button(role: .destructive) { s.reader.removeSelectedHighlight() } label: {
            Image(systemName: "trash")
        }
        .help("Remove this highlight")
    }
}

// MARK: PDF view

final class NBPDFView: PDFView {
    var onHighlightClick: ((String?) -> Void)?
    private var state: AppState { AppState.shared }

    /// Event position in top-left coordinates, the same space the SwiftUI overlays use.
    private func local(_ e: NSEvent) -> CGPoint {
        let p = convert(e.locationInWindow, from: nil)
        return CGPoint(x: p.x, y: bounds.height - p.y)
    }

    // the right button opens the wheel instead of the context menu
    override func menu(for event: NSEvent) -> NSMenu? { nil }
    override func rightMouseDown(with event: NSEvent) {
        MainActor.assumeIsolated { if state.reader.wheel != nil { state.reader.wheel = nil } else { state.reader.openWheel(at: local(event)) } }
    }
    override func rightMouseDragged(with event: NSEvent) { MainActor.assumeIsolated { state.reader.hoverWheel(at: local(event)) } }
    override func rightMouseUp(with event: NSEvent) { MainActor.assumeIsolated { state.reader.releaseWheel(at: local(event)) } }

    /// Esc leaves a tool (and closes the wheel).
    override func cancelOperation(_ sender: Any?) {
        MainActor.assumeIsolated { state.reader.wheel = nil; state.reader.tool = .select }
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { cancelOperation(nil) } else { super.keyDown(with: event) }
    }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let tool = MainActor.assumeIsolated { state.reader.tool }
        MainActor.assumeIsolated { state.reader.wheel = nil }
        if tool == .eraser, let page = page(for: p, nearest: false), let doc = document {
            let erased = MainActor.assumeIsolated { state.reader.erase(at: convert(p, to: page), page: doc.index(for: page)) }
            if !erased { NSSound.beep() }
            return
        }
        onHighlightClick?(highlightID(at: p))
        super.mouseDown(with: event)
        // super tracks the whole drag; by here the mouse is up
        afterDrag(at: p)
    }

    /// the highlight (its id) under a point, if any
    private func highlightID(at p: CGPoint) -> String? {
        guard let page = page(for: p, nearest: false), let a = page.annotation(at: convert(p, to: page)),
              let name = a.value(forAnnotationKey: .name) as? String, name.hasPrefix("snb:") else { return nil }
        return String(name.dropFirst(4))
    }

    /// Highlighter mode highlights what was just selected; comment mode comments on it (or on the spot clicked).
    func afterDrag(at p: CGPoint) {
        MainActor.assumeIsolated {
            let hasText = !(currentSelection?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            switch state.reader.tool {
            case .highlight(let id) where hasText: _ = state.reader.highlight(id)
            case .comment:
                if hasText { state.reader.commentOnSelection() }
                else if let page = page(for: p, nearest: false), let doc = document { state.reader.commentAt(page: doc.index(for: page), point: convert(p, to: page)) }
            default: break
            }
        }
    }
}

struct PDFKitView: NSViewRepresentable {
    let document: PDFDocument

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NBPDFView {
        let v = NBPDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.displaysPageBreaks = true
        v.backgroundColor = AppState.shared.themeUnderPage
        v.document = document
        v.onHighlightClick = { id in
            Task { @MainActor in AppState.shared.reader.selectedHL = id }
        }
        observe(v, context.coordinator)
        return v
    }

    /// selection, page, scroll and zoom changes reach the app state through the coordinator
    private func observe(_ v: NBPDFView, _ coordinator: Coordinator) {
        let center = NotificationCenter.default
        center.addObserver(coordinator, selector: #selector(Coordinator.selectionChanged(_:)), name: .PDFViewSelectionChanged, object: v)
        center.addObserver(coordinator, selector: #selector(Coordinator.pageChanged(_:)), name: .PDFViewPageChanged, object: v)
        AppState.shared.reader.pdfView = v
        DispatchQueue.main.async {
            AppState.shared.reader.pdfReady()
            if let clip = v.documentView?.enclosingScrollView?.contentView {
                clip.postsBoundsChangedNotifications = true
                center.addObserver(coordinator, selector: #selector(Coordinator.moved(_:)), name: NSView.boundsDidChangeNotification, object: clip)
            }
        }
        center.addObserver(coordinator, selector: #selector(Coordinator.moved(_:)), name: .PDFViewScaleChanged, object: v)
    }

    func updateNSView(_ v: NBPDFView, context: Context) {
        if v.document !== document { v.document = document }
        let bgc = AppState.shared.themeUnderPage; if v.backgroundColor != bgc { v.backgroundColor = bgc }
    }

    final class Coordinator: NSObject {
        @objc func selectionChanged(_ n: Notification) {
            guard let v = n.object as? PDFView else { return }
            let t = v.currentSelection?.string ?? ""
            let has = !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            Task { @MainActor in
                AppState.shared.reader.hasSelection = has
                if has { AppState.shared.reader.selectedHL = nil }
            }
        }
        @objc func moved(_ n: Notification) {
            Task { @MainActor in AppState.shared.reader.layoutTick &+= 1 }
        }
        @objc func pageChanged(_ n: Notification) {
            Task { @MainActor in AppState.shared.reader.updatePageText() }
        }
    }
}

// MARK: sheets

struct LinkSheet: View {
    @EnvironmentObject var s: AppState
    @State private var q = ""
    @State private var newRef = ""

    private var filtered: [RefInfo] {
        let t = q.lowercased().trimmingCharacters(in: .whitespaces)
        let list = s.citations.projectRefs.sorted { $0.raw.localizedCaseInsensitiveCompare($1.raw) == .orderedAscending }
        return t.isEmpty ? list : list.filter { ($0.raw + " " + $0.label).lowercased().contains(t) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Which source is this PDF?").font(.title3.weight(.semibold))
            Text(s.reader.current?.title ?? "").foregroundStyle(.secondary).lineLimit(1)
            TextField("Search your Works Cited", text: $q)
                .textFieldStyle(.roundedBorder)
            sources
            Divider()
            Text("Not in your Works Cited yet? Paste its Harvard reference (for example from MyBib):")
                .font(.callout)
            TextField("Argüelles, L. and March, H. (2022). Weeds in action…", text: $newRef, axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)
            linkButtons
        }
        .padding(20)
        .frame(width: 580, height: 560)
    }

    /// the Works Cited entries matching the search; one is chosen
    private var sources: some View {
        List(filtered) { r in sourceRow(r) }
        .frame(minHeight: 220)
        .overlay {
            if s.citations.refs.isEmpty {
                Text("Your Works Cited is empty.\nPaste the reference below to add it.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
            }
        }
    }

    private func sourceRow(_ r: RefInfo) -> some View {
        Button {
            s.citations.link(r.id)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text("(\(r.label))").fontWeight(.semibold)
                Text(r.raw).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 2)
    }

    /// Unlink, Cancel, and Add and link
    private var linkButtons: some View {
        HStack {
            if s.reader.current?.refId != nil {
                Button("Unlink") { s.citations.link(nil) }
            }
            Spacer()
            Button("Cancel") { s.citations.pendingCite = false; s.citations.showLink = false }
                .keyboardShortcut(.cancelAction)
            Button("Add and link") { s.citations.addRef(newRef) }
                .buttonStyle(.borderedProminent)
                .disabled(newRef.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }
}

struct PagesSheet: View {
    @EnvironmentObject var s: AppState
    @State private var useLabels = false
    @State private var printed = ""

    private var previewText: String {
        if useLabels { return "p. " + (s.reader.document?.page(at: s.reader.currentIndex)?.label ?? String(s.reader.currentIndex + 1)) }
        return "p. " + (printed.isEmpty ? "?" : printed)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Page numbers for citations").font(.title3.weight(.semibold))
            Text("Citations use the page number printed on the page, not the PDF's own count. Set it once for this PDF.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            // shown whenever the stored numbers exist or are in use, so they can always be switched off
            numbering
            Text("This page will be cited as \(previewText).").font(.callout.weight(.medium))
            pageButtons
        }
        .padding(20)
        .frame(width: 480)
        .onAppear {
            useLabels = s.reader.current?.useLabels ?? false
            printed = s.reader.printed(s.reader.currentIndex)
        }
    }

    /// the PDF's own page numbers (when it has them), or the printed number of the page you're on
    @ViewBuilder private var numbering: some View {
        if s.reader.docHasLabels || s.reader.current?.useLabels == true {
            Toggle("Use the page numbers stored in this PDF", isOn: $useLabels)
            if useLabels {
                Text("Turn this off to type the printed page number yourself.").font(.caption).foregroundStyle(.secondary)
            }
        }
        if !useLabels {
            HStack {
                Text("PDF page \(s.reader.currentIndex + 1) (the one you're on) is printed page")
                TextField("48", text: $printed)
                    .frame(width: 64)
                    .textFieldStyle(.roundedBorder)
            }
            Text("Journal article: the number in the page header or footer. Book chapter: the book's page number.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var pageButtons: some View {
        HStack {
            Spacer()
            Button("Cancel") { s.citations.pendingCite = false; s.reader.showPages = false }
                .keyboardShortcut(.cancelAction)
            Button("Save") { s.reader.setPages(useLabels: useLabels, printedNumber: Int(printed.trimmingCharacters(in: .whitespaces))) }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(!useLabels && Int(printed.trimmingCharacters(in: .whitespaces)) == nil)
        }
    }
}
