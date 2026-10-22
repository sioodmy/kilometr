import ActivityKit

struct TripAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    let title: String
    let subtitle: String
    let line: String
    let brand: String
    let locale: String?
    let phase: String?
    let phaseLabel: String?
    let mode: String?
    let lineBg: String?
    let lineFg: String?
    let destination: String?
    let targetName: String?
    let timerLabel: String?
    let arrivalLabel: String?
    let detail: String?
    let startAt: Double
    let endAt: Double
    let countdownAt: Double
    let staleLabel: String
    let staleTitle: String
  }

  let tripId: String
  let deepLink: String
}

struct TripActivityPlan: Decodable {
  let tripId: String
  let deepLink: String
  let staleAt: Double
  let arrived: Bool
  let state: TripAttributes.ContentState

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    tripId = try container.decode(String.self, forKey: .tripId)
    deepLink = try container.decode(String.self, forKey: .deepLink)
    staleAt = try container.decode(Double.self, forKey: .staleAt)
    arrived = try container.decode(Bool.self, forKey: .arrived)
    state = try TripAttributes.ContentState(from: decoder)
  }

  private enum CodingKeys: String, CodingKey {
    case tripId, deepLink, staleAt, arrived
  }
}
