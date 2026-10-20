use std::sync::{mpsc, OnceLock};

struct Request {
    op: i32,
    a: i32,
    b: i32,
    data: Vec<u8>,
    reply: mpsc::SyncSender<Vec<u8>>,
}

// Rejestry RAPTOR-a są thread_local; wszystkie wywołania iOS muszą używać jednego wątku.
fn call(op: i32, a: i32, b: i32, data: Vec<u8>) -> Vec<u8> {
    static WORKER: OnceLock<mpsc::Sender<Request>> = OnceLock::new();
    let sender = WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Request>();
        std::thread::Builder::new()
            .name("kilometr-raptor".into())
            .spawn(move || {
                for req in rx {
                    let result = match req.op {
                        0 => vec![u8::from(crate::raptor::has_network(req.a))],
                        1 => vec![u8::from(crate::raptor::load_network(req.a, &req.data))],
                        2 => { crate::raptor::drop_network(req.a); Vec::new() }
                        3 => { crate::raptor::clear_networks(); Vec::new() }
                        4 => crate::raptor::execute_query_bytes(&req.data),
                        5 => vec![u8::from(crate::foot_router::has_foot_tile(req.a, req.b))],
                        6 => vec![u8::from(crate::foot_router::load_foot_tile(req.a, req.b, &req.data))],
                        7 => { crate::foot_router::clear_foot_tiles(); Vec::new() }
                        8 => crate::foot_router::execute_foot_route_bytes(&req.data),
                        9 => crate::dispatch_invoke(req.a, &req.data),
                        _ => Vec::new(),
                    };
                    let _ = req.reply.send(result);
                }
            })
            .expect("RAPTOR worker");
        tx
    });
    let (reply, rx) = mpsc::sync_channel(1);
    if sender.send(Request { op, a, b, data, reply }).is_err() {
        return Vec::new();
    }
    rx.recv().unwrap_or_default()
}

#[no_mangle]
pub unsafe extern "C" fn kilometr_ios_call(
    op: i32, a: i32, b: i32, input: *const u8, len: usize, out_len: *mut usize,
) -> *mut u8 {
    if out_len.is_null() { return std::ptr::null_mut(); }
    let data = if input.is_null() || len == 0 {
        Vec::new()
    } else {
        unsafe { std::slice::from_raw_parts(input, len) }.to_vec()
    };
    let result = call(op, a, b, data).into_boxed_slice();
    unsafe { *out_len = result.len(); }
    if result.is_empty() { return std::ptr::null_mut(); }
    Box::into_raw(result) as *mut u8
}

#[no_mangle]
pub unsafe extern "C" fn kilometr_ios_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffi_copies_input_and_owns_output() {
        for _ in 0..32 {
            let mut len = 0;
            let ptr = unsafe { kilometr_ios_call(0, -999, 0, std::ptr::null(), 0, &mut len) };
            assert_eq!(len, 1);
            assert_eq!(unsafe { *ptr }, 0);
            unsafe { kilometr_ios_free(ptr, len); }
        }
    }

    #[test]
    fn concurrent_callers_share_worker() {
        let workers: Vec<_> = (0..8).map(|_| std::thread::spawn(|| {
            for _ in 0..20 {
                assert_eq!(call(0, -998, 0, vec![]), vec![0]);
                assert!(call(9, -1, 0, vec![]).is_empty());
            }
        })).collect();
        for worker in workers { worker.join().unwrap(); }
    }
}
