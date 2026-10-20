import ActivityKit
import SwiftUI
import WidgetKit

private struct TripCountdown: View {
  let context: ActivityViewContext<TripAttributes>

  var body: some View {
    let target = context.isStale ? context.state.endAt : context.state.countdownAt
    Text(timerInterval: Date(timeIntervalSince1970: min(context.state.startAt, target - 1))...Date(timeIntervalSince1970: target),
         countsDown: true)
      .monospacedDigit().multilineTextAlignment(.trailing)
  }
}

private struct TripSummary: View {
  let context: ActivityViewContext<TripAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(context.isStale ? context.state.staleTitle : context.state.title).font(.headline).lineLimit(2)
      if context.isStale {
        Text(context.state.staleLabel).font(.caption)
      } else {
        Text(context.state.subtitle).font(.subheadline).lineLimit(2)
      }
      HStack {
        Text(context.isStale ? context.state.brand : context.state.line).font(.headline)
        Spacer()
        TripCountdown(context: context)
      }
      ProgressView(timerInterval: Date(timeIntervalSince1970: context.state.startAt)...Date(timeIntervalSince1970: context.state.endAt),
                   countsDown: false).tint(Color(red: 0.36, green: 0.86, blue: 0.75))
        .labelsHidden()
    }
    .foregroundStyle(.white)
  }
}

@main
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
        DynamicIslandExpandedRegion(.bottom) {
          TripSummary(context: context)
        }
      } compactLeading: {
        Text(context.isStale ? String(context.state.brand.prefix(1)) : context.state.line).font(.caption).lineLimit(1)
          .accessibilityLabel(context.isStale ? context.state.staleTitle : context.state.title)
      } compactTrailing: {
        TripCountdown(context: context).frame(maxWidth: 56)
      } minimal: {
        Text(context.isStale ? String(context.state.brand.prefix(1)) : context.state.line).font(.caption2).lineLimit(1)
          .accessibilityLabel(context.isStale ? context.state.staleTitle : context.state.title)
      }
      .widgetURL(URL(string: context.attributes.deepLink))
      .keylineTint(Color(red: 0.36, green: 0.86, blue: 0.75))
    }
  }
}
