#pragma once
#include "miniaudio.h"
#include <atomic>

extern ma_decoding_backend_vtable g_streamingDecoder;
extern std::atomic<ma_uint32> g_streamTargetRate;
ma_vfs* stream_vfs();
ma_result stream_probe(const char* path, ma_uint32 targetRate, ma_uint32* nativeRate, ma_uint64* length = nullptr);
