/**
 * LatencyLens — Lock-Free SPSC Ring Buffer
 * 
 * Single-Producer Single-Consumer (SPSC) lock-free queue.
 * Demonstrates:
 *   - std::atomic with memory ordering (acquire/release/relaxed)
 *   - Cache-line padding to prevent false sharing
 *   - Power-of-2 masking for branchless modulo
 *   - Memory fences and happens-before reasoning
 *
 * Used for streaming analysis results from the analyzer thread
 * to the output serialization thread without locking.
 */

#pragma once

#include <atomic>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <new>
#include <optional>
#include <type_traits>

namespace ll {

// ── Cache line size detection ────────────────────────────────────────

#ifdef __cpp_lib_hardware_interference_size
inline constexpr size_t CACHELINE = std::hardware_destructive_interference_size;
#else
inline constexpr size_t CACHELINE = 64;
#endif

// ── SPSC Ring Buffer ─────────────────────────────────────────────────

/**
 * Lock-free single-producer single-consumer bounded queue.
 * 
 * Capacity is rounded up to the next power of 2 for branchless indexing.
 * Uses separated cache lines for head/tail to eliminate false sharing.
 *
 * Memory ordering:
 *   - Producer: release store on tail (publishes written data)
 *   - Consumer: acquire load on tail (sees producer's writes)
 *   - Consumer: release store on head (signals slots are free)
 *   - Producer: acquire load on head (sees consumer's progress)
 */
template <typename T, size_t Capacity = 1024>
class SPSCQueue {
    static_assert(std::is_nothrow_move_constructible_v<T> || std::is_trivially_copyable_v<T>,
                  "T must be nothrow-movable or trivially-copyable for lock-free safety");

    // Round up to power of 2
    static constexpr size_t round_up_pow2(size_t v) {
        --v;
        v |= v >> 1;  v |= v >> 2;
        v |= v >> 4;  v |= v >> 8;
        v |= v >> 16; v |= v >> 32;
        return v + 1;
    }

    static constexpr size_t SIZE = round_up_pow2(Capacity);
    static constexpr size_t MASK = SIZE - 1;

    // Storage: uninitialized to avoid default-constructing T
    alignas(T) std::byte storage_[SIZE * sizeof(T)];

    // Separate cache lines for head and tail to avoid false sharing
    alignas(CACHELINE) std::atomic<size_t> head_{0};  // read index  (consumer writes, producer reads)
    alignas(CACHELINE) std::atomic<size_t> tail_{0};  // write index (producer writes, consumer reads)

    // Cached positions to reduce cross-core atomic reads
    alignas(CACHELINE) size_t cached_head_{0};  // producer's cached copy of head
    alignas(CACHELINE) size_t cached_tail_{0};  // consumer's cached copy of tail

    T* slot(size_t idx) {
        return std::launder(reinterpret_cast<T*>(&storage_[(idx & MASK) * sizeof(T)]));
    }

    const T* slot(size_t idx) const {
        return std::launder(reinterpret_cast<const T*>(&storage_[(idx & MASK) * sizeof(T)]));
    }

public:
    SPSCQueue() = default;

    ~SPSCQueue() {
        // Destroy any remaining elements
        size_t h = head_.load(std::memory_order_relaxed);
        size_t t = tail_.load(std::memory_order_relaxed);
        while (h != t) {
            slot(h)->~T();
            ++h;
        }
    }

    // Non-copyable, non-movable (atomic members)
    SPSCQueue(const SPSCQueue&) = delete;
    SPSCQueue& operator=(const SPSCQueue&) = delete;

    /**
     * Try to enqueue an element. Called by the PRODUCER only.
     * Returns false if the queue is full.
     *
     * Memory ordering:
     *   1. Read head with acquire to see consumer's latest progress
     *   2. Construct element in slot
     *   3. Release store on tail to publish the new element
     */
    template <typename... Args>
    bool try_push(Args&&... args) {
        const size_t tail = tail_.load(std::memory_order_relaxed);
        const size_t next = tail + 1;

        // Check if full — use cached head first (fast path, no atomic read)
        if (next - cached_head_ > SIZE) {
            cached_head_ = head_.load(std::memory_order_acquire);
            if (next - cached_head_ > SIZE) {
                return false; // genuinely full
            }
        }

        // Construct element in-place
        ::new (slot(tail)) T(std::forward<Args>(args)...);

        // Publish — release ensures the construction is visible before tail advances
        tail_.store(next, std::memory_order_release);
        return true;
    }

    /**
     * Try to dequeue an element. Called by the CONSUMER only.
     * Returns std::nullopt if the queue is empty.
     */
    std::optional<T> try_pop() {
        const size_t head = head_.load(std::memory_order_relaxed);

        // Check if empty — use cached tail first
        if (head == cached_tail_) {
            cached_tail_ = tail_.load(std::memory_order_acquire);
            if (head == cached_tail_) {
                return std::nullopt; // genuinely empty
            }
        }

        // Move element out and destroy in-place
        T* elem = slot(head);
        std::optional<T> result(std::move(*elem));
        elem->~T();

        // Signal the slot is free — release ensures the destruction is visible
        head_.store(head + 1, std::memory_order_release);
        return result;
    }

    /**
     * Peek at the front element without removing it. CONSUMER only.
     */
    const T* front() const {
        const size_t head = head_.load(std::memory_order_relaxed);
        const size_t tail = tail_.load(std::memory_order_acquire);
        if (head == tail) return nullptr;
        return slot(head);
    }

    // ── Queries (safe from any thread) ───────────────────

    bool empty() const {
        return head_.load(std::memory_order_acquire) == tail_.load(std::memory_order_acquire);
    }

    size_t size_approx() const {
        auto t = tail_.load(std::memory_order_acquire);
        auto h = head_.load(std::memory_order_acquire);
        return t >= h ? t - h : 0;
    }

    static constexpr size_t capacity() { return SIZE; }
};

} // namespace ll
