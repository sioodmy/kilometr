import SwiftUI
import WidgetKit

private let searchURL = URL(string: "kilometr://?search=1")!
private let placesURL = URL(string: "kilometr://?places=1")!
private let appURL = URL(string: "kilometr://")!

private struct KilometrEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot
}

private struct KilometrProvider: TimelineProvider {
  func placeholder(in context: Context) -> KilometrEntry {
    KilometrEntry(date: Date(), snapshot: .empty)
  }

  func getSnapshot(in context: Context, completion: @escaping (KilometrEntry) -> Void) {
    completion(KilometrEntry(date: Date(), snapshot: read()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<KilometrEntry>) -> Void) {
    let now = Date()
    let snapshot = read()
    let entries = snapshot.timelineDates(after: now).map { KilometrEntry(date: $0, snapshot: snapshot) }
    completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(1800))))
  }

  private func read() -> WidgetSnapshot {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "KilometrWidgetAppGroup") as? String,
          let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
          let data = try? Data(contentsOf: container.appendingPathComponent("kilometr-widget.json"))
    else { return .empty }
    return WidgetSnapshot.decode(data)
  }
}

private struct WidgetEmpty: View {
  let symbol: String
  let title: String
  let hint: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Image(systemName: symbol).font(.title2).foregroundStyle(kilometrAccent).accessibilityHidden(true)
      Text(title).font(.headline).lineLimit(2)
      Text(hint).font(.caption).foregroundStyle(.secondary).lineLimit(3)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

private struct WidgetTimer: View {
  let date: Date
  let now: Date

  var body: some View {
    Text(timerInterval: min(now, date.addingTimeInterval(-1))...date, countsDown: true)
      .monospacedDigit().multilineTextAlignment(.trailing)
      .lineLimit(1).minimumScaleFactor(0.75)
  }
}

private struct DirectionsView: View {
  let entry: KilometrEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let snapshot = entry.snapshot
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline) {
        Text(snapshot.text("journeyTitle")).font(.headline).lineLimit(1)
        Spacer(minLength: 4)
        if snapshot.updatedAt > 0 && !typeSize.isAccessibilitySize {
          let time = Date(timeIntervalSince1970: snapshot.updatedAt / 1000)
            .formatted(.dateTime.hour().minute().locale(Locale(identifier: snapshot.locale ?? "pl")))
          Text(snapshot.text("updated", ["t": time])).font(.caption2).foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      if snapshot.quick.isEmpty {
        Spacer(minLength: 0)
        Text(snapshot.text("destEmpty")).font(.subheadline).foregroundStyle(.secondary)
        Spacer(minLength: 0)
      } else {
        ForEach(snapshot.quick.prefix(typeSize.isAccessibilitySize ? 1 : family == .systemLarge ? 4 : 2)) { item in
          Link(destination: URL(string: item.deepLink) ?? searchURL) {
            HStack(spacing: 8) {
              Image(systemName: placeSymbol(item.icon)).foregroundStyle(kilometrAccent)
                .frame(width: 20).accessibilityHidden(true)
              VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                if let badge = item.badge, item.departure(at: entry.date) != nil {
                  HStack(spacing: 4) {
                    Image(systemName: transitSymbol(badge.mode)).accessibilityHidden(true)
                    Text(badge.line ?? snapshot.text("timetable"))
                  }
                  .font(.caption2).foregroundStyle(.secondary)
                }
              }
              Spacer(minLength: 0)
              if let departure = item.departure(at: entry.date) {
                if departure > entry.date {
                  WidgetTimer(date: departure, now: entry.date)
                    .font(.headline).frame(width: 76).foregroundStyle(kilometrAccent)
                } else {
                  Text(snapshot.text("departNow")).font(.caption).lineLimit(2)
                }
              } else {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                  .accessibilityLabel(snapshot.text("search"))
              }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
        Spacer(minLength: 0)
        if !typeSize.isAccessibilitySize && !snapshot.origin.isEmpty && family == .systemLarge {
          Text(snapshot.text("fromOrigin", ["name": snapshot.origin])).font(.caption).lineLimit(1)
        }
      }
    }
    .widgetURL(searchURL)
  }
}

private struct TripWidgetView: View {
  let entry: KilometrEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let snapshot = entry.snapshot
    if let trip = snapshot.pinned, trip.isVisible(at: entry.date) {
      let boarding = entry.date < trip.departure
      let arrived = entry.date >= trip.arrival
      VStack(alignment: .leading, spacing: 8) {
        Text(trip.toTitle).font(.headline).lineLimit(typeSize.isAccessibilitySize ? 1 : 2)
        HStack(alignment: .firstTextBaseline) {
          Text(snapshot.text(arrived ? "arrived" : boarding ? "departure" : "arrival"))
            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
          Spacer(minLength: 0)
          if arrived {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(kilometrAccent)
          } else {
            WidgetTimer(date: boarding ? trip.departure : trip.arrival, now: entry.date)
              .font(.title2.weight(.semibold)).foregroundStyle(kilometrAccent)
              .frame(width: 94)
          }
        }
        if !typeSize.isAccessibilitySize {
          HStack(spacing: 6) {
            ForEach(Array(trip.legs.prefix(family == .systemSmall ? 2 : 4).enumerated()), id: \.offset) { _, leg in
              WidgetLine(badge: leg)
            }
          }
        }
        Spacer(minLength: 0)
        if !arrived {
          ProgressView(timerInterval: trip.departure...trip.arrival, countsDown: false)
            .labelsHidden().tint(kilometrAccent)
            .accessibilityLabel(snapshot.text("arrival"))
        }
        if family != .systemSmall && !typeSize.isAccessibilitySize {
          HStack {
            Text(trip.departure, style: .time)
            Spacer()
            Text(trip.arrival, style: .time)
          }
          .font(.caption).monospacedDigit().foregroundStyle(.secondary)
        }
      }
      .widgetURL(URL(string: trip.deepLink) ?? appURL)
    } else {
      WidgetEmpty(symbol: "point.topleft.down.to.point.bottomright.curvepath", title: snapshot.text("tripEmptyTitle"),
                  hint: snapshot.text("tripEmptyBody"))
        .widgetURL(searchURL)
    }
  }
}

private struct PlacesWidgetView: View {
  let entry: KilometrEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let snapshot = entry.snapshot
    VStack(alignment: .leading, spacing: 8) {
      Text(snapshot.text("placesTitle")).font(.headline).lineLimit(1)
      if snapshot.places.isEmpty {
        Text(snapshot.text("placesEmpty")).font(.caption).foregroundStyle(.secondary)
        Spacer(minLength: 0)
        Label(snapshot.text("addPlace"), systemImage: "plus").font(.subheadline).foregroundStyle(kilometrAccent)
      } else {
        let columns = family == .systemSmall ? 1 : 2
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: columns), spacing: 4) {
          ForEach(snapshot.places.prefix(columns * (typeSize.isAccessibilitySize ? 1 : 2))) { place in
            Link(destination: URL(string: place.deepLink) ?? placesURL) {
              Label(place.name, systemImage: placeSymbol(place.icon))
                .font(.subheadline.weight(.medium)).lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
          }
        }
        Spacer(minLength: 0)
      }
    }
    .widgetURL(placesURL)
  }
}

