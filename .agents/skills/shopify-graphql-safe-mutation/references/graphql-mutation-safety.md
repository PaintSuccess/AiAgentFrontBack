# GraphQL mutation safety

## Required sequence

Schema discovery -> input discovery -> mutation draft -> validation -> execution -> userErrors review.

## Common use case: order note update

Use this flow when the user says:

- "write inside the order";
- "add a remark";
- "add a note";
- "put a reminder".

## Failure handling

If validation fails:

1. Read the validation error.
2. Re-inspect schema/input if needed.
3. Fix the mutation.
4. Validate again before executing.

If execution returns userErrors:

1. Summarize the error.
2. Do not claim success.
3. Suggest a safe next action.
