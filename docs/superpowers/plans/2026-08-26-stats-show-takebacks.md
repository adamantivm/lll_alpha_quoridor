# Show takeback games on the stats page by default

Takebacks turn out to be common — mis-taps on a phone that have to be undone —
so hiding them by default makes the stats page disagree with the play page's
hall of fame, which counts them. A win visible on the front page was missing
from the table with no explanation.

## Change

`DEFAULT_FILTERS.excludeUndos` in `frontend/src/lib/aggregate.ts`: `true` -> `false`.
The filter stays; it becomes opt-in. Update the two assertions in
`aggregate.test.ts` that pin the old default.

## Verify

`npm --prefix frontend run check`, `test`, `build`, then load the built
stats page in a browser and confirm the checkbox starts unchecked and the
count reads N of N.
