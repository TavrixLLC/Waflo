# ADR 0020: Autosave concurrency

Draft writes carry a revision. A stale revision is rejected with a conflict so the editor cannot silently overwrite another editor.
