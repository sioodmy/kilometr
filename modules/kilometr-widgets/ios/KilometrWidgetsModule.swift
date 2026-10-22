import ExpoModulesCore
import WidgetKit

public class KilometrWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KilometrWidgets")
    AsyncFunction("syncSnapshot") { (snapshot: String) throws -> Bool in
      guard let group = Bundle.main.object(forInfoDictionaryKey: "KilometrWidgetAppGroup") as? String,
            let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
      else { return false }
      try Data(snapshot.utf8).write(to: container.appendingPathComponent("kilometr-widget.json"), options: .atomic)
      WidgetCenter.shared.reloadAllTimelines()
      return true
    }
  }
}
