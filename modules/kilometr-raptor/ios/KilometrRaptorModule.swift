import ExpoModulesCore
import KilometrMaps

public class KilometrRaptorModule: Module {
  private func call(_ op: Int32, _ a: Int32 = 0, _ b: Int32 = 0, _ data: Data = Data()) -> Data {
    data.withUnsafeBytes { bytes in
      var length = 0
      guard let result = kilometr_ios_call(op, a, b, bytes.bindMemory(to: UInt8.self).baseAddress, data.count, &length) else {
        return Data()
      }
      defer { kilometr_ios_free(result, length) }
      return Data(bytes: result, count: length)
    }
  }

  private func loadTile(_ x: Int32, _ y: Int32, _ data: Data) -> Bool {
    let loaded = call(6, x, y, data).first == 1
    if loaded {
      let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("foot-tiles", isDirectory: true)
      try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try? data.write(to: folder.appendingPathComponent("14_\(x)_\(y).pbf"), options: .atomic)
    }
    return loaded
  }

  private func loadPack(_ x: Int32, _ y: Int32) -> Bool {
    if call(5, x, y).first == 1 { return true }
    if let tile = OfflineFiles.tile(z: 14, x: Int(x), y: Int(y)),
       let data = tile.compressed ? OfflineFiles.gunzip(tile.data) : tile.data {
      return call(6, x, y, data).first == 1
    }
    let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("foot-tiles/14_\(x)_\(y).pbf")
    guard let data = try? Data(contentsOf: cache) else { return false }
    return call(6, x, y, data).first == 1
  }

  public func definition() -> ModuleDefinition {
    Name("KilometrRaptor")
    Function("isAvailable") { true }
    Function("hasNetworkSync") { (id: Int32) in self.call(0, id).first == 1 }
    AsyncFunction("hasNetwork") { (id: Int32) in self.call(0, id).first == 1 }
    Function("loadNetworkSync") { (id: Int32, data: Data) in self.call(1, id, 0, data).first == 1 }
    AsyncFunction("loadNetwork") { (id: Int32, data: Data) in self.call(1, id, 0, data).first == 1 }
    Function("dropNetworkSync") { (id: Int32) in _ = self.call(2, id) }
    AsyncFunction("dropNetwork") { (id: Int32) in _ = self.call(2, id) }
    Function("clearNetworksSync") { _ = self.call(3) }
    AsyncFunction("clearNetworks") { _ = self.call(3) }
    Function("runQuerySync") { (data: Data) in self.call(4, 0, 0, data) }
    AsyncFunction("runQuery") { (data: Data) in self.call(4, 0, 0, data) }
    Function("hasFootTileSync") { (x: Int32, y: Int32) in self.call(5, x, y).first == 1 }
    AsyncFunction("hasFootTile") { (x: Int32, y: Int32) in self.call(5, x, y).first == 1 }
    Function("loadFootTileSync") { (x: Int32, y: Int32, data: Data) in self.loadTile(x, y, data) }
    AsyncFunction("loadFootTile") { (x: Int32, y: Int32, data: Data) in self.loadTile(x, y, data) }
    Function("loadFootTileFromPackSync") { (x: Int32, y: Int32) in self.loadPack(x, y) }
    AsyncFunction("loadFootTileFromPack") { (x: Int32, y: Int32) in self.loadPack(x, y) }
    Function("clearFootTilesSync") { _ = self.call(7) }
    AsyncFunction("clearFootTiles") { _ = self.call(7) }
    Function("routeFootSync") { (data: Data) in self.call(8, 0, 0, data) }
    AsyncFunction("routeFoot") { (data: Data) in self.call(8, 0, 0, data) }
    Function("invokeSync") { (cmd: Int32, data: Data) in self.call(9, cmd, 0, data) }
    AsyncFunction("invoke") { (cmd: Int32, data: Data) in self.call(9, cmd, 0, data) }
    AsyncFunction("decompressGzipFile") { (source: String, destination: String) in
      OfflineFiles.decompressFile(source, to: destination)
    }
  }
}
