import SwiftUI

/// A deck of flashcards: edit them Quizlet-style, flip through them, learn them with spaced repetition, or test yourself.
struct DeckView: View {
    @EnvironmentObject var s: AppState
    enum Mode: String, CaseIterable { case cards = "Flashcards", learn = "Learn", test = "Test", edit = "Edit" }
    @State private var mode: Mode = .cards
    @State private var showSuggestions = false

    var body: some View {
        if s.deck != nil {
            deckScreen
        } else {
            Text("No deck open").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// the deck's header over the mode chosen; suggestions for ratings in a sheet
    private var deckScreen: some View {
        let suggestions = s.ratingSuggestions()
        return VStack(spacing: 0) {
            header(suggestions)
            Divider()
            Group {
                currentMode
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(s.themeBG)
        .onAppear {
            if s.deckStartEdit || (s.deck?.cards.filter { !$0.isBlank }.isEmpty ?? true) { mode = .edit }
            s.deckStartEdit = false
        }
        .onDisappear { s.saveDeckNow() }
        .sheet(isPresented: $showSuggestions) { SuggestionsSheet(list: suggestions).environmentObject(s) }
    }

    /// the screen for the mode chosen
    @ViewBuilder private var currentMode: some View {
        switch mode {
        case .edit: DeckEditor()
        case .cards: FlashcardsMode()
        case .learn: LearnMode()
        case .test: TestMode()
        }
    }

    private func header(_ suggestions: [PointSuggestion]) -> some View {
        let cards = (s.deck?.cards ?? []).filter { !$0.isBlank }
        let due = cards.filter { $0.isDue() }.count
        return HStack(spacing: 14) {
            Image(systemName: ItemKind.decks.icon).font(.title2).foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                TextField("Untitled deck", text: Binding(get: { s.deck?.title ?? "" }, set: { s.deck?.title = $0; s.saveDeckSoon() }))
                    .textFieldStyle(.plain).font(.system(size: 22, weight: .bold, design: .rounded))
                Text("\(cards.count) card\(cards.count == 1 ? "" : "s") · \(due) due · \(cards.filter(\.mastered).count) mastered · \(s.deckProject?.name ?? "")")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            headerControls(suggestions)
        }
        .padding(.horizontal, 22).padding(.vertical, 12)
    }

    /// the syllabus, rating suggestions, the mode, and popping the deck out
    @ViewBuilder private func headerControls(_ suggestions: [PointSuggestion]) -> some View {
        syllabusMenu
        if !suggestions.isEmpty {
            Button { showSuggestions = true } label: {
                Label("\(suggestions.count) rating suggestion\(suggestions.count == 1 ? "" : "s")", systemImage: "chart.bar.xaxis")
            }.help("Your results suggest changing some spec points' confidence ratings")
        }
        Picker("", selection: $mode) {
            ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }.pickerStyle(.segmented).labelsHidden().fixedSize()
        Button { s.deckDetached ? s.dockDeck() : s.popOutDeck() } label: {
            Image(systemName: s.deckDetached ? "arrow.down.right.and.arrow.up.left" : "macwindow.on.rectangle")
        }
        .buttonStyle(.borderless)
        .help(s.deckDetached ? "Put the deck back in the main window" : "Open the deck in its own window, beside your notes (\u{21E7}\u{2318}D)")
    }

    private var syllabusMenu: some View {
        let p = s.deckProject
        let list = p.map { s.workspace.items(.syllabi, in: $0) } ?? []
        let cur = list.first { $0.id == s.deck?.syllabus }
        return Menu {
            Button("None") { s.deck?.syllabus = nil; s.saveDeckSoon() }
            Divider()
            ForEach(list, id: \.id) { sy in Button(sy.title) { s.deck?.syllabus = sy.id; s.saveDeckSoon() } }
        } label: { Label(cur?.title ?? "No syllabus", systemImage: ItemKind.syllabi.icon) }
        .fixedSize()
        .help("Link the deck to a syllabus, so cards can belong to spec points")
    }
}

// MARK: - edit

struct DeckEditor: View {
    @EnvironmentObject var s: AppState
    @FocusState private var focus: String?

    var body: some View {
        let points = s.deckProject.map { s.workspace.points(of: s.deck?.syllabus, in: $0) } ?? []
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(Array((s.deck?.cards ?? []).enumerated()), id: \.element.id) { i, c in
                        row(i, c, points).id(c.id)
                    }
                    AddCardButton { add(after: nil, proxy) }
                    Text("Tab moves from term to definition; Return in a definition adds the next card.")
                        .font(.caption).foregroundStyle(.secondary).padding(.bottom, 30)
                }
                .padding(.horizontal, 40).padding(.top, 20).frame(maxWidth: 920).frame(maxWidth: .infinity)
            }
            .onAppear { if s.deck?.cards.isEmpty ?? true { add(after: nil, proxy) } }
        }
    }

    private func binding(_ id: String, _ kp: WritableKeyPath<Card, String>) -> Binding<String> {
        Binding(get: { s.deck?.cards.first { $0.id == id }?[keyPath: kp] ?? "" },
                set: { v in if let i = s.deck?.cards.firstIndex(where: { $0.id == id }) { s.deck?.cards[i][keyPath: kp] = v; s.saveDeckSoon() } })
    }

    private func row(_ i: Int, _ c: Card, _ points: [(id: String, code: String, text: String, status: Int, sub: Bool)]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            rowHeader(i, c, points)
            HStack(alignment: .top, spacing: 18) {
                field("Term", binding(c.id, \.term), id: c.id + "t")
                field("Definition", binding(c.id, \.def), id: c.id + "d")
                    .onSubmit { addAfter(c.id) }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 12).fill(s.themePanel))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.primary.opacity(0.08)))
    }

    /// the card's number, its spec point, star and delete
    private func rowHeader(_ i: Int, _ c: Card, _ points: [(id: String, code: String, text: String, status: Int, sub: Bool)]) -> some View {
        HStack {
            Text("\(i + 1)").font(.system(.callout, design: .rounded).weight(.bold)).foregroundStyle(.secondary)
            Spacer()
            if !points.isEmpty {
                Picker("", selection: Binding(get: { c.pt ?? "" }, set: { v in if let k = s.deck?.cards.firstIndex(where: { $0.id == c.id }) { s.deck?.cards[k].pt = v.isEmpty ? nil : v; s.saveDeckSoon() } })) {
                    Text("No spec point").tag("")
                    ForEach(points, id: \.id) { p in Text((p.sub ? "   " : "") + p.code + "  " + String(p.text.prefix(60))).tag(p.id) }
                }.labelsHidden().frame(maxWidth: 280)
            }
            Button { toggleStar(c.id) } label: { Image(systemName: c.starred ? "star.fill" : "star") }.buttonStyle(.borderless).foregroundStyle(c.starred ? .yellow : .secondary).help("Star")
            Button { remove(c.id) } label: { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.secondary).help("Delete card")
        }
    }

    private func field(_ label: String, _ b: Binding<String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(label, text: b, axis: .vertical)
                .textFieldStyle(.plain).font(.system(size: 15)).lineLimit(1...8)
                .focused($focus, equals: id)
                .padding(.bottom, 4)
                .overlay(alignment: .bottom) { Rectangle().fill(focus == id ? Color.accentColor : Color.primary.opacity(0.25)).frame(height: focus == id ? 2 : 1) }
            Text(label.uppercased()).font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity)
    }

    private func add(after id: String?, _ proxy: ScrollViewProxy? = nil) {
        let c = Card()
        if let id, let i = s.deck?.cards.firstIndex(where: { $0.id == id }) { s.deck?.cards.insert(c, at: i + 1) } else { s.deck?.cards.append(c) }
        s.saveDeckSoon()
        DispatchQueue.main.async { proxy?.scrollTo(c.id, anchor: .center); focus = c.id + "t" }
    }
    private func addAfter(_ id: String) { add(after: id) }
    private func remove(_ id: String) { s.deck?.cards.removeAll { $0.id == id }; s.saveDeckSoon() }
    private func toggleStar(_ id: String) { if let i = s.deck?.cards.firstIndex(where: { $0.id == id }) { s.deck?.cards[i].starred.toggle(); s.saveDeckSoon() } }
}

