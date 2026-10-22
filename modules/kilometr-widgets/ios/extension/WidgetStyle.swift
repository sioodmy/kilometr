import SwiftUI
import UIKit
import WidgetKit

let kilometrAccent = Color(uiColor: UIColor { traits in
  traits.userInterfaceStyle == .dark
    ? UIColor(red: 0.36, green: 0.86, blue: 0.75, alpha: 1)
    : UIColor(red: 0, green: 0.42, blue: 0.37, alpha: 1)
})

func transitSymbol(_ mode: String) -> String {
  switch mode {
  case "tram": return "tram.fill"
  case "train": return "train.side.front.car"
  case "subway": return "tram.tunnel.fill"
  case "cable": return "cablecar.fill"
  case "bus", "trolleybus": return "bus.fill"
  default: return "figure.walk"
  }
}

func placeSymbol(_ icon: String) -> String {
  switch icon {
  case "home": return "house.fill"
  case "work": return "briefcase.fill"
  case "school", "university": return "graduationcap.fill"
  case "gym": return "dumbbell.fill"
  case "heart": return "heart.fill"
  case "shopping", "market", "cart": return "cart.fill"
  case "star": return "star.fill"
  case "coffee": return "cup.and.saucer.fill"
  case "train": return "train.side.front.car"
  case "plus": return "plus"
  case "restaurant", "pizza", "sandwich": return "fork.knife"
  case "pharmacy", "hospital", "doctor": return "cross.case.fill"
  case "park": return "leaf.fill"
  case "cinema": return "film.fill"
  case "culture", "theater": return "theatermasks.fill"
  case "library": return "books.vertical.fill"
  case "friends": return "person.2.fill"
  case "church": return "building.2.fill"
  case "car": return "car.fill"
  case "bike": return "bicycle"
  case "plane": return "airplane"
  case "tram": return "tram.fill"
  case "bus": return "bus.fill"
  case "fuel": return "fuelpump.fill"
  case "ship": return "ferry.fill"
  case "compass": return "location.north.fill"
  case "beer": return "mug.fill"
  case "wine": return "wineglass.fill"
  case "scissors": return "scissors"
  case "sparkles": return "sparkles"
  case "music": return "music.note"
  case "ticket": return "ticket.fill"
  case "gamepad": return "gamecontroller.fill"
  case "mountain": return "mountain.2.fill"
  case "tent": return "tent.fill"
  case "trophy": return "trophy.fill"
  case "swimming": return "figure.pool.swim"
  case "baby": return "figure.and.child.holdinghands"
  case "pet": return "pawprint.fill"
  case "hotel": return "bed.double.fill"
  case "bank": return "building.columns.fill"
  case "post": return "envelope.fill"
  case "laptop": return "laptopcomputer"
  case "history": return "clock"
  default: return "mappin"
  }
}

extension Color {
  init(hex: String?) {
    let value = UInt32((hex ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x5CDBBE
    self.init(red: Double((value >> 16) & 255) / 255,
              green: Double((value >> 8) & 255) / 255,
              blue: Double(value & 255) / 255)
  }
}

struct WidgetLine: View {
  let badge: WidgetBadge
  @Environment(\.widgetRenderingMode) private var renderingMode

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: transitSymbol(badge.mode)).accessibilityHidden(true)
      if let line = badge.line, !line.isEmpty { Text(line).lineLimit(1) }
    }
    .font(.caption.weight(.bold))
    .padding(.horizontal, 7).padding(.vertical, 5)
    .foregroundStyle(renderingMode == .fullColor ? Color(hex: badge.fg ?? "#003831") : .primary)
    .background {
      if renderingMode == .fullColor {
        RoundedRectangle(cornerRadius: 7).fill(Color(hex: badge.bg))
      }
    }
    .widgetAccentable()
  }
}

extension View {
  @ViewBuilder
  func kilometrWidgetBackground() -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(for: .widget) { Color(uiColor: .secondarySystemGroupedBackground) }
    } else {
      padding(16).background(Color(uiColor: .secondarySystemGroupedBackground))
    }
  }
}
