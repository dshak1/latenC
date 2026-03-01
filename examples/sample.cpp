// sample.cpp — A C++ file with common performance anti-patterns
// Feed this to LatencyLens to see it detect issues and suggest optimizations.

#include <iostream>
#include <map>
#include <list>
#include <vector>
#include <memory>
#include <string>
#include <thread>
#include <atomic>

// === Anti-pattern: std::map when ordering isn't needed ===
class UserCache {
    std::map<int, std::string> cache;  // Should be unordered_map!
public:
    void add(int id, const std::string& name) {
        cache[id] = name;
    }
    std::string lookup(int id) {
        auto it = cache.find(id);
        return (it != cache.end()) ? it->second : "";
    }
};

// === Anti-pattern: std::list for sequential access ===
class DataProcessor {
    std::list<double> measurements;  // Should be std::vector!
public:
    void add(double val) {
        measurements.push_back(val);
    }
    double average() {
        double sum = 0;
        for (auto& v : measurements) sum += v;  // Cache miss on every node
        return measurements.empty() ? 0 : sum / measurements.size();
    }
};

// === Anti-pattern: No reserve before push_back loop ===
std::vector<int> generateData(int n) {
    std::vector<int> result;
    // Missing: result.reserve(n);
    for (int i = 0; i < n; i++) {
        result.push_back(i * 2 + 1);  // Reallocations happening!
    }
    return result;
}

// === Anti-pattern: Virtual dispatch in hot loop ===
struct Shape {
    virtual double area() const = 0;  // vtable indirection
    virtual ~Shape() = default;
};

struct Circle : Shape {
    double radius;
    Circle(double r) : radius(r) {}
    double area() const override { return 3.14159 * radius * radius; }
};

struct Square : Shape {
    double side;
    Square(double s) : side(s) {}
    double area() const override { return side * side; }
};

// === Anti-pattern: shared_ptr when unique_ptr suffices ===
class ResourceManager {
    std::vector<std::shared_ptr<Shape>> shapes;  // shared_ptr overhead!
public:
    void addCircle(double r) {
        shapes.push_back(std::make_shared<Circle>(r));
    }
    double totalArea() {
        double total = 0;
        for (auto& s : shapes) total += s->area();
        return total;
    }
};

// === Anti-pattern: False sharing in multithreaded code ===
struct Counters {
    std::atomic<long long> reads{0};   // Same cache line!
    std::atomic<long long> writes{0};  // False sharing!
};

void worker(Counters& c, bool isWriter) {
    for (int i = 0; i < 1000000; i++) {
        if (isWriter)
            c.writes.fetch_add(1, std::memory_order_relaxed);
        else
            c.reads.fetch_add(1, std::memory_order_relaxed);
    }
}

// === Main with branchy code ===
int main() {
    UserCache cache;
    for (int i = 0; i < 10000; i++)
        cache.add(i, "user_" + std::to_string(i));

    DataProcessor proc;
    for (int i = 0; i < 100000; i++)
        proc.add(i * 0.5);

    auto data = generateData(1000000);

    // Branchy filtering — branch prediction nightmare on random data
    long long sum = 0;
    for (auto& val : data) {
        if (val > 500000)
            sum += val;
        else
            sum -= val;
    }

    ResourceManager mgr;
    for (int i = 0; i < 1000; i++)
        mgr.addCircle(i * 0.1);

    Counters counters;
    std::thread t1(worker, std::ref(counters), false);
    std::thread t2(worker, std::ref(counters), true);
    t1.join();
    t2.join();

    std::cout << "Sum: " << sum << std::endl;
    std::cout << "Avg: " << proc.average() << std::endl;
    std::cout << "Area: " << mgr.totalArea() << std::endl;
    std::cout << "R/W: " << counters.reads << "/" << counters.writes << std::endl;

    return 0;
}
