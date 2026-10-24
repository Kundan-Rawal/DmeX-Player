#include "StreamingDecoder.h"
#include <cstdint>
#include <limits>
#include <new>
#include <filesystem>
#include <string>

extern "C" {
struct StreamInfo { uint32_t rate, channels; uint64_t length, cursor; };
void* rust_stream_open(const char*, uint32_t);
void rust_stream_close(void*);
int rust_stream_info(void*, StreamInfo*);
int64_t rust_stream_read(void*, float*, uint64_t);
int rust_stream_seek(void*, uint64_t);
}

std::atomic<ma_uint32> g_streamTargetRate{48000};
namespace {
// The resource manager initializes decoders through VFS callbacks, not
// onInitFile. Retain each VFS path so Symphonia can own an independent reader.
struct StreamFile { ma_vfs_file file{}; std::string path; };
ma_vfs* defaultVfs() {
    static ma_default_vfs vfs = [] { ma_default_vfs value{}; ma_default_vfs_init(&value, nullptr); return value; }();
    return &vfs;
}
ma_result openFile(ma_vfs*, const char* path, ma_uint32 mode, ma_vfs_file* output) {
    if (!path || !output) return MA_INVALID_ARGS;
    *output = nullptr;
    auto* file = new (std::nothrow) StreamFile{};
    if (!file) return MA_OUT_OF_MEMORY;
    try { file->path = path; } catch (...) { delete file; return MA_OUT_OF_MEMORY; }
    const auto result = ma_vfs_open(defaultVfs(), path, mode, &file->file);
    if (result != MA_SUCCESS) { delete file; return result; }
    *output = file;
    return MA_SUCCESS;
}
ma_result openWide(ma_vfs* vfs, const wchar_t* path, ma_uint32 mode, ma_vfs_file* output) {
    try { return openFile(vfs, std::filesystem::path(path).u8string().c_str(), mode, output); }
    catch (...) { return MA_INVALID_FILE; }
}
ma_result closeFile(ma_vfs*, ma_vfs_file value) {
    auto* file = static_cast<StreamFile*>(value);
    const auto result = ma_vfs_close(defaultVfs(), file->file); delete file; return result;
}
ma_result readFile(ma_vfs*, ma_vfs_file file, void* output, size_t bytes, size_t* read) {
    return ma_vfs_read(defaultVfs(), static_cast<StreamFile*>(file)->file, output, bytes, read);
}
ma_result writeFile(ma_vfs*, ma_vfs_file file, const void* input, size_t bytes, size_t* written) {
    return ma_vfs_write(defaultVfs(), static_cast<StreamFile*>(file)->file, input, bytes, written);
}
ma_result seekFile(ma_vfs*, ma_vfs_file file, ma_int64 offset, ma_seek_origin origin) {
    return ma_vfs_seek(defaultVfs(), static_cast<StreamFile*>(file)->file, offset, origin);
}
ma_result tellFile(ma_vfs*, ma_vfs_file file, ma_int64* cursor) {
    return ma_vfs_tell(defaultVfs(), static_cast<StreamFile*>(file)->file, cursor);
}
ma_result infoFile(ma_vfs*, ma_vfs_file file, ma_file_info* info) {
    return ma_vfs_info(defaultVfs(), static_cast<StreamFile*>(file)->file, info);
}
ma_vfs_callbacks pathVfs{openFile, openWide, closeFile, readFile, writeFile, seekFile, tellFile, infoFile};
struct StreamSource { ma_data_source_base base; void* handle; StreamInfo info; };
ma_result read(ma_data_source* source, void* output, ma_uint64 frames, ma_uint64* count) {
    const auto result = rust_stream_read(reinterpret_cast<StreamSource*>(source)->handle, static_cast<float*>(output), frames);
    if (count) *count = result >= 0 ? static_cast<ma_uint64>(result) : 0;
    return result < 0 ? MA_ERROR : result == 0 ? MA_AT_END : MA_SUCCESS;
}
ma_result seek(ma_data_source* source, ma_uint64 frame) {
    return rust_stream_seek(reinterpret_cast<StreamSource*>(source)->handle, frame) == 0 ? MA_SUCCESS : MA_BAD_SEEK;
}
ma_result format(ma_data_source* source, ma_format* formatOut, ma_uint32* channels, ma_uint32* rate, ma_channel* map, size_t mapCapacity) {
    auto* stream = reinterpret_cast<StreamSource*>(source);
    if (formatOut) *formatOut = ma_format_f32;
    if (channels) *channels = stream->info.channels;
    if (rate) *rate = stream->info.rate;
    if (map) ma_channel_map_init_standard(ma_standard_channel_map_default, map, mapCapacity, stream->info.channels);
    return MA_SUCCESS;
}
ma_result cursor(ma_data_source* source, ma_uint64* value) {
    if (!value) return MA_INVALID_ARGS;
    auto* stream = reinterpret_cast<StreamSource*>(source);
    StreamInfo info{};
    if (rust_stream_info(stream->handle, &info) != 0) return MA_ERROR;
    *value = info.cursor;
    return MA_SUCCESS;
}
ma_result length(ma_data_source* source, ma_uint64* value) {
    if (!value) return MA_INVALID_ARGS;
    const auto frames = reinterpret_cast<StreamSource*>(source)->info.length;
    *value = frames == std::numeric_limits<uint64_t>::max() ? 0 : frames;
    return frames == std::numeric_limits<uint64_t>::max() ? MA_NOT_IMPLEMENTED : MA_SUCCESS;
}
const ma_data_source_vtable sourceVTable{ read, seek, format, cursor, length, nullptr, 0 };
ma_result initFile(void*, const char* path, const ma_decoding_backend_config*, const ma_allocation_callbacks*, ma_data_source** output) {
    if (!path || !output) return MA_INVALID_ARGS;
    *output = nullptr;
    auto* source = new (std::nothrow) StreamSource{};
    if (!source) return MA_OUT_OF_MEMORY;
    source->handle = rust_stream_open(path, g_streamTargetRate.load());
    if (!source->handle || rust_stream_info(source->handle, &source->info) != 0) {
        if (source->handle) rust_stream_close(source->handle);
        delete source; return MA_INVALID_FILE;
    }
    auto config = ma_data_source_config_init(); config.vtable = &sourceVTable;
    const auto result = ma_data_source_init(&config, &source->base);
    if (result != MA_SUCCESS) { rust_stream_close(source->handle); delete source; return result; }
    *output = reinterpret_cast<ma_data_source*>(source);
    return MA_SUCCESS;
}
ma_result initCallbacks(void*, ma_read_proc, ma_seek_proc, ma_tell_proc, void* user, const ma_decoding_backend_config* config, const ma_allocation_callbacks* allocations, ma_data_source** output) {
    auto* decoder = static_cast<ma_decoder*>(user);
    if (!decoder || decoder->data.vfs.pVFS != stream_vfs() || !decoder->data.vfs.file) return MA_NOT_IMPLEMENTED;
    return initFile(nullptr, static_cast<StreamFile*>(decoder->data.vfs.file)->path.c_str(), config, allocations, output);
}
void uninit(void*, ma_data_source* backend, const ma_allocation_callbacks*) {
    auto* source = reinterpret_cast<StreamSource*>(backend);
    ma_data_source_uninit(&source->base);
    rust_stream_close(source->handle);
    delete source;
}
}
ma_decoding_backend_vtable g_streamingDecoder{ initCallbacks, initFile, nullptr, nullptr, uninit };
ma_vfs* stream_vfs() { return &pathVfs; }

ma_result stream_probe(const char* path, ma_uint32 targetRate, ma_uint32* nativeRate, ma_uint64* length) {
    auto* handle = rust_stream_open(path, targetRate);
    if (!handle) return MA_INVALID_FILE;
    StreamInfo info{};
    const int result = rust_stream_info(handle, &info);
    rust_stream_close(handle);
    if (result != 0) return MA_ERROR;
    if (nativeRate) *nativeRate = info.rate;
    if (length) *length = info.length;
    return MA_SUCCESS;
}
