import Foundation
import Vision
import AppKit
// usage: swift ocr-macos.swift <png>...  → one JSON line per image: {"path":..,"text":..,"ms":..}
// Failures print {"path":..,"error":..} (no "text"), so the caller neither uses nor caches them.
func emitError(_ path: String, _ error: String) {
  let data = try! JSONSerialization.data(withJSONObject: ["path": path, "error": error])
  print(String(data: data, encoding: .utf8)!)
}
for path in CommandLine.arguments.dropFirst() {
  let t0 = Date()
  guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { emitError(path, "load"); continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = (ProcessInfo.processInfo.environment["OCR_LEVEL"] == "fast" ? .fast : .accurate)
  req.usesLanguageCorrection = false
  do {
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  } catch {
    emitError(path, "recognition")
    continue
  }
  let text = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  let ms = Int(Date().timeIntervalSince(t0) * 1000)
  let obj: [String: Any] = ["path": path, "text": text, "ms": ms]
  let data = try! JSONSerialization.data(withJSONObject: obj)
  print(String(data: data, encoding: .utf8)!)
}
