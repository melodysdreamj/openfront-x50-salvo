Frozen pre-optimization oracle from commit 1cf9044, version 4.1.2.
Only module import paths are changed. Do not synchronize its algorithms with
src/: differential tests must retain the previous implementation independently.
Both versions use the same pinned, unmodified original trajectory and SAM selector.
This proves regression equivalence for tested inputs, not universal game accuracy.
