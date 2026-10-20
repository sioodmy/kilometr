import Foundation
import zlib

@main
struct OfflineTests {
  static func main() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let raw = Data("kilometr offline tile".utf8)
    let gzip = dir.appendingPathComponent("tile with space.gz")
    let file = gzopen(gzip.path, "wb")!
    raw.withUnsafeBytes { bytes in
      precondition(Int(gzwrite(file, bytes.baseAddress, UInt32(bytes.count))) == raw.count)
    }
    precondition(gzclose(file) == Z_OK)
    let compressed = try Data(contentsOf: gzip)
    precondition(OfflineFiles.gunzip(compressed) == raw)
    precondition(OfflineFiles.gunzip(Data(compressed.dropLast(8))) == nil)
    let output = dir.appendingPathComponent("output.db")
    precondition(OfflineFiles.decompressFile(gzip.absoluteString, to: output.absoluteString))
    let decompressed = try Data(contentsOf: output)
    precondition(decompressed == raw)

    for version in [1, 2] {
      let payload = version == 1 ? raw : compressed
      var bytes = Data("KMTP".utf8)
      func append(_ value: UInt64, count: Int) {
        for i in 0..<count { bytes.append(UInt8(truncatingIfNeeded: value >> (8 * i))) }
      }
      append(UInt64(version), count: 4)
      append(1, count: 4)
      append(14, count: 4)
      bytes.append(Data(repeating: 0, count: 16))
      append(50, count: 8)
      append(UInt64(payload.count), count: 4)
      append(14, count: 1)
      append(8967, count: 2)
      append(5477, count: 2)
      append(0, count: 1)
      bytes.append(payload)
      let pack = dir.appendingPathComponent("test-tiles.ktp")
      try bytes.write(to: pack)
      let tile = try TilePack.read(pack, z: 14, x: 8967, y: 5477)
      precondition(tile?.data == payload)
      precondition(tile?.compressed == (version == 2))
      let missing = try TilePack.read(pack, z: 14, x: 8968, y: 5477)
      precondition(missing == nil)
      try bytes.prefix(48).write(to: pack)
      let truncated = try TilePack.read(pack, z: 14, x: 8967, y: 5477)
      precondition(truncated == nil)
    }
    print("PASS: iOS KMTP v1/v2, missing/truncated tiles, gzip and file URLs")
  }
}