/// The dashed "Add card" box: the whole box is clickable, and it shades in under the pointer.
struct AddCardButton: View {
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Label("Add card", systemImage: "plus")
                .font(.system(size: 14, weight: hover ? .semibold : .regular))
                .frame(maxWidth: .infinity).padding(.vertical, 16)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.accentColor.opacity(hover ? 0.12 : 0)))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                    .foregroundStyle(hover ? Color.accentColor.opacity(0.8) : Color.secondary.opacity(0.5)))
                .contentShape(RoundedRectangle(cornerRadius: 12))
                .scaleEffect(hover ? 1.005 : 1)
        }
        .buttonStyle(.plain)
        .foregroundStyle(hover ? Color.accentColor : Color.primary)
        .onHover { h in withAnimation(.easeOut(duration: 0.15)) { hover = h } }
        .help("Add a card (or press Return in the last definition)")
    }
}

// MARK: - flashcards

struct FlashcardsMode: View {
    @EnvironmentObject var s: AppState
    @State private var order: [String] = []
    @State private var index = 0
    @State private var flipped = false
    @State private var shuffled = false
    @State private var starredOnly = false
    @State private var termFirst = true
    @FocusState private var focused: Bool

    private var cards: [Card] {
        let all = (s.deck?.cards ?? []).filter { !$0.isBlank && (!starredOnly || $0.starred) }
        guard shuffled, !order.isEmpty else { return all }
        return order.compactMap { id in all.first { $0.id == id } }
    }

