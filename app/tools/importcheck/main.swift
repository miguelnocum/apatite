import Foundation

// Prints what EssayImport makes of each file, to compare two versions of it.
for path in CommandLine.arguments.dropFirst() {
    do {
        let result = try EssayImport.convert(URL(fileURLWithPath: path))
        print("== \((path as NSString).lastPathComponent)\ntitle: \(result.title)\n\(result.html)")
    } catch { print("== \((path as NSString).lastPathComponent)\nFAILED \(error.localizedDescription)") }
}
