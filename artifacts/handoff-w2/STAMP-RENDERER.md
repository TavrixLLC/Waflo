# Stamp renderer

The renderer returns deterministic SVG, dimensions, digest, and stamp positions for ROW, GRID, PATH, and RING. It clamps progress and escapes labels. Structural renderer tests cover fill count, minimum goal, all layouts, dimensions, determinism, and XSS-safe output.
