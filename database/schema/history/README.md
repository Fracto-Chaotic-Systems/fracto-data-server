# Historical migration byte proofs

Immutable copies of the pre-service migration history. Database synchronization uses these exact bytes to recognize legacy LF/CRLF checksums. The root retains historical migration application ordering; these copies are not additional migration inputs. New data-service migrations remain under `database/migrations/`.
