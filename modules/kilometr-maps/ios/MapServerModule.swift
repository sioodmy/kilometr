import ExpoModulesCore
import Network

public class MapServerModule: Module {
  private let queue = DispatchQueue(label: "app.kilometr.maps")
  private var listener: NWListener?
  private var connections: [UUID: NWConnection] = [:]

  public func definition() -> ModuleDefinition {
    Name("KilometrMapServer")
    AsyncFunction("start") { (promise: Promise) in
      self.queue.async { self.start(promise) }
    }
    AsyncFunction("stop") {
      self.queue.sync { self.stop() }
    }
    OnDestroy {
      self.queue.async { self.stop() }
    }
  }

  private func start(_ promise: Promise) {
    if let port = listener?.port {
      promise.resolve("http://127.0.0.1:\(port.rawValue)")
      return
    }
    stop()
    do {
      let parameters = NWParameters.tcp
      parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
      let server = try NWListener(using: parameters)
      listener = server
      var resolved = false
      server.stateUpdateHandler = { state in
        switch state {
        case .ready:
          if !resolved, let port = server.port {
            resolved = true
            promise.resolve("http://127.0.0.1:\(port.rawValue)")
          }
        case .failed, .cancelled:
          if !resolved { resolved = true; promise.resolve(nil as String?) }
        default: break
        }
      }
      server.newConnectionHandler = { [weak self] connection in
        guard let self else { connection.cancel(); return }
        let id = UUID()
        self.connections[id] = connection
        connection.start(queue: self.queue)
        self.receive(connection, id: id, buffer: Data())
        self.queue.asyncAfter(deadline: .now() + 30) { self.close(id) }
      }
      server.start(queue: queue)
    } catch {
      promise.resolve(nil as String?)
    }
  }

  private func close(_ id: UUID) {
    connections.removeValue(forKey: id)?.cancel()
  }

  private func stop() {
    listener?.cancel()
    listener = nil
    for connection in connections.values { connection.cancel() }
    connections.removeAll()
  }

  private func receive(_ connection: NWConnection, id: UUID, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
      guard let self else { return }
      var request = buffer
      if let data { request.append(data) }
      guard error == nil, request.count <= 16_384 else { self.close(id); return }
      if request.range(of: Data("\r\n\r\n".utf8)) != nil {
        self.respond(connection, id: id, request: request)
      } else if complete {
        self.close(id)
      } else {
        self.receive(connection, id: id, buffer: request)
      }
    }
  }

  private func respond(_ connection: NWConnection, id: UUID, request: Data) {
    let firstLine = String(decoding: request, as: UTF8.self).components(separatedBy: "\r\n")[0]
    let parts = firstLine.split(separator: " ")
    var body = Data()
    var status = "404 Not Found"
    var mime = "application/octet-stream"
    var encoding = ""
    if parts.count >= 2, parts[0] == "OPTIONS" {
      status = "204 No Content"
    } else if parts.count >= 2, parts[0] == "GET" {
      let path = String(parts[1]).components(separatedBy: "?")[0].removingPercentEncoding ?? ""
      let components = path.split(separator: "/").map(String.init)
      if components.count == 4, components[0] == "tiles",
         let z = Int(components[1]), let x = Int(components[2]),
         let y = Int(components[3].replacingOccurrences(of: ".pbf", with: "")),
         (0...22).contains(z), let tile = OfflineFiles.tile(z: z, x: x, y: y) {
        body = tile.data
        mime = "application/x-protobuf"
        encoding = tile.compressed ? "Content-Encoding: gzip\r\n" : ""
        status = "200 OK"
      } else if path.hasPrefix("/assets/") {
        let root = OfflineFiles.maps.resolvingSymlinksInPath()
        let file = root.appendingPathComponent(String(path.dropFirst(8))).resolvingSymlinksInPath().standardizedFileURL
        if file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) {
          body = data
          status = "200 OK"
          mime = ["js": "application/javascript", "css": "text/css", "json": "application/json",
                  "pbf": "application/x-protobuf"][file.pathExtension] ?? mime
        }
      }
    }
    let headers = "HTTP/1.1 \(status)\r\nContent-Type: \(mime)\r\nContent-Length: \(body.count)\r\n\(encoding)Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n"
    var response = Data(headers.utf8)
    response.append(body)
    connection.send(content: response, completion: .contentProcessed { [weak self] _ in
      self?.close(id)
    })
  }
}
