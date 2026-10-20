import ActivityKit
import ExpoModulesCore
import UIKit

@MainActor
private enum TripActivity {
  static var generation = 0
  static let savedId = "kilometr.liveActivity.id"
  static let savedTrip = "kilometr.liveActivity.trip"

  static func wasDismissed() -> Bool {
    guard let id = UserDefaults.standard.string(forKey: savedId) else { return false }
    return !Activity<TripAttributes>.activities.contains {
      $0.id == id && ($0.activityState == .active || $0.activityState == .stale)
    }
  }

  static func start(_ json: String) async throws -> Bool {
    let plan = try JSONDecoder().decode(TripActivityPlan.self, from: Data(json.utf8))
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
    if UserDefaults.standard.string(forKey: savedTrip) == plan.tripId && wasDismissed() { return false }
    generation += 1
    let run = generation
    let content = ActivityContent(state: plan.state, staleDate: Date(timeIntervalSince1970: plan.staleAt))
    let active = Activity<TripAttributes>.activities
    for activity in active where activity.attributes.tripId != plan.tripId {
      await activity.end(nil, dismissalPolicy: .immediate)
      guard run == generation else { return false }
    }
    if let activity = active.first(where: { $0.attributes.tripId == plan.tripId }) {
      if plan.arrived {
        UserDefaults.standard.removeObject(forKey: savedId)
        UserDefaults.standard.removeObject(forKey: savedTrip)
        await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(180)))
      } else {
        await activity.update(content)
      }
      return run == generation
    }
    guard !plan.arrived, UIApplication.shared.applicationState == .active else { return false }
    let activity = try Activity.request(
      attributes: TripAttributes(tripId: plan.tripId, deepLink: plan.deepLink),
      content: content, pushType: nil
    )
    UserDefaults.standard.set(activity.id, forKey: savedId)
    UserDefaults.standard.set(plan.tripId, forKey: savedTrip)
    return true
  }

  static func stop() async {
    generation += 1
    UserDefaults.standard.removeObject(forKey: savedId)
    UserDefaults.standard.removeObject(forKey: savedTrip)
    for activity in Activity<TripAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}

public class KilometrTrackingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KilometrTracking")
    Function("isAvailable") { true }
    AsyncFunction("canPromote") { ActivityAuthorizationInfo().areActivitiesEnabled }
    AsyncFunction("startTrip") { (json: String) async throws -> Bool in
      try await TripActivity.start(json)
    }
    AsyncFunction("stopTrip") { () async -> Bool in
      await TripActivity.stop()
      return true
    }
    AsyncFunction("hasStopRequest") { () async -> Bool in
      await TripActivity.wasDismissed()
    }
    AsyncFunction("consumeStopRequest") { () async -> Bool in
      await MainActor.run {
        let stopped = TripActivity.wasDismissed()
        if stopped {
          UserDefaults.standard.removeObject(forKey: TripActivity.savedId)
          UserDefaults.standard.removeObject(forKey: TripActivity.savedTrip)
        }
        return stopped
      }
    }
    AsyncFunction("openNotificationSettings") { () async -> Bool in
      await UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
    }
  }
}
