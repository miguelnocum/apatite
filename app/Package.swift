// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Apatite",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "Apatite",
            path: "Sources/Apatite",
            linkerSettings: [.linkedFramework("PDFKit"), .linkedFramework("WebKit")]
        )
    ]
)
