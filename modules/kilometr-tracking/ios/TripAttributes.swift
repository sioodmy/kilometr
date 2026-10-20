import ActivityKit

struct TripAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    let title: String
    let subtitle: String
    let line: String
    let brand: String
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
  let title: String
  let subtitle: String
  let line: String
  let brand: String
  let startAt: Double
  let endAt: Double
  let countdownAt: Double
  let staleAt: Double
  let staleLabel: String
  let staleTitle: String
  let arrived: Bool

  var state: TripAttributes.ContentState {
    .init(title: title, subtitle: subtitle, line: line, brand: brand, startAt: startAt,
          endAt: endAt, countdownAt: countdownAt, staleLabel: staleLabel, staleTitle: staleTitle)
  }
}
