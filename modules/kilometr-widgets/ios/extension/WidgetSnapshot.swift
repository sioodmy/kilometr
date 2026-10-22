import Foundation

struct WidgetBadge: Decodable {
  let mode: String
  let line: String?
  let bg: String?
  let fg: String?
}

struct WidgetDestination: Decodable, Identifiable {
  let id: String
  let title: String
  let icon: String
  let line: String?
  let mode: String?
  let lineBg: String?
  let lineFg: String?
  let departTs: Double?
  let deepLink: String

  var badge: WidgetBadge? {
    guard let mode else { return nil }
    return WidgetBadge(mode: mode, line: line, bg: lineBg, fg: lineFg)
  }

  func departure(at date: Date) -> Date? {
    guard let departTs, departTs.isFinite else { return nil }
    let departure = Date(timeIntervalSince1970: departTs / 1000)
    return departure.addingTimeInterval(60) > date ? departure : nil
  }
}

struct WidgetPlace: Decodable, Identifiable {
  let id: String
  let name: String
  let icon: String
  let deepLink: String
}

struct WidgetTrip: Decodable {
  let fromTitle: String
  let toTitle: String
  let departTs: Double
  let arriveTs: Double
  let legs: [WidgetBadge]
  let deepLink: String

  var departure: Date { Date(timeIntervalSince1970: departTs / 1000) }
  var arrival: Date { Date(timeIntervalSince1970: arriveTs / 1000) }

  func isVisible(at date: Date) -> Bool {
    departTs.isFinite && arriveTs.isFinite && arriveTs > departTs &&
      date < arrival.addingTimeInterval(120)
  }
}

struct WidgetSnapshot: Decodable {
  let v: Int
  let updatedAt: Double
  let origin: String
  let locale: String?
  let labels: [String: String]
  let quick: [WidgetDestination]
  let places: [WidgetPlace]
  let pinned: WidgetTrip?

  static let empty = WidgetSnapshot(v: 2, updatedAt: 0, origin: "", locale: nil,
                                    labels: [:], quick: [], places: [], pinned: nil)

  static func decode(_ data: Data) -> WidgetSnapshot {
    guard data.count <= 512_000,
          let snapshot = try? JSONDecoder().decode(Self.self, from: data), snapshot.v == 2
    else { return .empty }
    return snapshot
  }

  func text(_ key: String, _ values: [String: String] = [:]) -> String {
    var result = labels[key] ?? Bundle.main.localizedString(forKey: key, value: nil, table: nil)
    for (key, value) in values { result = result.replacingOccurrences(of: "{\(key)}", with: value) }
    return result
  }

  func timelineDates(after date: Date) -> [Date] {
    var dates = [date]
    for item in quick {
      if let departure = item.departure(at: date) {
        dates += [departure, departure.addingTimeInterval(60)]
      }
    }
    if let trip = pinned, trip.isVisible(at: date) {
      dates += [trip.departure, trip.arrival, trip.arrival.addingTimeInterval(120)]
    }
    return Array(Set(dates.filter { $0 >= date && $0 <= date.addingTimeInterval(86_400) })).sorted()
  }
}
