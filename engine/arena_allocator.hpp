/**
 * LatencyLens — Arena Allocator
 * 
 * Monotonic bump allocator with configurable block size.
 * Demonstrates:
 *   - Custom allocator design (STL-compatible)
 *   - Memory alignment (alignas, std::align)
 *   - RAII resource management
 *   - Move semantics (non-copyable, movable)
 *   - Cache-friendly allocation patterns
 *
 * Used by the analyzer's token storage to avoid per-token heap allocs.
 */

#pragma once

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace ll {

// ── Monotonic Arena ──────────────────────────────────────────────────

class Arena {
    static constexpr size_t DEFAULT_BLOCK_SIZE = 64 * 1024; // 64 KB

    struct Block {
        std::unique_ptr<std::byte[]> data;
        size_t size;
        size_t used;

        explicit Block(size_t sz)
            : data(std::make_unique<std::byte[]>(sz)), size(sz), used(0) {}

        // Attempt to allocate within this block, respecting alignment
        void* try_alloc(size_t bytes, size_t alignment) {
            void* ptr = data.get() + used;
            size_t space = size - used;
            if (std::align(alignment, bytes, ptr, space)) {
                used = static_cast<size_t>(static_cast<std::byte*>(ptr) - data.get()) + bytes;
                return ptr;
            }
            return nullptr;
        }
    };

    std::vector<Block> blocks_;
    size_t block_size_;

    // Stats
    size_t total_allocated_ = 0;
    size_t total_used_      = 0;
    size_t allocation_count_ = 0;

public:
    explicit Arena(size_t block_size = DEFAULT_BLOCK_SIZE)
        : block_size_(block_size) {
        blocks_.emplace_back(block_size_);
    }

    // Non-copyable, movable
    Arena(const Arena&) = delete;
    Arena& operator=(const Arena&) = delete;
    Arena(Arena&&) noexcept = default;
    Arena& operator=(Arena&&) noexcept = default;

    /**
     * Allocate `bytes` of memory with given alignment.
     * Never returns nullptr — allocates a new block if needed.
     */
    [[nodiscard]] void* allocate(size_t bytes, size_t alignment = alignof(std::max_align_t)) {
        assert(bytes > 0);
        ++allocation_count_;
        total_used_ += bytes;

        // Try current block first
        if (void* ptr = blocks_.back().try_alloc(bytes, alignment)) {
            return ptr;
        }

        // Need a new block — size is max(default, requested + alignment padding)
        size_t new_size = std::max(block_size_, bytes + alignment);
        blocks_.emplace_back(new_size);
        total_allocated_ += new_size;

        void* ptr = blocks_.back().try_alloc(bytes, alignment);
        assert(ptr && "Fresh block allocation must succeed");
        return ptr;
    }

    /**
     * Construct a T in arena memory. Perfectly forwards constructor args.
     */
    template <typename T, typename... Args>
    [[nodiscard]] T* create(Args&&... args) {
        void* mem = allocate(sizeof(T), alignof(T));
        return ::new (mem) T(std::forward<Args>(args)...);
    }

    /**
     * Allocate an array of T in arena memory.
     */
    template <typename T>
    [[nodiscard]] T* create_array(size_t count) {
        void* mem = allocate(sizeof(T) * count, alignof(T));
        T* arr = static_cast<T*>(mem);
        if constexpr (!std::is_trivially_default_constructible_v<T>) {
            for (size_t i = 0; i < count; ++i) {
                ::new (&arr[i]) T();
            }
        }
        return arr;
    }

    /**
     * Copy a string into arena memory. Returns a stable pointer.
     */
    [[nodiscard]] const char* intern_string(const char* str, size_t len) {
        char* mem = static_cast<char*>(allocate(len + 1, 1));
        std::memcpy(mem, str, len);
        mem[len] = '\0';
        return mem;
    }

    [[nodiscard]] const char* intern_string(const std::string& s) {
        return intern_string(s.data(), s.size());
    }

    /**
     * Reset all allocations. Memory is retained for reuse.
     */
    void reset() {
        for (auto& block : blocks_) {
            block.used = 0;
        }
        total_used_ = 0;
        allocation_count_ = 0;
    }

    // ── Stats ────────────────────────────────────────────

    size_t bytes_used() const { return total_used_; }
    size_t bytes_allocated() const {
        size_t total = 0;
        for (auto& b : blocks_) total += b.size;
        return total;
    }
    size_t block_count() const { return blocks_.size(); }
    size_t num_allocations() const { return allocation_count_; }

    double fragmentation() const {
        size_t alloc = bytes_allocated();
        return alloc > 0 ? 1.0 - static_cast<double>(total_used_) / alloc : 0;
    }
};

// ── STL-Compatible Allocator Adapter ─────────────────────────────────

template <typename T>
class ArenaAllocator {
    Arena* arena_;

public:
    using value_type = T;
    using size_type = size_t;
    using difference_type = ptrdiff_t;
    using propagate_on_container_move_assignment = std::true_type;

    explicit ArenaAllocator(Arena& arena) noexcept : arena_(&arena) {}

    template <typename U>
    ArenaAllocator(const ArenaAllocator<U>& other) noexcept : arena_(other.arena()) {}

    [[nodiscard]] T* allocate(size_t n) {
        return static_cast<T*>(arena_->allocate(n * sizeof(T), alignof(T)));
    }

    void deallocate(T*, size_t) noexcept {
        // Arena allocator — deallocation is a no-op
    }

    Arena* arena() const noexcept { return arena_; }

    template <typename U>
    bool operator==(const ArenaAllocator<U>& other) const noexcept {
        return arena_ == other.arena();
    }

    template <typename U>
    bool operator!=(const ArenaAllocator<U>& other) const noexcept {
        return !(*this == other);
    }
};

// ── Type aliases for arena-backed containers ─────────────────────────

template <typename T>
using ArenaVector = std::vector<T, ArenaAllocator<T>>;

using ArenaString = std::basic_string<char, std::char_traits<char>, ArenaAllocator<char>>;

} // namespace ll
