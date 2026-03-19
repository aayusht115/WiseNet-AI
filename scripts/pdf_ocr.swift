import AppKit
import Foundation
import PDFKit
import Vision

struct OCRPage: Codable {
  let pageNumber: Int
  let pdfText: String
  let ocrText: String
}

struct OCRPayload: Codable {
  let pageCount: Int
  let pages: [OCRPage]
}

func normalize(_ value: String) -> String {
  value
    .replacingOccurrences(of: "\r\n", with: "\n")
    .replacingOccurrences(of: "\r", with: "\n")
    .replacingOccurrences(of: "\u{0000}", with: " ")
    .replacingOccurrences(of: #"[ \t]+"#, with: " ", options: .regularExpression)
    .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
}

func renderPage(_ page: PDFPage, scale: CGFloat = 2.0) -> CGImage? {
  let bounds = page.bounds(for: .mediaBox)
  let width = max(Int(bounds.width * scale), 1)
  let height = max(Int(bounds.height * scale), 1)

  guard
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
    let context = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else {
    return nil
  }

  context.setFillColor(NSColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.saveGState()
  context.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context)
  context.restoreGState()
  return context.makeImage()
}

func recognizeText(from image: CGImage) -> String {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.minimumTextHeight = 0.01
  request.recognitionLanguages = ["en-US"]

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  do {
    try handler.perform([request])
  } catch {
    return ""
  }

  let lines = (request.results ?? [])
    .compactMap { observation in
      observation.topCandidates(1).first?.string
    }
    .map(normalize)
    .filter { !$0.isEmpty }

  return lines.joined(separator: "\n")
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  fputs("Usage: pdf_ocr.swift <pdf-path> [max-pages]\n", stderr)
  exit(64)
}

let pdfPath = args[1]
let maxPages = args.count >= 3 ? max(Int(args[2]) ?? 18, 1) : 18
let fileURL = URL(fileURLWithPath: pdfPath)

guard let document = PDFDocument(url: fileURL) else {
  fputs("Could not open PDF.\n", stderr)
  exit(66)
}

let pageCount = min(document.pageCount, maxPages)
var pages: [OCRPage] = []

for index in 0..<pageCount {
  guard let page = document.page(at: index) else { continue }
  let pdfText = normalize(page.string ?? "")
  var ocrText = ""
  if let image = renderPage(page) {
    ocrText = normalize(recognizeText(from: image))
  }

  if !pdfText.isEmpty || !ocrText.isEmpty {
    pages.append(
      OCRPage(
        pageNumber: index + 1,
        pdfText: pdfText,
        ocrText: ocrText
      )
    )
  }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let payload = OCRPayload(pageCount: pageCount, pages: pages)

do {
  let data = try encoder.encode(payload)
  FileHandle.standardOutput.write(data)
} catch {
  fputs("Could not encode OCR payload.\n", stderr)
  exit(70)
}
