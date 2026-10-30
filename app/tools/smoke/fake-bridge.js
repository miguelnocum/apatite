/* A stand-in for the Mac app's side of the page, so the smoke test can run the NATIVE code path in a browser
   (serve.py puts this, and the fixture as window.__FIXTURE__, at the top of notebook.html when it is asked for under
   /native/). It does what the app's boot script does before the page's own scripts run (AppState.bootScript):
   window.webkit.messageHandlers.nb.postMessage (here a recorder, in window.__posted) and the window.__NB__ etc. the
   page reads. The page cannot tell it from WKWebView, apart from what a browser does and the app's view of it:
   the app never answers a message here, and its window, PDF reader and menus are not there. */
(function () {
  window.__posted = [];
  window.webkit = {
    messageHandlers: {
      nb: {
        postMessage: function (message) {
          /* WKWebView hands the app a copy made by structured clone, so what can't be copied is an error there too */
          window.__posted.push(JSON.parse(JSON.stringify(message)));
        }
      }
    }
  };
  Object.keys(window.__FIXTURE__).forEach(function (name) {
    window[name] = JSON.parse(JSON.stringify(window.__FIXTURE__[name]));
  });
})();
