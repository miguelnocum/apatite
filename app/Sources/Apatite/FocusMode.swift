import AppKit
import SwiftUI
import WebKit

/// Focus mode, as in Bear: the page shows just the notes and its formatting bar, and the window follows it. Its toolbar
/// and the reader pane go, the page runs up under the title bar (the traffic lights float over it, and the page fades its
/// text out under them once scrolled), and the window can be made narrow enough to sit beside a lecture, flash cards or
/// a paper. The page keeps the setting; ⇧⌘F or its bar's button.
extension NavigationModel {
    /// focus mode on, and the notes showing (it doesn't apply to the welcome page, the database or a deck)
    var focusActive: Bool { focusMode && screen == .workspace }

    /// the page says focus mode is on or off, and what colour it is
    func setFocusMode(_ on: Bool, bg: String?) {
        if on != focusMode { focusMode = on }
        if bg != focusBG { focusBG = bg }
    }
}

extension AppState {
    /// View ▸ Focus Mode: the page turns it on or off, and tells the window
    func toggleFocus() {
        if navigation.screen != .workspace { openNotes() }
        page.toggleFocus()
    }
}

extension View {
    /// in focus mode: the window's title bar see-through with the page up under it, and a strip along the top to drag
    /// the window by
    func focusChrome(_ state: AppState) -> some View {
        ignoresSafeArea(.container, edges: state.navigation.focusActive ? .top : [])
            .overlay(alignment: .top) {
                if state.navigation.focusActive { WindowDragStrip().frame(height: 28).ignoresSafeArea(.container, edges: .top) }
            }
            .background(FocusWindowChrome(on: state.navigation.focusActive, bg: state.navigation.focusBG.flatMap { NSColor(hex: $0) },
                                          web: state.session.webView,
                                          themeBG: state.theme.flatMap { NSColor(hex: $0.bg) } ?? .windowBackgroundColor))
    }
}

/// Sets the window up for focus mode, on the window itself rather than through SwiftUI's toolbar hiding (which takes
/// the traffic lights with it and leaves a blank title bar). It's applied again whenever SwiftUI updates the view, so
/// SwiftUI's own changes to the window can't undo it.
struct FocusWindowChrome: NSViewRepresentable {
    var on: Bool
    var bg: NSColor?
    var web: WKWebView?
    var themeBG: NSColor

    func makeNSView(context: Context) -> ChromeView { ChromeView() }

    func updateNSView(_ view: ChromeView, context: Context) {
        view.on = on
        view.bg = on ? bg ?? themeBG : themeBG
        view.web = web
        DispatchQueue.main.async { view.apply() }
    }

    final class ChromeView: NSView {
        var on = false
        var bg: NSColor = .windowBackgroundColor
        weak var web: WKWebView?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            apply()
        }

        func apply() {
            guard let window else { return }
            window.toolbar?.isVisible = !on
            window.titleVisibility = on ? .hidden : .visible
            window.titlebarAppearsTransparent = on
            if on { window.styleMask.insert(.fullSizeContentView) }
            for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
                window.standardWindowButton(button)?.isHidden = false
            }
            window.backgroundColor = bg
            if let web { underTitleBar(web) }
        }

        /// the page right up under the title bar, in its own colour: a web view otherwise moves its content down out
        /// from under a see-through title bar, and shows white where it was
        private func underTitleBar(_ web: WKWebView) {
            web.underPageBackgroundColor = on ? bg : nil
            if web.responds(to: NSSelectorFromString("_setAutomaticallyAdjustsContentInsets:")) {
                web.setValue(!on, forKey: "automaticallyAdjustsContentInsets")
            }
            if on, web.responds(to: NSSelectorFromString("_setTopContentInset:")) {
                web.setValue(0, forKey: "topContentInset")
            }
            #if compiler(>=6.2)   // macOS 26 SDK; the older command line tools don't have obscuredContentInsets
            if #available(macOS 26.0, *), on { web.obscuredContentInsets = NSEdgeInsetsZero }
            #endif
        }
    }
}

/// The top of the window, over the page, in focus mode: drags the window (a double click zooms it), as a title bar would.
/// The traffic lights stay above it.
struct WindowDragStrip: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { DragView() }
    func updateNSView(_ view: NSView, context: Context) {}

    final class DragView: NSView {
        override var mouseDownCanMoveWindow: Bool { true }
        override func mouseDown(with event: NSEvent) {
            if event.clickCount == 2 { window?.performZoom(nil) } else { window?.performDrag(with: event) }
        }
    }
}
