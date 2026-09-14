#pragma once

#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
  #include <xmmintrin.h>
  #include <pmmintrin.h>
  #define DMEX_HAVE_SSE_DENORMAL 1
#endif

#if defined(__aarch64__) || defined(_M_ARM64)
  #define DMEX_HAVE_ARM64_FPCR 1
#endif

struct DenormalGuard {
#if DMEX_HAVE_SSE_DENORMAL
    unsigned int savedCsr;
    DenormalGuard() {
        savedCsr = _mm_getcsr();
        _mm_setcsr(savedCsr | 0x8040u);   // FTZ (bit 15) | DAZ (bit 6)
    }
    ~DenormalGuard() { _mm_setcsr(savedCsr); }

#elif DMEX_HAVE_ARM64_FPCR
    unsigned long long savedFpcr;
    DenormalGuard() {
        __asm__ __volatile__("mrs %0, fpcr" : "=r"(savedFpcr));
        unsigned long long v = savedFpcr | (1ull << 24);   // FZ bit
        __asm__ __volatile__("msr fpcr, %0" : : "r"(v));
    }
    ~DenormalGuard() {
        __asm__ __volatile__("msr fpcr, %0" : : "r"(savedFpcr));
    }
#else
    DenormalGuard() {}
#endif
};

static inline float dmexFlush(float v) {
    return (std::fabs(v) < 1.0e-25f) ? 0.0f : v;
}
