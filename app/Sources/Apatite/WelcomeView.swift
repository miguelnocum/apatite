import SwiftUI

enum WelcomeTitles {
    static let all = [
        "Hello again, Trace.",
        "Kettle on?",
        "Let's make something.",
        "Oh good, you're here.",
        "Right, where were we?",
        "Pull up a chair.",
        "Fancy seeing you here.",
        "Ready when you are.",
        "What's the plan today?",
        "Welcome back, bookworm.",
        "Snacks? Check. Let's go.",
        "One good paragraph at a time.",
        "Today feels like a writing day.",
        "Look who it is!",
    ]

    static func random(excluding current: String? = nil) -> String {
        all.filter { $0 != current }.randomElement() ?? all[0]
    }
}

/// One of the four doors on the welcome page.
struct Destination: Identifiable {
    let id: String
    let title: String
    let blurb: String
    let icon: String
    let colors: [Color]
    let key: KeyEquivalent
    let action: @MainActor (AppState) -> Void

    static let all: [Destination] = [
        Destination(id: "notes", title: "Notes", blurb: "Syllabus, notes & works cited", icon: "square.and.pencil",
                    colors: [Color(red: 1.00, green: 0.45, blue: 0.38), Color(red: 0.93, green: 0.24, blue: 0.42)],
                    key: "1") { $0.openNotes() },
        Destination(id: "essay", title: "Essay", blurb: "Draft and shape your writing", icon: "text.quote",
                    colors: [Color(red: 0.62, green: 0.40, blue: 1.00), Color(red: 0.40, green: 0.26, blue: 0.88)],
                    key: "2") { $0.openEssay() },
        Destination(id: "database", title: "Database", blurb: "Where everything lives", icon: "archivebox",
                    colors: [Color(red: 0.13, green: 0.78, blue: 0.70), Color(red: 0.05, green: 0.55, blue: 0.62)],
                    key: "3") { $0.navigation.screen = .database },
        Destination(id: "read", title: "Read", blurb: "Your PDF library", icon: "books.vertical",
                    colors: [Color(red: 1.00, green: 0.76, blue: 0.20), Color(red: 0.98, green: 0.52, blue: 0.14)],
                    key: "4") { $0.navigation.openReader() },
    ]
}

struct WelcomeView: View {
    @EnvironmentObject var s: AppState
    @State private var shown = false
    /// the desk scene is full size from this window height, and gone (the small logo instead) much below it
    static let fullSceneHeight: CGFloat = 720, sceneShrinkRange: CGFloat = 220
    static let titleColours = [Color(red: 0.16, green: 0.78, blue: 0.55), Color(red: 0.20, green: 0.52, blue: 0.92)]

    var body: some View {
        GeometryReader { geo in
            // the desk scene shrinks to fit the window; only on a very short one does the small logo stand in
            let k = min(1, max(0, (geo.size.height - (Self.fullSceneHeight - Self.sceneShrinkRange)) / Self.sceneShrinkRange))
            let roomy = k >= 0.4
            VStack(spacing: roomy ? 34 : 44) {
                Spacer()
                VStack(spacing: roomy ? 14 : 22) {
                    picture(k, roomy: roomy)
                    title
                }
                destinations
                Spacer()
                keysHint
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(s.themeBG)
        .onAppear { withAnimation(.easeOut(duration: 0.45)) { shown = true } }
    }

    private var keysHint: some View {
        Text("Press 1–4 to jump in · ⇧⌘0 brings you back here")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.bottom, 22)
    }

    /// the desk scene, scaled to fit; or, in a short window, the logo
    @ViewBuilder private func picture(_ k: CGFloat, roomy: Bool) -> some View {
        if roomy && DeskScene.available {
            DeskScene(shown: shown)
                .scaleEffect(k)
                .frame(width: 360 * k, height: 200 * k)
                .accessibilityLabel("Apatite")
        } else if let logo = Bundle.main.url(forResource: "logo", withExtension: "png").flatMap(NSImage.init(contentsOf:)) {
            Image(nsImage: logo)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(height: 64)
                .accessibilityLabel("Apatite")
                .opacity(shown ? 1 : 0)
                .scaleEffect(shown ? 1 : 0.85)
        }
    }

    private var title: some View {
        Text(s.navigation.welcomeTitle)
            .font(.system(size: 54, weight: .heavy, design: .rounded))
            .multilineTextAlignment(.center)
            .foregroundStyle(LinearGradient(colors: Self.titleColours, startPoint: .leading, endPoint: .trailing))
            .padding(.horizontal, 40)
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 12)
    }

