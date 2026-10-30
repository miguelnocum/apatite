import AppKit
// Draws the app icon: the Apatite logo on a white macOS-style rounded tile, or, with "full", artwork
// that is already its own tile, placed on Apple's icon grid with the same soft shadow.
// Usage: swift tools/make_icon.swift Resources/logo.png build/AppIcon.iconset [full] && iconutil -c icns build/AppIcon.iconset -o Resources/AppIcon.icns
let logo = NSImage(contentsOfFile: CommandLine.arguments[1])!
let full = CommandLine.arguments.count > 3 && CommandLine.arguments[3] == "full"

func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    // sRGB, so the logo's colours come out as designed rather than display-tinted
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!.retagging(with: .sRGB)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    // tile on Apple's icon grid: 100/1024 margin, soft drop shadow
    let inset = s * 100 / 1024
    let tileRect = NSRect(x: inset, y: inset, width: s - 2*inset, height: s - 2*inset)
    let tile = NSBezierPath(roundedRect: tileRect, xRadius: tileRect.width * 0.225, yRadius: tileRect.width * 0.225)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor(white: 0, alpha: 0.28)
    shadow.shadowBlurRadius = s * 0.02
    shadow.shadowOffset = NSSize(width: 0, height: -s * 0.008)
    shadow.set()
    if full {
        // artwork that is its own tile: clip it to its rounded shape (dropping any white corners), with the shadow
        let shape = NSBezierPath(roundedRect: tileRect, xRadius: tileRect.width * 0.28, yRadius: tileRect.width * 0.28)
        NSColor.white.setFill(); shape.fill()
        NSGraphicsContext.restoreGraphicsState()
        NSGraphicsContext.saveGraphicsState()
        shape.addClip()
        logo.draw(in: tileRect.insetBy(dx: -tileRect.width * 0.004, dy: -tileRect.width * 0.004))
        NSGraphicsContext.restoreGraphicsState()
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])!
    }
    NSColor.white.setFill(); tile.fill()
    NSGraphicsContext.restoreGraphicsState()
    // logo, centred, keeping its proportions
    let box = tileRect.insetBy(dx: tileRect.width * 0.15, dy: tileRect.width * 0.15)
    let sz = logo.size, k = min(box.width / sz.width, box.height / sz.height)
    let w = sz.width * k, h = sz.height * k
    logo.draw(in: NSRect(x: box.midX - w/2, y: box.midY - h/2, width: w, height: h))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}
let dir = URL(fileURLWithPath: CommandLine.arguments[2])
try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
for (name, px) in [("16x16",16),("16x16@2x",32),("32x32",32),("32x32@2x",64),("128x128",128),("128x128@2x",256),("256x256",256),("256x256@2x",512),("512x512",512),("512x512@2x",1024)] {
    try! render(px).write(to: dir.appendingPathComponent("icon_\(name).png"))
}
