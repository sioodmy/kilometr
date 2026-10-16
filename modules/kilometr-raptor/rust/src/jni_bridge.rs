use std::ffi::c_void;
use std::panic::catch_unwind;

use crate::foot_router;
use crate::raptor;

pub type JniEnv = *const *const *const c_void;
pub type JClass = *mut c_void;
pub type JByteArray = *mut c_void;
pub type JInt = i32;
pub type JSize = i32;
pub type JBoolean = u8;

const JNI_FALSE: JBoolean = 0;
const JNI_TRUE: JBoolean = 1;

// Validated against <jni.h> struct JNINativeInterface_
const IDX_GET_ARRAY_LENGTH: usize = 171;
const IDX_NEW_BYTE_ARRAY: usize = 176;
const IDX_GET_BYTE_ARRAY_REGION: usize = 200;
const IDX_SET_BYTE_ARRAY_REGION: usize = 208;

type GetArrayLengthFn = unsafe extern "C" fn(JniEnv, JByteArray) -> JSize;
type NewByteArrayFn = unsafe extern "C" fn(JniEnv, JSize) -> JByteArray;
type GetByteArrayRegionFn = unsafe extern "C" fn(JniEnv, JByteArray, JSize, JSize, *mut u8);
type SetByteArrayRegionFn = unsafe extern "C" fn(JniEnv, JByteArray, JSize, JSize, *const u8);

unsafe fn read_jbyte_array(env: JniEnv, arr: JByteArray) -> Option<Vec<u8>> {
    if env.is_null() || arr.is_null() {
        return None;
    }
    let vtable = unsafe { *env };
    if vtable.is_null() {
        return None;
    }
    let get_len: GetArrayLengthFn =
        unsafe { std::mem::transmute(*vtable.add(IDX_GET_ARRAY_LENGTH)) };
    let len = unsafe { get_len(env, arr) };
    if len < 0 {
        return None;
    }
    let usize_len = len as usize;
    let mut buf = vec![0_u8; usize_len];
    if usize_len > 0 {
        let get_region: GetByteArrayRegionFn =
            unsafe { std::mem::transmute(*vtable.add(IDX_GET_BYTE_ARRAY_REGION)) };
        unsafe { get_region(env, arr, 0, len, buf.as_mut_ptr()) };
    }
    Some(buf)
}

unsafe fn write_jbyte_array(env: JniEnv, data: &[u8]) -> JByteArray {
    if env.is_null() {
        return std::ptr::null_mut();
    }
    let vtable = unsafe { *env };
    if vtable.is_null() {
        return std::ptr::null_mut();
    }
    let Ok(len) = JSize::try_from(data.len()) else {
        return std::ptr::null_mut();
    };
    let new_arr: NewByteArrayFn = unsafe { std::mem::transmute(*vtable.add(IDX_NEW_BYTE_ARRAY)) };
    let jarr = unsafe { new_arr(env, len) };
    if jarr.is_null() {
        return std::ptr::null_mut();
    }
    if len > 0 {
        let set_region: SetByteArrayRegionFn =
            unsafe { std::mem::transmute(*vtable.add(IDX_SET_BYTE_ARRAY_REGION)) };
        unsafe { set_region(env, jarr, 0, len, data.as_ptr()) };
    }
    jarr
}

#[no_mangle]
pub unsafe extern "C" fn Java_my_siood_kilometr_raptor_KilometrRaptorBridge_nativeHasNetwork(
    _env: JniEnv,
    _class: JClass,
    net_id: JInt,
) -> JBoolean {
    let ok = catch_unwind(|| raptor::has_network(net_id)).unwrap_or(false);
    if ok { JNI_TRUE } else { JNI_FALSE }
}

#[no_mangle]
pub unsafe extern "C" fn Java_my_siood_kilometr_raptor_KilometrRaptorBridge_nativeLoadNetwork(
    env: JniEnv,
    _class: JClass,
    net_id: JInt,
    packed_net: JByteArray,
) -> JBoolean {
    let Some(bytes) = (unsafe { read_jbyte_array(env, packed_net) }) else {
        return JNI_FALSE;
    };
    let ok = catch_unwind(|| raptor::load_network(net_id, &bytes)).unwrap_or(false);
    if ok { JNI_TRUE } else { JNI_FALSE }
}

