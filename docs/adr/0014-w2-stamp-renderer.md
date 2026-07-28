# ADR 0014: Stamp renderer architecture

The renderer is a small deterministic package. It returns structural positions, dimensions, escaped SVG, and a digest. This keeps browser previews and future object storage consumers consistent.