    var body: some View {
        let list = cards
        VStack(spacing: 22) {
            cardsShown(list)
        }
        .padding(30)
        .focusable().focused($focused).focusEffectDisabled()
        .onAppear { focused = true }
        .onKeyPress(.space) { flipped.toggle(); return .handled }
        .onKeyPress(.leftArrow) { go(-1, cards.count); return .handled }
        .onKeyPress(.rightArrow) { go(1, cards.count); return .handled }
        .onKeyPress("s") { if index < cards.count { star(cards[index].id) }; return .handled }
        .onChange(of: starredOnly) { _, _ in index = 0; flipped = false }
    }

    /// the card at hand with its controls (or why there's none)
    @ViewBuilder private func cardsShown(_ list: [Card]) -> some View {
        if list.isEmpty {
            Spacer()
            Text(starredOnly ? "No starred cards" : "No cards yet. Add some in Edit.").foregroundStyle(.secondary)
            Spacer()
        } else {
            let i = min(index, list.count - 1), c = list[i]
            Spacer(minLength: 10)
            flipCard(c)
            controls(i, c, count: list.count)
            Spacer(minLength: 10)
        }
    }

    /// the card, turning over when clicked
    private func flipCard(_ c: Card) -> some View {
        ZStack {
            face(termFirst ? c.term : c.def, label: termFirst ? "Term" : "Definition", c: c).opacity(flipped ? 0 : 1)
            face(termFirst ? c.def : c.term, label: termFirst ? "Definition" : "Term", c: c).opacity(flipped ? 1 : 0)
                .rotation3DEffect(.degrees(180), axis: (0, 1, 0))
        }
        .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (0, 1, 0), perspective: 0.4)
        .animation(.spring(response: 0.45, dampingFraction: 0.8), value: flipped)
        .onTapGesture { flipped.toggle() }
        .frame(maxWidth: 760, maxHeight: 420)
    }

    /// back and forth, shuffle, starred only, which side first, star
    @ViewBuilder private func controls(_ i: Int, _ c: Card, count: Int) -> some View {
        HStack(spacing: 18) {
            Button { go(-1, count) } label: { Image(systemName: "arrow.left").frame(width: 34, height: 28) }.disabled(i == 0)
            Text("\(i + 1) / \(count)").font(.system(.body, design: .rounded).monospacedDigit()).frame(minWidth: 70)
            Button { go(1, count) } label: { Image(systemName: "arrow.right").frame(width: 34, height: 28) }.disabled(i == count - 1)
        }.controlSize(.large)
        HStack(spacing: 16) {
            Toggle("Shuffle", isOn: Binding(get: { shuffled }, set: { shuffled = $0; reshuffle() }))
            Toggle("Starred only", isOn: $starredOnly)
            Picker("Front", selection: $termFirst) { Text("Term first").tag(true); Text("Definition first").tag(false) }.fixedSize()
            Button { star(c.id) } label: { Label(c.starred ? "Starred" : "Star", systemImage: c.starred ? "star.fill" : "star") }
        }.toggleStyle(.checkbox).font(.callout)
        Text("Space or click to flip · ← → to move · S to star").font(.caption).foregroundStyle(.secondary)
    }

    private func face(_ text: String, label: String, c: Card) -> some View {
        VStack(spacing: 10) {
            Text(label.uppercased()).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
            Spacer()
            Text(text.isEmpty ? "—" : text).font(.system(size: text.count > 160 ? 18 : text.count > 60 ? 23 : 30, weight: .semibold, design: .rounded))
                .multilineTextAlignment(.center).padding(.horizontal, 30).textSelection(.enabled)
            Spacer()
        }
        .padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: 22).fill(s.themePanel).shadow(color: .black.opacity(0.12), radius: 18, y: 8))
        .overlay(alignment: .topTrailing) { if c.starred { Image(systemName: "star.fill").foregroundStyle(.yellow).padding(18) } }
    }

    private func go(_ d: Int, _ n: Int) {
        let to = max(0, min(n - 1, index + d))
        if to != index { flipped = false; withAnimation(.easeOut(duration: 0.15)) { index = to } }
    }
    private func reshuffle() { order = (s.deck?.cards ?? []).map(\.id).shuffled(); index = 0; flipped = false }
    private func star(_ id: String) { if let i = s.deck?.cards.firstIndex(where: { $0.id == id }) { s.deck?.cards[i].starred.toggle(); s.saveDeckSoon() } }
}

