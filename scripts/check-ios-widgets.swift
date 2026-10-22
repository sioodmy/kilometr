import Foundation

@main
struct WidgetSnapshotCheck {
  static func main() throws {
    let now = Date(timeIntervalSince1970: 1_792_499_400)
    let snapshot: [String: Any] = [
      "v": 2, "updatedAt": now.timeIntervalSince1970 * 1000,
      "origin": "A", "locale": "de", "labels": ["fromOrigin": "Von: {name}"],
      "quick": [["id": "home", "title": "Home", "icon": "home", "deepLink": "kilometr://routes?toId=home",
                 "departTs": now.addingTimeInterval(300).timeIntervalSince1970 * 1000]],
      "places": [],
      "pinned": ["fromTitle": "A", "toTitle": "B", "legs": [], "deepLink": "kilometr://routes?open=trip",
                 "departTs": now.addingTimeInterval(60).timeIntervalSince1970 * 1000,
                 "arriveTs": now.addingTimeInterval(900).timeIntervalSince1970 * 1000],
    ]
    let model = WidgetSnapshot.decode(try JSONSerialization.data(withJSONObject: snapshot))
    precondition(model.locale == "de")
    precondition(model.text("fromOrigin", ["name": "A"]) == "Von: A")
    precondition(model.quick.count == 1)
    precondition(model.quick[0].departure(at: now) == now.addingTimeInterval(300))
    precondition(model.quick[0].departure(at: now.addingTimeInterval(360)) == nil)
    precondition(model.pinned?.isVisible(at: now.addingTimeInterval(1019)) == true)
    precondition(model.pinned?.isVisible(at: now.addingTimeInterval(1020)) == false)
    let dates = model.timelineDates(after: now)
    precondition(dates == [0, 60, 300, 360, 900, 1020].map { now.addingTimeInterval(Double($0)) })
    precondition(model.timelineDates(after: now.addingTimeInterval(2000)) == [now.addingTimeInterval(2000)])
    precondition(WidgetSnapshot.decode(Data("{".utf8)).quick.isEmpty)
    precondition(WidgetSnapshot.decode(Data(repeating: 32, count: 512_001)).quick.isEmpty)
    var wrongVersion = snapshot
    wrongVersion["v"] = 1
    let invalidData = try JSONSerialization.data(withJSONObject: wrongVersion)
    precondition(WidgetSnapshot.decode(invalidData).quick.isEmpty)
    print("PASS: native widget decoding, localization, departure expiry, arrival expiry and offline timeline")
  }
}