#[no_mangle]
pub unsafe extern "C" fn Java_my_siood_kilometr_raptor_KilometrRaptorBridge_nativeDropNetwork(
    _env: JniEnv,
    _class: JClass,
    net_id: JInt,
) {
    let _ = catch_unwind(|| raptor::drop_network(net_id));
}

#[no_mangle]
pub unsafe extern "C" fn Java_my_siood_kilometr_raptor_KilometrRaptorBridge_nativeClearNetworks(
    _env: JniEnv,
    _class: JClass,
) {
    let _ = catch_unwind(raptor::clear_networks);
}

#[no_mangle]
pub unsafe extern "C" fn Java_my_siood_kilometr_raptor_KilometrRaptorBridge_nativeRunQuery(
    env: JniEnv,
    _class: JClass,
    packed_query: JByteArray,
) -> JByteArray {
    let Some(bytes) = (unsafe { read_jbyte_array(env, packed_query) }) else {
        return std::ptr::null_mut();
    };
    let Ok(out) = catch_unwind(|| raptor::execute_query_bytes(&bytes)) else {
        return std::ptr::null_mut();
    };
    unsafe { write_jbyte_array(env, &out) }
}

#[no_mangle]
pub unsafe extern "C" fn Java_my_siood_kilometr_raptor_KilometrRaptorBridge_nativeHasFootTile(
    _env: JniEnv,
    _class: JClass,
    tx: JInt,
    ty: JInt,
) -> JBoolean {
    let ok = catch_unwind(|| foot_router::has_foot_tile(tx, ty)).unwrap_or(false);
    if ok { JNI_TRUE } else { JNI_FALSE }
}

#[no_mangle]
pub unsafe extern "C" fn Java_my_siood_kilometr_raptor_KilometrRaptorBridge_nativeLoadFootTile(
    env: JniEnv,
    _class: JClass,
    tx: JInt,
    ty: JInt,
    mvt_bytes: JByteArray,
) -> JBoolean {
    let Some(bytes) = (unsafe { read_jbyte_array(env, mvt_bytes) }) else {
        return JNI_FALSE;
    };
    let ok = catch_unwind(|| foot_router::load_foot_tile(tx, ty, &bytes)).unwrap_or(false);
    if ok { JNI_TRUE } else { JNI_FALSE }
}

#[no_mangle]
pub unsafe extern "C" fn Java_my_siood_kilometr_raptor_KilometrRaptorBridge_nativeClearFootTiles(
    _env: JniEnv,
    _class: JClass,
) {
    let _ = catch_unwind(foot_router::clear_foot_tiles);
}

#[no_mangle]
pub unsafe extern "C" fn Java_my_siood_kilometr_raptor_KilometrRaptorBridge_nativeRouteFoot(
    env: JniEnv,
    _class: JClass,
    packed_req: JByteArray,
) -> JByteArray {
    let Some(bytes) = (unsafe { read_jbyte_array(env, packed_req) }) else {
        return std::ptr::null_mut();
    };
    let Ok(out) = catch_unwind(|| foot_router::execute_foot_route_bytes(&bytes)) else {
        return std::ptr::null_mut();
    };
    unsafe { write_jbyte_array(env, &out) }
}

#[no_mangle]
pub unsafe extern "C" fn Java_my_siood_kilometr_raptor_KilometrRaptorBridge_nativeInvoke(
    env: JniEnv,
    _class: JClass,
    cmd: JInt,
    payload: JByteArray,
) -> JByteArray {
    let Some(bytes) = (unsafe { read_jbyte_array(env, payload) }) else {
        return std::ptr::null_mut();
    };
    let Ok(out) = catch_unwind(|| crate::dispatch_invoke(cmd, &bytes)) else {
        return std::ptr::null_mut();
    };
    unsafe { write_jbyte_array(env, &out) }
}
