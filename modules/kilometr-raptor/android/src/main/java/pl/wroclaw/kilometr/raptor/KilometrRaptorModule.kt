package pl.wroclaw.kilometr.raptor

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KilometrRaptorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KilometrRaptor")

    Function("isAvailable") {
      KilometrRaptorBridge.isLoaded
    }

    Function("hasNetworkSync") { netId: Int ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        KilometrRaptorBridge.nativeHasNetwork(netId)
      }
    }

    Function("loadNetworkSync") { netId: Int, packedNet: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        KilometrRaptorBridge.nativeLoadNetwork(netId, packedNet)
      }
    }

    Function("dropNetworkSync") { netId: Int ->
      if (KilometrRaptorBridge.isLoaded) {
        KilometrRaptorBridge.nativeDropNetwork(netId)
      }
    }

    Function("clearNetworksSync") {
      if (KilometrRaptorBridge.isLoaded) {
        KilometrRaptorBridge.nativeClearNetworks()
      }
    }

    Function("runQuerySync") { packedQuery: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        null
      } else {
        KilometrRaptorBridge.nativeRunQuery(packedQuery)
      }
    }

    AsyncFunction("hasNetwork") { netId: Int ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        KilometrRaptorBridge.nativeHasNetwork(netId)
      }
    }

    AsyncFunction("loadNetwork") { netId: Int, packedNet: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        KilometrRaptorBridge.nativeLoadNetwork(netId, packedNet)
      }
    }

    AsyncFunction("dropNetwork") { netId: Int ->
      if (KilometrRaptorBridge.isLoaded) {
        KilometrRaptorBridge.nativeDropNetwork(netId)
      }
    }

    AsyncFunction("clearNetworks") {
      if (KilometrRaptorBridge.isLoaded) {
        KilometrRaptorBridge.nativeClearNetworks()
      }
    }

    AsyncFunction("runQuery") { packedQuery: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        null
      } else {
        KilometrRaptorBridge.nativeRunQuery(packedQuery)
      }
    }
  }
}
