import AppKit

// What the app's own test runs (app/tools/regress.sh, focusshots.sh, shotcompare.sh and perf/bench.sh) need from the rest of
// the app. The tests themselves (TestRun.swift, Tests*.swift and ViewShots.swift) are compiled only with the
// APATITE_TESTS condition, which build.sh sets for APATITE_TESTS=1; a normal build has none of them, and these
// hooks do nothing.

#if APATITE_TESTS

/// runs the suite the environment asks for, if any, and opens the screen a screenshot test asks for
@MainActor func runRequestedTests(testing: Bool) {
    SelfTest.runIfRequested(); ProjectTest.runIfRequested(); ImportTest.runIfRequested(); ReaderTest.runIfRequested(); FolderTest.runIfRequested(); WindowTest.runIfRequested(); LinkTest.runIfRequested(); PerfTest.runIfRequested(); OrgTest.runIfRequested(); DeckTest.runIfRequested(); ViewShots.runIfRequested(); FocusTest.runIfRequested()
    if testing { openTestScreen() }
}

/// for screenshots in tests: open straight onto a screen (APATITE_SCREEN), and picture the window (APATITE_SNAPSHOT)
@MainActor private func openTestScreen() {
    let env = ProcessInfo.processInfo.environment
    if let sc = env["APATITE_SCREEN"].flatMap(Screen.init(rawValue:)) { AppState.shared.navigation.screen = sc }
    guard let out = env["APATITE_SNAPSHOT"] else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        // the window draws itself into a PNG (no screen-recording permission needed)
        guard let v = NSApp.windows.first(where: { $0.isVisible })?.contentView?.superview,
              let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) else { return }
        v.cacheDisplay(in: v.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: out))
        quitAfterTest()
    }
}

/// Timing marks for the performance test (no-ops otherwise).
@MainActor var perfMarks: [String] = []
@MainActor private var perfLast = Date()
@MainActor func perfPersist(_ started: Date, kb: Int) {
    guard ProcessInfo.processInfo.environment["APATITE_PERFTEST"] != nil else { return }
    perfMarks.append(String(format: "   persist %.1f ms for %d KB", Date().timeIntervalSince(started) * 1000, kb))
}
@MainActor func perfMark(_ label: String) {
    guard ProcessInfo.processInfo.environment["APATITE_PERFTEST"] != nil else { return }
    perfMarks.append(String(format: "   %5.0f ms  %@", Date().timeIntervalSince(perfLast) * 1000, label)); perfLast = Date()
}

#else

@MainActor func runRequestedTests(testing: Bool) {}
@MainActor @inline(__always) func perfPersist(_ started: Date, kb: Int) {}
@MainActor @inline(__always) func perfMark(_ label: String) {}

#endif