// MARK: - learn (spaced repetition)

struct LearnMode: View {
    @EnvironmentObject var s: AppState
    @State private var queue: [String] = []
    @State private var started = false
    @State private var shown = false
    @State private var done = 0
    @State private var againCount = 0
    @FocusState private var focused: Bool

    var body: some View {
        let all = (s.deck?.cards ?? []).filter { !$0.isBlank }
        let dueNow = all.filter { $0.isDue() }
        VStack(spacing: 20) {
            if !started {
                startScreen(all, dueNow)
            } else if let id = queue.first, let c = all.first(where: { $0.id == id }) {
                review(c)
            } else {
                sessionDone(all)
            }
        }
        .padding(30)
        .focusable().focused($focused).focusEffectDisabled()
        .onAppear { focused = true }
        .onKeyPress(.space) { if started && !shown { shown = true; return .handled }; return .ignored }
        .onKeyPress(characters: CharacterSet(charactersIn: "1234")) { press in gradeKey(press.characters) }
    }

    /// 1–4 answer how well you knew the card, once its answer shows
    private func gradeKey(_ characters: String) -> KeyPress.Result {
        guard started, shown, let id = queue.first, let c = s.deck?.cards.first(where: { $0.id == id }), let n = Int(characters), let g = Grade(rawValue: n) else { return .ignored }
        answer(c, g); return .handled
    }

    /// how many cards are due, and Start
    @ViewBuilder private func startScreen(_ all: [Card], _ dueNow: [Card]) -> some View {
        Spacer()
        Image(systemName: "brain.head.profile").font(.system(size: 44)).foregroundStyle(Color.accentColor)
        Text(dueNow.isEmpty ? "All caught up" : "\(dueNow.count) card\(dueNow.count == 1 ? "" : "s") to review")
            .font(.system(size: 26, weight: .bold, design: .rounded))
        Text(summary(all)).foregroundStyle(.secondary).multilineTextAlignment(.center)
        if !dueNow.isEmpty {
            Button { start(dueNow) } label: { Text("Start").frame(width: 140) }.buttonStyle(.borderedProminent).controlSize(.large).keyboardShortcut(.defaultAction)
        } else if !all.isEmpty {
            Button("Study ahead anyway") { start(all.sorted { ($0.due ?? 0) < ($1.due ?? 0) }.prefix(20).map { $0 }) }
        }
        Spacer()
    }

    /// a card to remember, then its answer and how well you knew it
    @ViewBuilder private func review(_ c: Card) -> some View {
        Text("\(done) done · \(queue.count) left").font(.caption).foregroundStyle(.secondary)
        Spacer(minLength: 0)
        VStack(spacing: 18) {
            Text(c.term).font(.system(size: c.term.count > 80 ? 22 : 30, weight: .semibold, design: .rounded)).multilineTextAlignment(.center)
            if shown {
                Divider().frame(maxWidth: 300)
                Text(c.def).font(.system(size: c.def.count > 160 ? 17 : 21)).multilineTextAlignment(.center).textSelection(.enabled)
            }
        }
        .padding(36).frame(maxWidth: 760, minHeight: 260)
        .background(RoundedRectangle(cornerRadius: 22).fill(s.themePanel).shadow(color: .black.opacity(0.1), radius: 16, y: 6))
        Spacer(minLength: 0)
        answerButtons(c)
    }

