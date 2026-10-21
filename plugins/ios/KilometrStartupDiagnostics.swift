import Foundation
import React
import UIKit

enum KilometrStartupDiagnostics {
  static func install() {
    #if !DEBUG
    // Przechwytuje wyjątek JS także wtedy, gdy rejestracja modułów Expo zawiedzie.
    let previousHandler = RCTGetFatalHandler()
    RCTSetFatalHandler { error in
      guard let error = error as NSError? else { return }
      guard error.userInfo[RCTJSStackTraceKey] != nil else {
        if let previousHandler {
          previousHandler(error)
        } else {
          RCTSetFatalHandler(nil)
          RCTFatal(error)
        }
        return
      }
      let stack = error.userInfo[RCTJSStackTraceKey] as? [[String: Any]] ?? []
      let frames = stack.map { frame in
        "\(frame["methodName"] ?? "")@\(frame["file"] ?? ""):\(frame["lineNumber"] ?? ""):\(frame["column"] ?? "")"
      }.joined(separator: "\n")
      let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
      let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
      let report = "Kilometr \(version) (\(build))\n\n\(error.localizedDescription)\n\n\(frames)"
      DispatchQueue.main.async {
        StartupReportController.show(report)
      }
    }
    #endif
  }
}

@MainActor
private final class StartupReportController: UIViewController {
  private static var reportWindow: UIWindow?
  private let report: String

  init(report: String) {
    self.report = report
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { return nil }

  static func show(_ report: String) {
    guard reportWindow == nil else { return }
    let window: UIWindow
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    if let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first {
      window = UIWindow(windowScene: scene)
    } else {
      window = UIWindow(frame: UIScreen.main.bounds)
    }
    window.windowLevel = .alert + 1
    window.rootViewController = UINavigationController(rootViewController: StartupReportController(report: report))
    reportWindow = window
    window.makeKeyAndVisible()
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = text("KilometrStartupTitle")
    view.backgroundColor = .systemBackground
    let appearance = UINavigationBarAppearance()
    appearance.configureWithOpaqueBackground()
    appearance.backgroundColor = .systemBackground
    navigationItem.standardAppearance = appearance
    navigationItem.scrollEdgeAppearance = appearance
    navigationController?.navigationBar.tintColor = UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 92 / 255, green: 219 / 255, blue: 190 / 255, alpha: 1)
        : UIColor(red: 0, green: 106 / 255, blue: 96 / 255, alpha: 1)
    }
    let reportView = UITextView()
    reportView.isEditable = false
    reportView.isSelectable = true
    reportView.adjustsFontForContentSizeCategory = true
    reportView.font = .preferredFont(forTextStyle: .body)
    reportView.textColor = .label
    reportView.backgroundColor = .systemBackground
    reportView.text = "\(text("KilometrStartupHint"))\n\n\(report)"
    reportView.textContainer.lineBreakMode = .byCharWrapping
    reportView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(reportView)
    let safe = view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      reportView.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
      reportView.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
      reportView.topAnchor.constraint(equalTo: safe.topAnchor),
      reportView.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
    ])
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      title: text("KilometrStartupShare"), style: .plain, target: self, action: #selector(shareReport)
    )
  }

  @objc private func shareReport() {
    let sheet = UIActivityViewController(activityItems: [report], applicationActivities: nil)
    sheet.popoverPresentationController?.barButtonItem = navigationItem.rightBarButtonItem
    present(sheet, animated: true)
  }

  private func text(_ key: String) -> String {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    if let file = documents?.appendingPathComponent(".kv/kilometr.locale.v1"),
      let locale = try? String(contentsOf: file, encoding: .utf8),
      ["pl", "en", "de", "uk"].contains(locale),
      let path = Bundle.main.path(forResource: locale, ofType: "lproj"),
      let bundle = Bundle(path: path)
    {
      return bundle.localizedString(forKey: key, value: nil, table: "InfoPlist")
    }
    return Bundle.main.object(forInfoDictionaryKey: key) as? String ?? key
  }
}
