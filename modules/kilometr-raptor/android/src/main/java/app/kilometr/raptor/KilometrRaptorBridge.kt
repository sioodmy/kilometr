package app.kilometr.raptor

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

  @JvmStatic external fun nativeHasFootTile(tx: Int, ty: Int): Boolean
  @JvmStatic external fun nativeLoadFootTile(tx: Int, ty: Int, mvtBytes: ByteArray): Boolean
  @JvmStatic external fun nativeClearFootTiles()
  @JvmStatic external fun nativeRouteFoot(packedReq: ByteArray): ByteArray?
  @JvmStatic external fun nativeInvoke(cmd: Int, payload: ByteArray): ByteArray?
}
