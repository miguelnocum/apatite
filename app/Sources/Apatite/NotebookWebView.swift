import SwiftUI
import WebKit

/// The Syllabus / Notes / Works Cited screens, reused from the web version.
struct NotebookWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        AppState.shared.webView ?? WKWebView()
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    private static let handler = Handler()

    /// The page's settings: the boot script, the "nb" message handler, the inspector.
    @MainActor private static func configuration() -> WKWebViewConfiguration {
        let ucc = WKUserContentController()
        // Hand the open project's notebook, essays and Works Cited to the page before any of its scripts run.
        ucc.addUserScript(WKUserScript(source: AppState.shared.bootScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.add(handler, name: "nb")

        let cfg = WKWebViewConfiguration()
        cfg.userContentController = ucc
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        // test runs keep their page settings (theme, font, zoom) to themselves, away from the real app's
        if ProcessInfo.processInfo.environment["APATITE_LIBRARY"] != nil { cfg.websiteDataStore = .nonPersistent() }
        return cfg
    }

    /// Built once, at launch, and kept by AppState.
    @MainActor static func makeWebView() -> WKWebView {
        let web = WKWebView(frame: .zero, configuration: configuration())
        web.navigationDelegate = handler
        web.uiDelegate = handler
        web.allowsMagnification = false // pinch zooms the page itself (see applyZoom in notebook.html)
        if let url = Bundle.main.url(forResource: "notebook", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            web.loadHTMLString("<p style='font:15px -apple-system;padding:40px'>notebook.html is missing from the app bundle.</p>", baseURL: nil)
        }
        return web
    }

    /// Loads the page again with a new boot script (another project or notebook).
    @MainActor static func reload(_ web: WKWebView, boot: String) {
        let ucc = web.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let url = Bundle.main.url(forResource: "notebook", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    final class Handler: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let decoded = PageMessage(body) else { return }
            Task { @MainActor in AppState.shared.receive(decoded) }
        }

        // Links in notes open in the default browser (or mail…), never inside the app: the page itself never navigates away.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .linkActivated, let url = action.request.url {
                let here = webView.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
                var there = URLComponents(url: url, resolvingAgainstBaseURL: false)
                there?.fragment = here?.fragment
                if url.fragment != nil, there == here { decisionHandler(.allow); return }  // a jump within the page
                if url.scheme != "file" { NSWorkspace.shared.open(url) }
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { NSWorkspace.shared.open(url) }
            return nil
        }
    }
}