private struct SearchWidgetView: View {
  let entry: KilometrEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Link(destination: searchURL) {
        Label(entry.snapshot.text("search"), systemImage: "magnifyingglass")
          .font(.headline).foregroundStyle(kilometrAccent)
          .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Spacer(minLength: 0)
      if family != .systemSmall && !typeSize.isAccessibilitySize {
        HStack(spacing: 16) {
          ForEach(entry.snapshot.places.prefix(2)) { place in
            Link(destination: URL(string: place.deepLink) ?? placesURL) {
              Label(place.name, systemImage: placeSymbol(place.icon))
                .font(.subheadline).lineLimit(1).frame(minHeight: 44)
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
    .widgetURL(searchURL)
  }
}

private enum KilometrWidgetKind: String {
  case directions, trip, places, search
}

private struct KilometrWidget: Widget {
  let kind: KilometrWidgetKind
  let title: LocalizedStringKey
  let description: LocalizedStringKey
  let families: [WidgetFamily]

  // Widget wymaga init(); właściwe instancje tworzy WidgetBundle z jawnym initem.
  init() {
    self.init(kind: .directions, title: "", description: "")
  }

  init(
    kind: KilometrWidgetKind,
    title: LocalizedStringKey,
    description: LocalizedStringKey,
    families: [WidgetFamily] = [.systemSmall, .systemMedium]
  ) {
    self.kind = kind
    self.title = title
    self.description = description
    self.families = families
  }

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Kilometr.\(kind.rawValue)", provider: KilometrProvider()) { entry in
      Group {
        switch kind {
        case .directions: DirectionsView(entry: entry)
        case .trip: TripWidgetView(entry: entry)
        case .places: PlacesWidgetView(entry: entry)
        case .search: SearchWidgetView(entry: entry)
        }
      }
      .environment(\.locale, Locale(identifier: entry.snapshot.locale ?? Locale.current.identifier))
      .tint(kilometrAccent)
      .kilometrWidgetBackground()
    }
    .configurationDisplayName(title)
    .description(description)
    .supportedFamilies(families)
  }
}

@main
struct KilometrWidgetBundle: WidgetBundle {
  var body: some Widget {
    KilometrWidget(kind: .directions, title: "journeyTitle", description: "journeyDescription",
                   families: [.systemMedium, .systemLarge])
    KilometrWidget(kind: .trip, title: "trackingTitle", description: "tripDescription")
    KilometrWidget(kind: .places, title: "placesTitle", description: "placesDescription")
    KilometrWidget(kind: .search, title: "searchTitle", description: "searchDescription")
    KilometrLiveActivity()
  }
}
