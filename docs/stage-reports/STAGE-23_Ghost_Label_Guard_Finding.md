# Stage 23 finding — F302's label guard excludes real Ghosts

The corrected Stage 23 brief, Do item 2, indexes an Employee only when its registered `labelField` (`full_name`) is a non-empty text value. Do item 3, Do item 7, and the Done criteria still require a Ghost to be found by its role title and returned with `isGhost: true`; `VPS-F002`'s Ghost acceptance criterion says the same.

The real `ghost.create` writer in `services/api/src/mutations/ghost-resource.ts` uses `ghostEmployeeOperationalRecord` from `packages/schema/src/employee.ts`. That constructor deliberately sets `full_name: null` and puts the role title in `job_title`, as `VRS-F007` specifies. The unchanged Stage 22 Skill Matrix test uses this same Ghost shape. Therefore the F302 guard excludes every real Ghost Employee from `cache_search`, so no local query of its role title can return the required Ghost result. A test Ghost with an invented non-empty `full_name` would pass while hiding the production failure.

No Stage 23 product code or gates were run. Reviewer ruling requested: correct the label/index guard or the Ghost search requirement in the owning brief/spec, and specify the corresponding test. Do not change `VRS-F007`'s Ghost identity fields merely to satisfy search. F301 and F302's browser-gate and named-fixture rulings remain accepted.
