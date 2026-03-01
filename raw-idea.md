- C++ for quants
    
    a friend of mine had inspired me to start coding out minimalistic examples of everything I can when I am learning and after trying it, I never looked back. I realized I when I was helping my friends with a coding assignment, their C++ code looked more like python [insert some naive c++ code]. Like yes, syntax wise its correct but it feels a bit like using an RPG as a walking stick. And while it may be enough for completing our assignments for courses, when trying to go deep and get really good at a niche, the devil is in the details. 
    
    As humans we are quick to spot others mistakes but seldom apply the same harsh judgement to ourselves, so I asked myself, do I even know C++? I mean yeah, I have some projects and I passed a C++ interview but even then I’ve never even shipped C++ production code, I’ve never had C++ code reviewed by a senior who can spot shortcomings past simple syntax. 
    
    While preparing for interviews I dove deep into things like object lifetimes, RAII, move semantics, const-correctness and references vs pointers
    
    Taking CMPT 450, Computer Architecture, I got to learn about things like predictable performance, memory discipline and cache awareness.  
    
    for performance and memory, basically where low latency lives. 
    
    stack vs heap alloc
    
    cache lines and false sharing
    
    alignment and padding 
    
    branch prediction
    
    (what every programmer should know about memory & optimized c++ kurt guntheroth)
    
    for systems thinking we need to understand os scheduling, numa effects, cpu pinning, syscall cost 
    
    ignoring the os leads to unstable latency
    
    things to include for examples:
    
    - coding jesus clips of grads not knowing c++ saying they want to be a quant
    - generic C++ tutorials
    - university lectures with poor practices not even mentioning how badly a pr like that would get roasted
    - papers to read:
    - lmax disruptors architecture papers
    - memory barriers
    - intel latency optimisation guides
    - linux perf & scheduler docs
    
    study implementation details
    
    - boost.lockfree
    - folly (meta)
    - aeron messaging concepts
    - c++ disruptor implementations
    
    AVOID:
    
    generic c++ tutorials
    
    STL abuse without cost awareness
    
    low latency youtube click bait
    
    takeaways c++ for low latency is like:
    
    systems thinking, memory discipline, and performance skepticisim, not syntax and not even design patterns. 
    
    idea for implementation:
    
    have it so that when you are coding you can have
    
    - live visualized testing of the code you are writing and comparison with visualization of the code you have (insert graph) vs if you used this data structure or function (insert better graph)
    - sentry for error monitoring
    - c++ reference pop up
    - agent builder
    - (random vscode extensions: prettier, json crack,
    - the following along dynamic zoom presentation thing to show the features
    - maybe make it or demo it as a vscode extension or as a vscode overlay