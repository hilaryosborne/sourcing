// The in-memory double as the FIRST conformance participant — the Docker-free logic signal
// every real adapter gets measured against. Per CONFORMANCE.md, this is expected to FAIL first
// (the double silently misses APPEND_NOT_CONTIGUOUS and the blind-append CAS backstop), proving
// the suite has teeth, then go green once the double is brought to conformance.
import { runConformance } from "../conformance";
import { memoryStorage } from "../../__tests__/memory-storage";

runConformance(() => Promise.resolve(memoryStorage()));