    /// Show answer; then how well you knew it (each with when you'd see the card next)
    @ViewBuilder private func answerButtons(_ c: Card) -> some View {
        if shown {
            HStack(spacing: 12) {
                ForEach(Grade.allCases, id: \.self) { g in
                    Button { answer(c, g) } label: {
                        VStack(spacing: 2) { Text(g.label).fontWeight(.semibold); Text(c.preview(g)).font(.caption).foregroundStyle(.secondary) }.frame(width: 96)
                    }.controlSize(.large).tint(g == .again ? .red : g == .hard ? .orange : g == .good ? .green : .blue)
                }
            }
            Text("Keys 1 2 3 4").font(.caption).foregroundStyle(.secondary)
        } else {
            Button { shown = true } label: { Text("Show answer").frame(width: 180) }.buttonStyle(.borderedProminent).controlSize(.large)
            Text("Try to remember it first · Space to show").font(.caption).foregroundStyle(.secondary)
        }
    }

    /// the session's results
    @ViewBuilder private func sessionDone(_ all: [Card]) -> some View {
        Spacer()
        Image(systemName: "checkmark.seal.fill").font(.system(size: 48)).foregroundStyle(.green)
        Text("Session done").font(.system(size: 26, weight: .bold, design: .rounded))
        Text("\(done) answered, \(againCount) to go over again later.\n" + summary(all)).foregroundStyle(.secondary).multilineTextAlignment(.center)
        Button("Back") { started = false }.controlSize(.large)
        Spacer()
    }

    private func summary(_ all: [Card]) -> String {
        let new = all.filter(\.isNew).count, mastered = all.filter(\.mastered).count
        let next = all.compactMap(\.due).filter { $0 > Date().timeIntervalSince1970 }.min()
        var s = "\(new) new · \(all.count - new - mastered) learning · \(mastered) mastered"
        if let n = next { s += "\nNext review " + Date(timeIntervalSince1970: n).formatted(.relative(presentation: .named)) }
        return s
    }

    private func start(_ cs: [Card]) { queue = cs.prefix(30).map(\.id); started = true; shown = false; done = 0; againCount = 0; focused = true }

    private func answer(_ c: Card, _ g: Grade) {
        let (nc, again) = c.graded(g)
        if let i = s.deck?.cards.firstIndex(where: { $0.id == c.id }) { s.deck?.cards[i] = nc; s.saveDeckSoon() }
        queue.removeFirst()
        if again { queue.append(c.id); againCount += g == .again ? 1 : 0 }
        done += 1; shown = false
    }
}

// MARK: - test

struct TestMode: View {
    @EnvironmentObject var s: AppState
    struct Q: Identifiable { let id = UUID(); let card: Card; let choices: [String]?; var given: String? = nil; var correct: Bool? = nil }
    @State private var qs: [Q] = []
    @State private var at = 0
    @State private var typed = ""
    @State private var count = 20
    @State private var answerWithDef = true
    @State private var written = true
    @State private var multiple = true
    @FocusState private var typing: Bool

    var body: some View {
        let all = (s.deck?.cards ?? []).filter { !$0.isBlank }
        VStack(spacing: 18) {
            if qs.isEmpty {
                setup(all)
            } else if at < qs.count {
                question(qs[at])
            } else {
                results
            }
        }
        .padding(30)
    }

