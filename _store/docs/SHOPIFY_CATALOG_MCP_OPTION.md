# Shopify Catalog MCP as a Future Product Search Source

## Status

Do not enable yet. The current Paint Access product search should remain the production source for now, with the existing stock/availability logic unchanged.

Shopify's Agentic Storefronts / Storefront Catalog MCP is available on the storefront MCP endpoint:

```text
https://paintaccess.com.au/api/ucp/mcp
```

The endpoint exposes catalog tools including:

- `search_catalog`
- `lookup_catalog`
- `get_product`

Relevant Shopify documentation:

- https://shopify.dev/docs/agents/catalog/storefront-catalog
- https://shopify.dev/docs/agents/catalog/global-catalog
- https://shopify.dev/docs/api/catalog-api

## Evaluation Notes

The Catalog MCP can find Paint Access products and returns Shopify product IDs, handles, titles, descriptions, variants, prices, media, tags, collections and checkout URLs.

Test query:

```text
Mirka deros 175mm
```

Observed result:

- The target product, `Mirka DEROS II 750AN 175mm...`, was returned.
- Shopify Catalog sometimes ranked the 175mm backing pad above the actual sander.
- The current custom backend search ranked the actual sander first for the same query.

Because of this, Catalog MCP is promising as an additional candidate source, but not safe as a direct replacement for the current search/ranking logic.

## Recommended Future Architecture

Use Shopify Catalog MCP only as a secondary retrieval source:

1. Run the current Admin GraphQL search.
2. Optionally run `search_catalog` in parallel.
3. Merge and dedupe candidates by Shopify product ID or handle.
4. Hydrate final product data through the current backend/Admin API.
5. Apply Paint Access ranking and availability logic.
6. Return the same compact product response shape to the ElevenLabs agent.

The current stock logic must remain authoritative:

- Tracked variants: available only when `inventoryPolicy === "CONTINUE"`.
- Untracked variants: use `availableForSale === true`.

## Rollout Guard

If implemented later, put it behind an environment flag:

```text
PRODUCT_SEARCH_MODE=current|hybrid|catalog-test
```

Recommended rollout:

1. Keep `current` as default.
2. Add `catalog-test` for diagnostics only.
3. Compare query accuracy and latency against real customer queries.
4. Move to `hybrid` only if it improves recall without lowering precision.