    /// the four places to go, rising in one after another
    private var destinations: some View {
        HStack(spacing: 22) {
            ForEach(Array(Destination.all.enumerated()), id: \.element.id) { i, d in
                DestinationCard(d: d)
                    .opacity(shown ? 1 : 0)
                    .offset(y: shown ? 0 : 24)
                    .animation(.spring(response: 0.5, dampingFraction: 0.75).delay(0.08 * Double(i + 1)), value: shown)
            }
        }
        .padding(.horizontal, 40)
    }
}

/// The welcome page's little desk: a blank sheet and a written page behind, the notebook in front,
/// a pencil leaning across. The pieces drop in one by one, drift gently, and fan out under the pointer.
struct DeskScene: View {
    let shown: Bool
    @State private var drift = false
    @State private var hover = false

    private static func art(_ name: String) -> NSImage? {
        Bundle.main.url(forResource: "welcome-" + name, withExtension: "png").flatMap(NSImage.init(contentsOf:))
    }
    static var available: Bool { art("notebook") != nil }

    private struct Piece { let name: String; let height: CGFloat; let x: CGFloat; let y: CGFloat; let tilt: Double; let fanX: CGFloat; let fanTilt: Double; let delay: Double; let phase: CGFloat }
    private let pieces: [Piece] = [
        Piece(name: "sheet",    height: 150, x: -92, y: 6,   tilt: -11, fanX: -14, fanTilt: -4, delay: 0.00, phase: 3),
        Piece(name: "page",     height: 152, x: 88,  y: 2,   tilt: 9,   fanX: 15,  fanTilt: 4,  delay: 0.08, phase: -4),
        Piece(name: "notebook", height: 182, x: -8,  y: 0,   tilt: -3,  fanX: 0,   fanTilt: -1, delay: 0.16, phase: 5),
        Piece(name: "pencil",   height: 112, x: 118, y: 40,  tilt: 4,   fanX: 18,  fanTilt: 8,  delay: 0.26, phase: -6),
    ]

    var body: some View {
        ZStack {
            ForEach(pieces, id: \.name) { p in
                if let img = Self.art(p.name) { piece(p, img) }
            }
        }
        .frame(width: 360, height: 200)
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { drift = true } }
    }

    /// a piece in its place: it drops in, drifts, and fans out under the pointer
    private func piece(_ p: Piece, _ img: NSImage) -> some View {
        Image(nsImage: img)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(height: p.height)
            .rotationEffect(.degrees(p.tilt + (hover ? p.fanTilt : 0)))
            .offset(x: p.x + (hover ? p.fanX : 0),
                    y: p.y + (drift ? p.phase : -p.phase) * 0.6 + (hover && p.name == "pencil" ? -8 : 0))
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : -28)
            .animation(.spring(response: 0.6, dampingFraction: 0.7).delay(p.delay), value: shown)
            .animation(.spring(response: 0.45, dampingFraction: 0.65), value: hover)
            .animation(.easeInOut(duration: 3.2).repeatForever(autoreverses: true), value: drift)
    }
}

struct DestinationCard: View {
    @EnvironmentObject var s: AppState
    let d: Destination
    @State private var hover = false

    var body: some View {
        Button { d.action(s) } label: {
            face
                .foregroundStyle(.white)
                .padding(22)
                .frame(width: 200, height: 220, alignment: .leading)
                .background(LinearGradient(colors: d.colors, startPoint: .topLeading, endPoint: .bottomTrailing))
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .shadow(color: d.colors[1].opacity(hover ? 0.45 : 0.22), radius: hover ? 22 : 10, y: hover ? 12 : 5)
                .scaleEffect(hover ? 1.04 : 1)
                .rotationEffect(.degrees(hover ? -1.2 : 0))
                .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(.plain)
        .keyboardShortcut(d.key, modifiers: [])
        .onHover { h in withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { hover = h } }
        .help("Open \(d.title) (\(String(d.key.character)))")
    }

    /// its icon, name and what it's for
    private var face: some View {
        VStack(alignment: .leading, spacing: 0) {
            Image(systemName: d.icon)
                .font(.system(size: 38, weight: .semibold))
            Spacer()
            Text(d.title)
                .font(.system(size: 28, weight: .bold, design: .rounded))
            Text(d.blurb)
                .font(.system(size: 13, weight: .medium))
                .opacity(0.85)
                .padding(.top, 2)
        }
    }
}
