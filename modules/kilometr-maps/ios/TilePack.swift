import Foundation
import zlib

public struct PackedTile {
  public let data: Data
  public let compressed: Bool
}

public enum OfflineFiles {
  public static var maps: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("maps", isDirectory: true)
  }

  public static func tile(z: Int, x: Int, y: Int) -> PackedTile? {
    let files = (try? FileManager.default.contentsOfDirectory(at: maps, includingPropertiesForKeys: nil)) ?? []
    for url in files.filter({ $0.lastPathComponent.hasSuffix("-tiles.ktp") }).sorted(by: { $0.path < $1.path }) {
      if let tile = try? TilePack.read(url, z: z, x: x, y: y) { return tile }
    }
    return nil
  }

  public static func gunzip(_ data: Data) -> Data? {
    var stream = z_stream()
    guard inflateInit2_(&stream, 15 + 32, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { return nil }
    defer { inflateEnd(&stream) }
    return data.withUnsafeBytes { source -> Data? in
      stream.next_in = UnsafeMutablePointer(mutating: source.bindMemory(to: UInt8.self).baseAddress)
      stream.avail_in = uInt(data.count)
      var output = Data()
      var buffer = [UInt8](repeating: 0, count: 65_536)
      var status: Int32 = Z_OK
      repeat {
        let written = buffer.withUnsafeMutableBytes { dest -> Int in
          stream.next_out = dest.bindMemory(to: UInt8.self).baseAddress
          stream.avail_out = uInt(dest.count)
          status = inflate(&stream, Z_NO_FLUSH)
          return dest.count - Int(stream.avail_out)
        }
        guard status == Z_OK || status == Z_STREAM_END else { return nil }
        output.append(contentsOf: buffer.prefix(written))
        guard output.count <= 32 * 1024 * 1024 else { return nil }
      } while status != Z_STREAM_END
      return output
    }
  }

  public static func decompressFile(_ source: String, to destination: String) -> Bool {
    let src = URL(string: source)?.isFileURL == true ? URL(string: source)! : URL(fileURLWithPath: source)
    let dst = URL(string: destination)?.isFileURL == true ? URL(string: destination)! : URL(fileURLWithPath: destination)
    let temp = dst.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
    guard let input = gzopen(src.path, "rb") else { return false }
    defer { gzclose(input); try? FileManager.default.removeItem(at: temp) }
    do {
      try FileManager.default.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
      guard FileManager.default.createFile(atPath: temp.path, contents: nil) else { return false }
      let output = try FileHandle(forWritingTo: temp)
      defer { try? output.close() }
      var buffer = [UInt8](repeating: 0, count: 65_536)
      while true {
        let count = gzread(input, &buffer, UInt32(buffer.count))
        if count < 0 { return false }
        if count == 0 { break }
        try output.write(contentsOf: Data(buffer.prefix(Int(count))))
      }
      var error: Int32 = 0
      _ = gzerror(input, &error)
      guard error == Z_OK || error == Z_STREAM_END else { return false }
      try output.synchronize()
      if FileManager.default.fileExists(atPath: dst.path) {
        _ = try FileManager.default.replaceItemAt(dst, withItemAt: temp)
      } else {
        try FileManager.default.moveItem(at: temp, to: dst)
      }
      return true
    } catch { return false }
  }
}

enum TilePack {
  static func read(_ url: URL, z: Int, x: Int, y: Int) throws -> PackedTile? {
    let file = try FileHandle(forReadingFrom: url)
    defer { try? file.close() }
    let size = try file.seekToEnd()
    try file.seek(toOffset: 0)
    guard let header = try file.read(upToCount: 32), header.count == 32,
          header.prefix(4) == Data("KMTP".utf8) else { return nil }
    let version = number(header, 4, 4)
    let count = number(header, 8, 4)
    guard (version == 1 || version == 2), count <= (size - 32) / 18 else { return nil }
    var lo = 0
    var hi = Int(count) - 1
    while lo <= hi {
      let mid = (lo + hi) / 2
      try file.seek(toOffset: UInt64(32 + mid * 18))
      guard let entry = try file.read(upToCount: 18), entry.count == 18 else { return nil }
      let key = [Int(number(entry, 12, 1)), Int(number(entry, 13, 2)), Int(number(entry, 15, 2))]
      let target = [z, x, y]
      if key == target {
        let offset = number(entry, 0, 8)
        let length = number(entry, 8, 4)
        guard offset >= 32 + count * 18, offset <= size, length <= size - offset,
              length > 0, length <= 32 * 1024 * 1024 else { return nil }
        try file.seek(toOffset: offset)
        guard let data = try file.read(upToCount: Int(length)), data.count == Int(length) else { return nil }
        return PackedTile(data: data, compressed: version == 2)
      }
      if key.lexicographicallyPrecedes(target) { lo = mid + 1 } else { hi = mid - 1 }
    }
    return nil
  }

  private static func number(_ data: Data, _ offset: Int, _ count: Int) -> UInt64 {
    (0..<count).reduce(0) { $0 | UInt64(data[offset + $1]) << ($1 * 8) }
  }
}
