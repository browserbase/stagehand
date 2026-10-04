import Foundation
import Vision
import AppKit
// usage: ocr <png>...  → one JSON line per image: {"path":..,"text":..,"ms":..}
for path in CommandLine.arguments.dropFirst() {
  let t0 = Date()
  guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("{\"path\":\"\(path)\",\"error\":\"load\"}"); continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = (ProcessInfo.processInfo.environment["OCR_LEVEL"] == "fast" ? .fast : .accurate)
  req.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  let text = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  let ms = Int(Date().timeIntervalSince(t0) * 1000)
  let obj: [String: Any] = ["path": path, "text": text, "ms": ms]
  let data = try! JSONSerialization.data(withJSONObject: obj)
  print(String(data: data, encoding: .utf8)!)
}
