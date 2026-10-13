pub mod jni_bridge;
pub mod raptor;

use std::cell::RefCell;

thread_local! {
    static LAST_RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
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
