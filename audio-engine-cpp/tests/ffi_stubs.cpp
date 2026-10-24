#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <atomic>
#include "miniaudio.h"
namespace {
std::atomic<unsigned> streamReads{0};
struct DecoderStub { ma_decoder decoder{}; bool unknownLength{}; };
}
extern "C" unsigned test_stream_reads() { return streamReads.load(); }
extern "C" char* rust_prepare_audio_file(const char* path, unsigned) {
    char* copy = static_cast<char*>(std::malloc(std::strlen(path) + 1));
    if (copy) std::strcpy(copy, path);
    return copy;
}
extern "C" void rust_free_audio_path(char* path) { std::free(path); }
// Decoder/SRC behavior is tested in Rust; this harness isolates native graph routing.
extern "C" char* rust_prepare_impulse(const char* path, unsigned rate) { return rust_prepare_audio_file(path,rate); }
extern "C" {
struct StreamInfo { uint32_t rate, channels; uint64_t length, cursor; };
void* rust_stream_open(const char* path, uint32_t rate) {
    auto* stream = new DecoderStub{};
    stream->unknownLength = std::strstr(path, "unknown-length") != nullptr;
    auto config = ma_decoder_config_init(ma_format_f32, 0, rate);
    if (ma_decoder_init_file(path, &config, &stream->decoder) != MA_SUCCESS) { delete stream; return nullptr; }
    return stream;
}
void rust_stream_close(void* handle) { auto* stream = static_cast<DecoderStub*>(handle); ma_decoder_uninit(&stream->decoder); delete stream; }
int rust_stream_info(void* handle, StreamInfo* info) {
    auto* stream = static_cast<DecoderStub*>(handle);
    auto* decoder = &stream->decoder;
    info->rate = decoder->outputSampleRate; info->channels = decoder->outputChannels;
    ma_decoder_get_length_in_pcm_frames(decoder, &info->length);
    if (stream->unknownLength) info->length = UINT64_MAX;
    return ma_decoder_get_cursor_in_pcm_frames(decoder, &info->cursor);
}
int64_t rust_stream_read(void* handle, float* output, uint64_t frames) {
    streamReads.fetch_add(1);
    ma_uint64 count = 0;
    auto result = ma_decoder_read_pcm_frames(&static_cast<DecoderStub*>(handle)->decoder, output, frames, &count);
    return result == MA_SUCCESS || result == MA_AT_END ? static_cast<int64_t>(count) : -1;
}
int rust_stream_seek(void* handle, uint64_t frame) { return ma_decoder_seek_to_pcm_frame(&static_cast<DecoderStub*>(handle)->decoder, frame); }
}
