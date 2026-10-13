package pl.wroclaw.kilometr.raptor

object KilometrRaptorBridge {
  val isLoaded: Boolean = try {
    System.loadLibrary("kilometr_raptor")
    true
  } catch (_: Throwable) {
    false
  }

  @JvmStatic external fun nativeHasNetwork(netId: Int): Boolean
  @JvmStatic external fun nativeLoadNetwork(netId: Int, packedNet: ByteArray): Boolean
  @JvmStatic external fun nativeDropNetwork(netId: Int)
  @JvmStatic external fun nativeClearNetworks()
  @JvmStatic external fun nativeRunQuery(packedQuery: ByteArray): ByteArray?
}
