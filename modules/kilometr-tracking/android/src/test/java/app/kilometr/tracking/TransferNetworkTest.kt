package app.kilometr.tracking

import app.kilometr.raptor.KilometrRaptorBridge
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

class TransferNetworkTest {
  private fun fixture(): JSONObject {
    val path = System.getProperty("kilometr.transfer.fixture")
    assumeTrue(path != null && KilometrRaptorBridge.isLoaded)
    return JSONObject(File(path!!).readText())
  }

  @Test fun replansRemainingJourneyWithRealNativeRaptor() {
    val root = fixture()
    val net = TransferNetwork(root)
    val connection = root.getJSONObject("connection")
    val ride = net.rides(connection).first()
    val now = root.getLong("baseMs") + (root.getInt("offset") + 540) * 1000L
    val result = net.alternatives(connection, ride, RideEstimate(1.0, 300, now), now)!!
    val legs = result.connection.getJSONArray("legs")
    assertEquals("4-0", legs.getJSONObject(0).getString("tripId"))
    assertEquals("D", legs.getJSONObject(0).getString("toStopId"))
    assertEquals("12", legs.getJSONObject(1).getString("line"))
    assertEquals(connection.getString("id"), result.connection.getString("id"))
    assertEquals(1, result.connection.getInt("transfers"))
    assertTrue(net.rides(result.connection).all { it.alight > it.board })
    KilometrRaptorBridge.nativeDropNetwork(TransferNetwork.NET_ID)
  }

  @Test fun rejectsBannedModesAndPastAlightingStops() {
    val root = fixture()
    root.getJSONObject("options").getJSONObject("allowedModes").put("tram", false)
    val net = TransferNetwork(root)
    val connection = root.getJSONObject("connection")
    val ride = net.rides(connection).first()
    val now = root.getLong("baseMs") + (root.getInt("offset") + 540) * 1000L
    assertNull(net.alternatives(connection, ride, RideEstimate(1.0, 300, now), now))
    KilometrRaptorBridge.nativeDropNetwork(TransferNetwork.NET_ID)
  }

  @Test fun matchesConnectingVehicleByItsScheduledStopsAndExpiresDelay() {
    val root = fixture()
    val net = TransferNetwork(root)
    val base = root.getLong("baseMs") + root.getInt("offset") * 1000L
    val now = base + 9 * 60_000
    val stops = JSONArray().put(JSONObject().put("name", "Stara przesiadka").put("scheduledDeparture", base + 10 * 60_000))
      .put(JSONObject().put("name", "Cel").put("scheduledDeparture", base + 25 * 60_000))
    val rows = JSONArray().put(JSONObject().put("routeName", "10").put("timestamp", now)
      .put("delay", 360_000).put("upcomingStops", stops))
    net.matchLive(rows, now)
    assertEquals(360, net.freshDelay("10-0", now))
    assertNull(net.freshDelay("10-1", now))
    assertNull(net.freshDelay("10-0", now + 121_000))
  }
}