    private func setup(_ all: [Card]) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "checklist").font(.system(size: 42)).foregroundStyle(Color.accentColor)
            Text("Test yourself").font(.system(size: 26, weight: .bold, design: .rounded))
            Form {
                Stepper("Questions: \(min(count, all.count))", value: $count, in: 1...max(1, all.count))
                Picker("Answer with", selection: $answerWithDef) { Text("Definition").tag(true); Text("Term").tag(false) }
                Toggle("Written (type the answer)", isOn: $written)
                Toggle("Multiple choice", isOn: $multiple).disabled(all.count < 2)
            }.formStyle(.grouped).frame(maxWidth: 420).fixedSize(horizontal: false, vertical: true)
            Button { start(all) } label: { Text("Start test").frame(width: 160) }
                .buttonStyle(.borderedProminent).controlSize(.large).disabled(all.isEmpty || (!written && !(multiple && all.count >= 2)))
            Spacer()
        }
    }

    private func prompt(_ c: Card) -> String { answerWithDef ? c.term : c.def }
    private func answer(_ c: Card) -> String { answerWithDef ? c.def : c.term }

    private func question(_ q: Q) -> some View {
        VStack(spacing: 18) {
            ProgressView(value: Double(at), total: Double(qs.count)).frame(maxWidth: 600)
            Text("\(at + 1) of \(qs.count)").font(.caption).foregroundStyle(.secondary)
            Text(prompt(q.card)).font(.system(size: 26, weight: .semibold, design: .rounded)).multilineTextAlignment(.center)
                .padding(28).frame(maxWidth: 760, minHeight: 160)
                .background(RoundedRectangle(cornerRadius: 20).fill(s.themePanel))
            if let choices = q.choices { choiceList(q, choices) } else { writtenAnswer(q) }
            if let ok = q.correct { feedback(q, ok) }
            Spacer(minLength: 0)
        }
    }

    /// multiple choice: click one, or press its number
    private func choiceList(_ q: Q, _ choices: [String]) -> some View {
        VStack(spacing: 10) {
            ForEach(Array(choices.enumerated()), id: \.offset) { i, ch in
                Button { if q.correct == nil { mark(ch, ch == answer(q.card)) } } label: {
                    HStack(alignment: .top) { Text("\(i + 1)").foregroundStyle(.secondary).frame(width: 18); Text(ch).multilineTextAlignment(.leading); Spacer() }
                        .padding(12).frame(maxWidth: 640)
                        .background(RoundedRectangle(cornerRadius: 10).fill(tint(q, ch)))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.12)))
                }.buttonStyle(.plain).keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: [])
            }
        }
    }

    /// written: type the answer, then Check (or Don't know)
    @ViewBuilder private func writtenAnswer(_ q: Q) -> some View {
        TextField("Type the \(answerWithDef ? "definition" : "term")", text: $typed, axis: .vertical)
            .textFieldStyle(.roundedBorder).font(.system(size: 16)).frame(maxWidth: 640).lineLimit(1...5)
            .focused($typing).disabled(q.correct != nil)
            .onSubmit { if q.correct == nil { mark(typed, answerMatches(typed, answer(q.card))) } }
            .onAppear { typing = true }
        if q.correct == nil {
            HStack {
                Button("Don't know") { mark("", false) }
                Button("Check") { mark(typed, answerMatches(typed, answer(q.card))) }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
    }

    /// right or not (with the answer), and on to the next
    private func feedback(_ q: Q, _ ok: Bool) -> some View {
        VStack(spacing: 8) {
            Label(ok ? "Correct" : "Not quite", systemImage: ok ? "checkmark.circle.fill" : "xmark.circle.fill").font(.headline).foregroundStyle(ok ? .green : .red)
            if !ok { Text("Answer: \(answer(q.card))").multilineTextAlignment(.center).frame(maxWidth: 640) }
            HStack {
                if !ok && q.choices == nil { Button("I was right") { override() } }
                Button(at + 1 < qs.count ? "Next" : "See results") { typed = ""; at += 1 }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }
    }

    private func tint(_ q: Q, _ ch: String) -> Color {
        guard q.correct != nil else { return s.themePanel }
        if ch == answer(q.card) { return .green.opacity(0.25) }
        if ch == q.given { return .red.opacity(0.22) }
        return s.themePanel
    }

    private var results: some View {
        let right = qs.filter { $0.correct == true }.count
        let pct = qs.isEmpty ? 0 : Int((Double(right) / Double(qs.count) * 100).rounded())
        return ScrollView {
            VStack(spacing: 14) {
                Text("\(pct)%").font(.system(size: 56, weight: .heavy, design: .rounded)).foregroundStyle(pct >= 80 ? .green : pct >= 50 ? .orange : .red)
                Text("\(right) of \(qs.count) right").foregroundStyle(.secondary)
                let wrong = qs.filter { $0.correct == false }
                if !wrong.isEmpty { missed(wrong) }
                HStack {
                    Button("Retake") { start((s.deck?.cards ?? []).filter { !$0.isBlank }) }
                    if !wrong.isEmpty { Button("Test only the ones I missed") { begin(wrong.map(\.card)) } }
                    Button("Done") { qs = [] }.buttonStyle(.borderedProminent)
                }.padding(.top, 10)
            }.frame(maxWidth: .infinity).padding(.vertical, 20)
        }
    }

    /// the questions got wrong, with their answers and what you said
    @ViewBuilder private func missed(_ wrong: [Q]) -> some View {
        Text("To go over").font(.headline).padding(.top, 10)
        ForEach(wrong) { q in
            VStack(alignment: .leading, spacing: 4) {
                Text(prompt(q.card)).fontWeight(.semibold)
                Text(answer(q.card)).foregroundStyle(.secondary)
                if let g = q.given, !g.isEmpty { Text("You said: \(g)").font(.caption).foregroundStyle(.red) }
            }.padding(12).frame(maxWidth: 640, alignment: .leading).background(RoundedRectangle(cornerRadius: 10).fill(s.themePanel))
        }
    }

    private func start(_ all: [Card]) { begin(Array(all.shuffled().prefix(count))) }

    private func begin(_ cs: [Card]) {
        let pool = (s.deck?.cards ?? []).filter { !$0.isBlank }.map { answer($0) }
        qs = cs.map { c in
            let mc = multiple && pool.count >= 2 && (!written || Bool.random())
            if mc {
                let wrong = Array(Set(pool.filter { $0 != answer(c) }).shuffled().prefix(3))
                return Q(card: c, choices: (wrong + [answer(c)]).shuffled())
            }
            return Q(card: c, choices: nil)
        }
        at = 0; typed = ""
    }

    private func mark(_ given: String, _ ok: Bool) {
        qs[at].given = given; qs[at].correct = ok
        record(qs[at].card.id, ok)
    }

    private func override() {
        qs[at].correct = true
        if let i = s.deck?.cards.firstIndex(where: { $0.id == qs[at].card.id }) { s.deck?.cards[i].wrong = max(0, s.deck!.cards[i].wrong - 1); s.deck?.cards[i].right += 1; s.saveDeckSoon() }
    }

    private func record(_ id: String, _ ok: Bool) {
        if let i = s.deck?.cards.firstIndex(where: { $0.id == id }) { if ok { s.deck?.cards[i].right += 1 } else { s.deck?.cards[i].wrong += 1 }; s.saveDeckSoon() }
    }
}

// MARK: - confidence suggestions

struct SuggestionsSheet: View {
    @EnvironmentObject var s: AppState
    @Environment(\.dismiss) private var dismiss
    let list: [PointSuggestion]
    @State private var applied: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Confidence suggestions").font(.title2.weight(.bold))
            Text("From how you did on each spec point's cards (three answers or more). Nothing changes until you apply it.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(list) { sg in suggestionRow(sg) }
                }
            }.frame(minHeight: 160, maxHeight: 360)
            HStack {
                Button("Apply all") { apply(list) }.disabled(applied.count == list.count)
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(22).frame(width: 620)
    }

    /// the point, how you did, its rating now and suggested, and Apply
    private func suggestionRow(_ sg: PointSuggestion) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(sg.code.isEmpty ? sg.text : "\(sg.code)  \(sg.text)").lineLimit(2)
                Text("\(Int((sg.accuracy * 100).rounded()))% right over \(sg.attempts) answers").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            rating(sg.current); Image(systemName: "arrow.right").foregroundStyle(.secondary); rating(sg.suggested)
            Button(applied.contains(sg.id) ? "Applied" : "Apply") { apply([sg]) }.disabled(applied.contains(sg.id))
        }.padding(10).background(RoundedRectangle(cornerRadius: 8).fill(s.themePanel))
    }

    private func rating(_ n: Int) -> some View {
        Text(n == 0 ? "–" : "\(n)").font(.system(size: 12, weight: .bold)).frame(width: 22, height: 22)
            .background(Circle().fill(confidenceColor(n).opacity(0.85)))
    }

    private func apply(_ list: [PointSuggestion]) {
        let todo = list.filter { !applied.contains($0.id) }
        guard let p = s.deckProject, let sid = s.deck?.syllabus, !todo.isEmpty else { return }
        // through change(), so an open notebook following this syllabus is saved first and then reloaded with the new ratings
        s.session.change([p]) { for sg in todo { s.workspace.setRating(sg.id, sg.suggested, syllabus: sid, in: p) } }
        applied.formUnion(todo.map(\.id))
    }
}
