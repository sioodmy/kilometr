pub mod address;
pub mod foot_router;
pub mod jni_bridge;
pub mod live;
pub mod raptor;
pub mod search;
pub mod trip_engine;
#[cfg(any(target_os = "ios", test))]
mod ios_bridge;

use std::cell::RefCell;

thread_local! {
    static LAST_RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static INPUT_SCRATCH: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

pub fn dispatch_invoke(cmd: i32, payload: &[u8]) -> Vec<u8> {
    match cmd {
        10 => search::handle_fuzzy_cmd(payload),
        11 => search::handle_load_stops_cmd(payload),
        12 => search::handle_stops_query_cmd(payload),
        13 => search::handle_poi_cmd(payload),
        14 => search::handle_dedupe_and_sort_cmd(payload),
        15 => search::handle_smart_rank_cmd(payload),
        16 => search::handle_raptor_integration_cmd(payload),
        17 => address::handle_address_cmd(payload),
        20 => live::handle_live_load_schedule_cmd(payload),
        21 => live::handle_live_match_batch_cmd(payload),
        22 => live::handle_match_zb_kd_cmd(payload),
        23 => live::handle_match_vehicle_to_leg_cmd(payload),
        24 => live::handle_route_geometry_cmd(payload),
        30 => trip_engine::handle_vehicle_position_cmd(payload),
        31 => trip_engine::handle_plan_match_cmd(payload),
        32 => trip_engine::handle_turn_maneuver_cmd(payload),
        33 => trip_engine::handle_trip_progress_cmd(payload),
        _ => Vec::new(),
    }
}

#[no_mangle]
pub extern "C" fn raptor_alloc(size: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn raptor_dealloc(ptr: *mut u8, size: usize) {
    if !ptr.is_null() && size > 0 {
        let _ = unsafe { Vec::from_raw_parts(ptr, 0, size) };
    }
}

/// Zwraca wskaźnik na reużywalny bufor wejściowy o pojemności co najmniej `min_cap`,
/// eliminując narzut `alloc`/`dealloc` przy częstych wywołaniach WASM.
#[no_mangle]
pub extern "C" fn raptor_scratch_ptr(min_cap: usize) -> *mut u8 {
    INPUT_SCRATCH.with(|cell| {
        let mut guard = cell.borrow_mut();
        if guard.len() < min_cap {
            guard.resize(min_cap.next_power_of_two().max(4096), 0);
        }
        guard.as_mut_ptr()
    })
}

/// Uniwersalny dyspozytor binarnych komend silnika (wyszukiwarka, liveTracker,
/// tripProgress, planMatch, smartRanking, geometria, nawigacja).
#[no_mangle]
pub unsafe extern "C" fn raptor_invoke(cmd: i32, ptr: *const u8, len: usize) -> usize {
    let slice = if ptr.is_null() || len == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(ptr, len) }
    };
    let out = dispatch_invoke(cmd, slice);
    LAST_RESULT.with(|cell| {
        let mut guard = cell.borrow_mut();
        *guard = out;
        guard.len()
    })
}

#[no_mangle]
pub extern "C" fn raptor_has_network(net_id: i32) -> i32 {
    i32::from(raptor::has_network(net_id))
}

#[no_mangle]
pub unsafe extern "C" fn raptor_load_network(net_id: i32, ptr: *const u8, len: usize) -> i32 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    i32::from(raptor::load_network(net_id, slice))
}

#[no_mangle]
pub extern "C" fn raptor_drop_network(net_id: i32) {
    raptor::drop_network(net_id);
}

#[no_mangle]
pub extern "C" fn raptor_clear_networks() {
    raptor::clear_networks();
}

#[no_mangle]
pub unsafe extern "C" fn raptor_run_query(ptr: *const u8, len: usize) -> usize {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    let out = raptor::execute_query_bytes(slice);
    LAST_RESULT.with(|cell| {
        let mut guard = cell.borrow_mut();
        *guard = out;
        guard.len()
    })
}

#[no_mangle]
pub extern "C" fn raptor_result_ptr() -> *const u8 {
    LAST_RESULT.with(|cell| cell.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn raptor_has_foot_tile(tx: i32, ty: i32) -> i32 {
    i32::from(foot_router::has_foot_tile(tx, ty))
}

#[no_mangle]
pub unsafe extern "C" fn raptor_load_foot_tile(
    tx: i32,
    ty: i32,
    ptr: *const u8,
    len: usize,
) -> i32 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    i32::from(foot_router::load_foot_tile(tx, ty, slice))
}

#[no_mangle]
pub extern "C" fn raptor_clear_foot_tiles() {
    foot_router::clear_foot_tiles();
}

#[no_mangle]
pub unsafe extern "C" fn raptor_route_foot(ptr: *const u8, len: usize) -> usize {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    let out = foot_router::execute_foot_route_bytes(slice);
    LAST_RESULT.with(|cell| {
        let mut guard = cell.borrow_mut();
        *guard = out;
        guard.len()
    })
}
