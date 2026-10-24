import ActivityKit
import SwiftUI
import WidgetKit

private let tripAccent = Color(red: 0.36, green: 0.86, blue: 0.75)

private struct TripCountdown: View {
  let context: ActivityViewContext<TripAttributes>

  var body: some View {
    Group {
      if context.state.phase == "arrived" {
        Image(systemName: "checkmark.circle.fill")
          .accessibilityLabel(context.state.phaseLabel ?? context.state.title)
      } else {
        let end = context.isStale ? context.state.endAt : context.state.countdownAt
        let start = context.state.timerStartAt ?? min(Date().timeIntervalSince1970, context.state.startAt)
        Text(timerInterval: Date(timeIntervalSince1970: min(start, end - 1))...Date(timeIntervalSince1970: end),
             countsDown: true).monospacedDigit()
      }
    }
    .lineLimit(1).minimumScaleFactor(0.75)
    .environment(\.locale, Locale(identifier: context.state.locale ?? Locale.current.identifier))
  }
}

private struct TripService: View {
  let context: ActivityViewContext<TripAttributes>
  var compact = false

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: context.isStale ? "clock" : transitSymbol(context.state.mode ?? "walk"))
        .accessibilityHidden(true)
      if !context.isStale && context.state.mode != "walk" {
        Text(context.state.line).lineLimit(1).minimumScaleFactor(0.75)
      }
    }
    .font(compact ? .caption.weight(.semibold) : .subheadline.weight(.bold))
    .foregroundStyle(compact || context.isStale ? tripAccent : Color(hex: context.state.lineFg))
    .padding(.horizontal, compact ? 0 : 9).padding(.vertical, compact ? 0 : 6)
    .background {
      if !compact && !context.isStale {
        RoundedRectangle(cornerRadius: 8).fill(Color(hex: context.state.lineBg))
      }
    }
    .accessibilityLabel(context.isStale ? context.state.staleTitle : context.state.title)
  }
}

private struct TripSummary: View {
  let context: ActivityViewContext<TripAttributes>
  var island = false
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if !island {
        HStack(spacing: 10) {
          TripService(context: context, compact: typeSize.isAccessibilitySize)
          Text(context.isStale ? (typeSize.isAccessibilitySize ? context.state.staleLabel : context.state.brand) : context.state.phaseLabel ?? context.state.title)
            .font(.subheadline.weight(.semibold)).lineLimit(1)
          Spacer(minLength: 0)
          if !typeSize.isAccessibilitySize {
            Text(context.state.arrivalLabel ?? "").font(.caption).foregroundStyle(.secondary)
              .lineLimit(1).monospacedDigit()
          }
        }
      }
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Text(context.isStale ? context.state.destination ?? context.state.staleTitle : context.state.targetName ?? context.state.title)
            .font(.headline).lineLimit(island && !typeSize.isAccessibilitySize ? 2 : 1)
          if !typeSize.isAccessibilitySize {
            Text(context.isStale ? context.state.staleLabel : context.state.detail ?? context.state.subtitle)
              .font(.caption).foregroundStyle(.secondary).lineLimit(island ? 2 : 1)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if !island {
          VStack(alignment: .trailing, spacing: 3) {
            TripCountdown(context: context).font(.title2.weight(.semibold)).foregroundStyle(tripAccent)
              .frame(width: 94, alignment: .trailing).multilineTextAlignment(.trailing)
            Text(context.isStale ? context.state.arrivalLabel ?? "" : context.state.timerLabel ?? "")
              .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
          }
        }
      }
      if context.state.phase != "arrived" {
        ProgressView(timerInterval: Date(timeIntervalSince1970: context.state.startAt)...Date(timeIntervalSince1970: max(context.state.startAt + 1, context.state.endAt)),
                     countsDown: false)
          .tint(tripAccent).labelsHidden()
          .accessibilityLabel(context.state.arrivalLabel ?? context.state.staleTitle)
      }
    }
    .foregroundStyle(.white)
    .environment(\.colorScheme, .dark)
    .environment(\.locale, Locale(identifier: context.state.locale ?? Locale.current.identifier))
  }
}

struct KilometrLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TripAttributes.self) { context in
      TripSummary(context: context)
        .padding(16)
        .activityBackgroundTint(Color(red: 0.067, green: 0.078, blue: 0.078))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(URL(string: context.attributes.deepLink))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          TripService(context: context)
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 2) {
            TripCountdown(context: context).font(.title3.weight(.semibold))
              .frame(width: 90, alignment: .trailing).multilineTextAlignment(.trailing)
            Text(context.isStale ? context.state.arrivalLabel ?? "" : context.state.timerLabel ?? "")
              .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
          }
          .foregroundStyle(tripAccent)
        }
        DynamicIslandExpandedRegion(.bottom) {
          TripSummary(context: context, island: true).padding(.top, 4)
        }
      } compactLeading: {
        TripService(context: context, compact: true)
      } compactTrailing: {
        TripCountdown(context: context).font(.caption.weight(.semibold))
          .foregroundStyle(tripAccent).frame(width: 60).multilineTextAlignment(.trailing)
      } minimal: {
        Image(systemName: context.state.phase == "arrived" ? "checkmark" : context.isStale ? "clock" : transitSymbol(context.state.mode ?? "walk"))
          .foregroundStyle(tripAccent)
          .accessibilityLabel(context.isStale ? context.state.staleTitle : context.state.title)
      }
      .widgetURL(URL(string: context.attributes.deepLink))
      .keylineTint(tripAccent)
    }
  }
}
